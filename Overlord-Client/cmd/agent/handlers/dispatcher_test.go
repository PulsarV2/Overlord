package handlers

import (
	"context"
	"testing"

	"overlord-client/cmd/agent/config"
	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"

	"github.com/vmihailenco/msgpack/v5"
)

func TestHandlePing(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	envelope := map[string]interface{}{
		"ts": float64(1234567890),
	}

	if err := HandlePing(ctx, env, envelope); err != nil {
		t.Fatalf("HandlePing failed: %v", err)
	}

	if len(writer.msgs) < 1 {
		t.Fatal("Expected at least 1 message")
	}

	var pong wire.Pong
	if err := msgpack.Unmarshal(writer.msgs[0], &pong); err != nil {
		t.Fatalf("Failed to unmarshal pong: %v", err)
	}

	if pong.Type != "pong" {
		t.Errorf("Expected type 'pong', got '%s'", pong.Type)
	}
	expectedTS := int64(1234567890)
	if pong.TS != expectedTS {
		t.Errorf("Expected timestamp %d, got %d", expectedTS, pong.TS)
	}
}

func TestHandleCommand_Ping(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()

	envelope := map[string]interface{}{
		"type":        "command",
		"commandType": "ping",
		"id":          "cmd-ping-1",
		"ts":          float64(1234567890),
	}

	if err := HandleCommand(ctx, env, envelope); err != nil {
		t.Fatalf("HandleCommand(ping) failed: %v", err)
	}

	if len(writer.msgs) < 1 {
		t.Fatal("Expected at least 1 message")
	}

	var firstMsg map[string]interface{}
	if err := msgpack.Unmarshal(writer.msgs[0], &firstMsg); err != nil {
		t.Fatalf("Failed to unmarshal first message: %v", err)
	}

	msgType, _ := firstMsg["type"].(string)
	t.Logf("First message type: %s", msgType)
}

func TestHandleCommand_Desktop(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()

	envelope := map[string]interface{}{
		"type":        "command",
		"commandType": "desktop",
		"id":          "cmd-desktop-1",
		"payload":     map[string]interface{}{},
	}

	if err := HandleCommand(ctx, env, envelope); err != nil {
		t.Fatalf("HandleCommand(desktop) failed: %v", err)
	}

	t.Logf("Desktop command sent %d messages", len(writer.msgs))
}

func TestHandleCommand_ProcessList(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()

	envelope := map[string]interface{}{
		"type":        "command",
		"commandType": "process_list",
		"id":          "cmd-proc-1",
		"payload":     map[string]interface{}{},
	}

	if err := HandleCommand(ctx, env, envelope); err != nil {
		t.Fatalf("HandleCommand(process_list) failed: %v", err)
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.ProcessListResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	if result.Type != "process_list_result" {
		t.Errorf("Expected process_list_result")
	}
}

func TestHandleCommand_FileList(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	tmpDir := t.TempDir()

	envelope := map[string]interface{}{
		"type":        "command",
		"commandType": "file_list",
		"id":          "cmd-file-1",
		"payload":     map[string]interface{}{"path": tmpDir},
	}

	if err := HandleCommand(ctx, env, envelope); err != nil {
		t.Fatalf("HandleCommand(file_list) failed: %v", err)
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.FileListResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	if result.Type != "file_list_result" {
		t.Errorf("Expected file_list_result")
	}
}

func TestHandleCommand_UnknownCommand(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()

	envelope := map[string]interface{}{
		"type":        "command",
		"commandType": "unknown_command_xyz",
		"id":          "cmd-unknown-1",
		"payload":     map[string]interface{}{},
	}

	if err := HandleCommand(ctx, env, envelope); err != nil {
		t.Logf("Unknown command returned error (expected): %v", err)
	}

	t.Logf("Unknown command handling sent %d messages", len(writer.msgs))
}

func TestCommandPayloadExtraction(t *testing.T) {

	tests := []struct {
		name     string
		payload  interface{}
		key      string
		expected interface{}
	}{
		{
			name:     "StringValue",
			payload:  map[string]interface{}{"path": "/test/path"},
			key:      "path",
			expected: "/test/path",
		},
		{
			name:     "IntValue",
			payload:  map[string]interface{}{"pid": float64(1234)},
			key:      "pid",
			expected: float64(1234),
		},
		{
			name:     "BoolValue",
			payload:  map[string]interface{}{"recursive": true},
			key:      "recursive",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payloadMap, ok := tt.payload.(map[string]interface{})
			if !ok {
				t.Fatal("Payload is not a map")
			}

			value, exists := payloadMap[tt.key]
			if !exists {
				t.Errorf("Key %s not found in payload", tt.key)
			}

			if value != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, value)
			}
		})
	}
}
