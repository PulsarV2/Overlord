package wire

import (
	"bytes"
	"context"
	"testing"

	"github.com/vmihailenco/msgpack/v5"
	"nhooyr.io/websocket"
)

type testWriter struct {
	msgs [][]byte
}

func (w *testWriter) Write(ctx context.Context, messageType websocket.MessageType, p []byte) error {
	w.msgs = append(w.msgs, append([]byte(nil), p...))
	return nil
}

func TestHelloMarshaling(t *testing.T) {
	hello := Hello{
		Type:     "hello",
		ID:       "test-id",
		HWID:     "test-hwid",
		Host:     "test-host",
		OS:       "test-os",
		Arch:     "test-arch",
		Version:  "1.0.0",
		User:     "test-user",
		Monitors: 2,
		Country:  "US",
	}

	data, err := msgpack.Marshal(hello)
	if err != nil {
		t.Fatalf("Failed to marshal Hello: %v", err)
	}

	var decoded Hello
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal Hello: %v", err)
	}

	if decoded.ID != hello.ID {
		t.Errorf("ID mismatch: got %s, want %s", decoded.ID, hello.ID)
	}
	if decoded.Monitors != hello.Monitors {
		t.Errorf("Monitors mismatch: got %d, want %d", decoded.Monitors, hello.Monitors)
	}
}

func TestPingPongMarshaling(t *testing.T) {
	ping := Ping{
		Type: "ping",
		TS:   1234567890,
	}

	data, err := msgpack.Marshal(ping)
	if err != nil {
		t.Fatalf("Failed to marshal Ping: %v", err)
	}

	var decoded Ping
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal Ping: %v", err)
	}

	if decoded.TS != ping.TS {
		t.Errorf("Timestamp mismatch: got %d, want %d", decoded.TS, ping.TS)
	}

	pong := Pong{
		Type: "pong",
		TS:   ping.TS,
	}

	data2, err := msgpack.Marshal(pong)
	if err != nil {
		t.Fatalf("Failed to marshal Pong: %v", err)
	}

	var decodedPong Pong
	if err := msgpack.Unmarshal(data2, &decodedPong); err != nil {
		t.Fatalf("Failed to unmarshal Pong: %v", err)
	}

	if decodedPong.TS != pong.TS {
		t.Errorf("Pong timestamp mismatch: got %d, want %d", decodedPong.TS, pong.TS)
	}
}

func TestCommandMarshaling(t *testing.T) {
	cmd := Command{
		Type:        "command",
		CommandType: "test_command",
		ID:          "cmd-123",
		Payload:     map[string]interface{}{"key": "value"},
	}

	data, err := msgpack.Marshal(cmd)
	if err != nil {
		t.Fatalf("Failed to marshal Command: %v", err)
	}

	var decoded Command
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal Command: %v", err)
	}

	if decoded.CommandType != cmd.CommandType {
		t.Errorf("CommandType mismatch: got %s, want %s", decoded.CommandType, cmd.CommandType)
	}
	if decoded.ID != cmd.ID {
		t.Errorf("ID mismatch: got %s, want %s", decoded.ID, cmd.ID)
	}
}

func TestCommandResultMarshaling(t *testing.T) {
	result := CommandResult{
		Type:      "command_result",
		CommandID: "cmd-123",
		OK:        true,
		Message:   "Success",
	}

	data, err := msgpack.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal CommandResult: %v", err)
	}

	var decoded CommandResult
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal CommandResult: %v", err)
	}

	if decoded.OK != result.OK {
		t.Errorf("OK mismatch: got %v, want %v", decoded.OK, result.OK)
	}
	if decoded.Message != result.Message {
		t.Errorf("Message mismatch: got %s, want %s", decoded.Message, result.Message)
	}
}

func TestFrameMarshaling(t *testing.T) {
	frame := Frame{
		Type: "frame",
		Header: FrameHeader{
			Monitor: 0,
			FPS:     30,
			Format:  "jpeg",
		},
		Data: []byte{0xFF, 0xD8, 0xFF, 0xE0},
	}

	data, err := msgpack.Marshal(frame)
	if err != nil {
		t.Fatalf("Failed to marshal Frame: %v", err)
	}

	var decoded Frame
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal Frame: %v", err)
	}

	if decoded.Header.FPS != frame.Header.FPS {
		t.Errorf("FPS mismatch: got %d, want %d", decoded.Header.FPS, frame.Header.FPS)
	}
	if !bytes.Equal(decoded.Data, frame.Data) {
		t.Errorf("Data mismatch")
	}
}

func TestFileEntryMarshaling(t *testing.T) {
	entry := FileEntry{
		Name:    "test.txt",
		Path:    "/home/user/test.txt",
		IsDir:   false,
		Size:    1024,
		ModTime: 1609459200,
	}

	data, err := msgpack.Marshal(entry)
	if err != nil {
		t.Fatalf("Failed to marshal FileEntry: %v", err)
	}

	var decoded FileEntry
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal FileEntry: %v", err)
	}

	if decoded.Name != entry.Name {
		t.Errorf("Name mismatch: got %s, want %s", decoded.Name, entry.Name)
	}
	if decoded.Size != entry.Size {
		t.Errorf("Size mismatch: got %d, want %d", decoded.Size, entry.Size)
	}
	if decoded.IsDir != entry.IsDir {
		t.Errorf("IsDir mismatch: got %v, want %v", decoded.IsDir, entry.IsDir)
	}
}

func TestFileListResultMarshaling(t *testing.T) {
	result := FileListResult{
		Type:      "file_list_result",
		CommandID: "cmd-456",
		Path:      "/home/user",
		Entries: []FileEntry{
			{Name: "file1.txt", Path: "/home/user/file1.txt", IsDir: false, Size: 100, ModTime: 1609459200},
			{Name: "dir1", Path: "/home/user/dir1", IsDir: true, Size: 0, ModTime: 1609459200},
		},
		Error: "",
	}

	data, err := msgpack.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal FileListResult: %v", err)
	}

	var decoded FileListResult
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal FileListResult: %v", err)
	}

	if len(decoded.Entries) != len(result.Entries) {
		t.Errorf("Entries count mismatch: got %d, want %d", len(decoded.Entries), len(result.Entries))
	}
	if decoded.Path != result.Path {
		t.Errorf("Path mismatch: got %s, want %s", decoded.Path, result.Path)
	}
}

func TestProcessInfoMarshaling(t *testing.T) {
	proc := ProcessInfo{
		PID:      1234,
		PPID:     1,
		Name:     "test.exe",
		CPU:      25.5,
		Memory:   1048576,
		Username: "testuser",
		Type:     "own",
	}

	data, err := msgpack.Marshal(proc)
	if err != nil {
		t.Fatalf("Failed to marshal ProcessInfo: %v", err)
	}

	var decoded ProcessInfo
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal ProcessInfo: %v", err)
	}

	if decoded.PID != proc.PID {
		t.Errorf("PID mismatch: got %d, want %d", decoded.PID, proc.PID)
	}
	if decoded.PPID != proc.PPID {
		t.Errorf("PPID mismatch: got %d, want %d", decoded.PPID, proc.PPID)
	}
	if decoded.Name != proc.Name {
		t.Errorf("Name mismatch: got %s, want %s", decoded.Name, proc.Name)
	}
	if decoded.CPU != proc.CPU {
		t.Errorf("CPU mismatch: got %f, want %f", decoded.CPU, proc.CPU)
	}
	if decoded.Type != proc.Type {
		t.Errorf("Type mismatch: got %s, want %s", decoded.Type, proc.Type)
	}
}

func TestProcessListResultMarshaling(t *testing.T) {
	result := ProcessListResult{
		Type:      "process_list_result",
		CommandID: "cmd-789",
		Processes: []ProcessInfo{
			{PID: 1, PPID: 0, Name: "init", CPU: 0.1, Memory: 1024, Username: "root", Type: "system"},
			{PID: 100, PPID: 1, Name: "service", CPU: 5.0, Memory: 2048, Username: "system", Type: "service"},
		},
		Error: "",
	}

	data, err := msgpack.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal ProcessListResult: %v", err)
	}

	var decoded ProcessListResult
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal ProcessListResult: %v", err)
	}

	if len(decoded.Processes) != len(result.Processes) {
		t.Errorf("Processes count mismatch: got %d, want %d", len(decoded.Processes), len(result.Processes))
	}
}

func TestWriteMsg(t *testing.T) {
	writer := &testWriter{}
	ctx := context.Background()

	msg := Pong{
		Type: "pong",
		TS:   1234567890,
	}

	if err := WriteMsg(ctx, writer, msg); err != nil {
		t.Fatalf("WriteMsg failed: %v", err)
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var decoded Pong
	if err := msgpack.Unmarshal(writer.msgs[0], &decoded); err != nil {
		t.Fatalf("Failed to unmarshal written message: %v", err)
	}

	if decoded.TS != msg.TS {
		t.Errorf("Written message timestamp mismatch: got %d, want %d", decoded.TS, msg.TS)
	}
}

func TestConsoleOutputMarshaling(t *testing.T) {
	exitCode := 0
	output := ConsoleOutput{
		Type:      "console_output",
		SessionID: "session-123",
		Data:      []byte("test output"),
		ExitCode:  &exitCode,
		Error:     "",
	}

	data, err := msgpack.Marshal(output)
	if err != nil {
		t.Fatalf("Failed to marshal ConsoleOutput: %v", err)
	}

	var decoded ConsoleOutput
	if err := msgpack.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal ConsoleOutput: %v", err)
	}

	if decoded.SessionID != output.SessionID {
		t.Errorf("SessionID mismatch: got %s, want %s", decoded.SessionID, output.SessionID)
	}
	if !bytes.Equal(decoded.Data, output.Data) {
		t.Errorf("Data mismatch")
	}
	if decoded.ExitCode == nil || *decoded.ExitCode != *output.ExitCode {
		t.Errorf("ExitCode mismatch")
	}
}
