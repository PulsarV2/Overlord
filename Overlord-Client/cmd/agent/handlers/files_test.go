package handlers

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"overlord-client/cmd/agent/config"
	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"

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

func TestHandleFileList(t *testing.T) {

	tmpDir := t.TempDir()

	testFile1 := filepath.Join(tmpDir, "test1.txt")
	testFile2 := filepath.Join(tmpDir, "test2.txt")
	testDir := filepath.Join(tmpDir, "testdir")

	if err := os.WriteFile(testFile1, []byte("content1"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	if err := os.WriteFile(testFile2, []byte("content2"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	if err := os.Mkdir(testDir, 0755); err != nil {
		t.Fatalf("Failed to create test directory: %v", err)
	}

	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-1"

	if err := HandleFileList(ctx, env, cmdID, tmpDir); err != nil {
		t.Fatalf("HandleFileList failed: %v", err)
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.FileListResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	if result.Type != "file_list_result" {
		t.Errorf("Expected type 'file_list_result', got '%s'", result.Type)
	}
	if result.CommandID != cmdID {
		t.Errorf("Expected CommandID '%s', got '%s'", cmdID, result.CommandID)
	}
	if len(result.Entries) != 3 {
		t.Errorf("Expected 3 entries, got %d", len(result.Entries))
	}

	names := make(map[string]bool)
	for _, entry := range result.Entries {
		names[entry.Name] = entry.IsDir
	}

	if len(names) != 3 {
		t.Logf("Found entries: %v", names)
	}

	hasTest1 := false
	hasTest2 := false
	hasTestDir := false
	for name, isDir := range names {
		if name == "test1.txt" {
			hasTest1 = true
		}
		if name == "test2.txt" {
			hasTest2 = true
		}
		if isDir {
			hasTestDir = true
		}
	}

	if !hasTest1 || !hasTest2 || !hasTestDir {
		t.Errorf("Missing expected entries - test1:%v test2:%v testdir:%v", hasTest1, hasTest2, hasTestDir)
	}
}

func TestHandleFileList_InvalidPath(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-2"

	invalidPath := filepath.Join(t.TempDir(), "nonexistent")
	if err := HandleFileList(ctx, env, cmdID, invalidPath); err != nil {
		t.Fatalf("HandleFileList should not return error: %v", err)
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.FileListResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	if result.Error == "" {
		t.Error("Expected error message for invalid path")
	}
}

func TestHandleFileDownload(t *testing.T) {

	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "download_test.txt")
	testContent := []byte("This is test content for download")

	if err := os.WriteFile(testFile, testContent, 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-3"

	if err := HandleFileDownload(ctx, env, cmdID, testFile); err != nil {
		t.Fatalf("HandleFileDownload failed: %v", err)
	}

	if len(writer.msgs) == 0 {
		t.Fatal("Expected at least 1 message")
	}

	var download wire.FileDownload
	if err := msgpack.Unmarshal(writer.msgs[0], &download); err != nil {
		t.Fatalf("Failed to unmarshal download message: %v", err)
	}

	if download.Type != "file_download" {
		t.Errorf("Expected type 'file_download', got '%s'", download.Type)
	}
	if download.CommandID != cmdID {
		t.Errorf("Expected CommandID '%s', got '%s'", cmdID, download.CommandID)
	}
	if download.Total != int64(len(testContent)) {
		t.Errorf("Expected total size %d, got %d", len(testContent), download.Total)
	}

	var assembled []byte
	for _, msg := range writer.msgs {
		var chunk wire.FileDownload
		if err := msgpack.Unmarshal(msg, &chunk); err != nil {
			t.Fatalf("Failed to unmarshal chunk: %v", err)
		}
		assembled = append(assembled, chunk.Data...)
	}

	if string(assembled) != string(testContent) {
		t.Errorf("Downloaded content mismatch:\ngot: %s\nwant: %s", string(assembled), string(testContent))
	}
}

func TestHandleFileDelete(t *testing.T) {

	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "delete_test.txt")

	if err := os.WriteFile(testFile, []byte("delete me"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-4"

	if err := HandleFileDelete(ctx, env, cmdID, testFile); err != nil {
		t.Fatalf("HandleFileDelete failed: %v", err)
	}

	if _, err := os.Stat(testFile); !os.IsNotExist(err) {
		t.Error("File should have been deleted")
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.CommandResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	if !result.OK {
		t.Errorf("Expected OK=true, got false with message: %s", result.Message)
	}
}

func TestHandleFileMkdir(t *testing.T) {
	tmpDir := t.TempDir()
	newDir := filepath.Join(tmpDir, "newdir")

	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-5"

	if err := HandleFileMkdir(ctx, env, cmdID, newDir); err != nil {
		t.Fatalf("HandleFileMkdir failed: %v", err)
	}

	info, err := os.Stat(newDir)
	if err != nil {
		t.Fatalf("Directory should have been created: %v", err)
	}
	if !info.IsDir() {
		t.Error("Created path should be a directory")
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.CommandResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	if !result.OK {
		t.Errorf("Expected OK=true, got false with message: %s", result.Message)
	}
}

func TestHandleFileUpload(t *testing.T) {
	tmpDir := t.TempDir()
	uploadPath := filepath.Join(tmpDir, "uploaded.txt")
	uploadContent := []byte("This is uploaded content")

	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-6"

	if err := HandleFileUpload(ctx, env, cmdID, uploadPath, uploadContent, 0); err != nil {
		t.Fatalf("HandleFileUpload failed: %v", err)
	}

	content, err := os.ReadFile(uploadPath)
	if err != nil {
		t.Fatalf("Failed to read uploaded file: %v", err)
	}

	if string(content) != string(uploadContent) {
		t.Errorf("Upload content mismatch:\ngot: %s\nwant: %s", string(content), string(uploadContent))
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.FileUploadResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	if !result.OK {
		t.Errorf("Expected OK=true, got false with error: %s", result.Error)
	}
}

func TestHandleFileZip(t *testing.T) {

	tmpDir := t.TempDir()
	sourceDir := filepath.Join(tmpDir, "source")

	if err := os.Mkdir(sourceDir, 0755); err != nil {
		t.Fatalf("Failed to create source dir: %v", err)
	}

	testFile := filepath.Join(sourceDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("zip me"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-7"

	if err := HandleFileZip(ctx, env, cmdID, sourceDir); err != nil {
		t.Fatalf("HandleFileZip failed: %v", err)
	}

	if len(writer.msgs) == 0 {
		t.Fatal("Expected at least 1 message")
	}

	hasResult := false
	hasDownload := false

	for _, msg := range writer.msgs {
		var testMsg map[string]interface{}
		if err := msgpack.Unmarshal(msg, &testMsg); err == nil {
			msgType, _ := testMsg["type"].(string)
			if msgType == "command_result" {
				hasResult = true
			}
			if msgType == "file_download" {
				hasDownload = true
			}
		}
	}

	t.Logf("Has command_result: %v, has file_download: %v", hasResult, hasDownload)

	if !hasResult && !hasDownload {
		t.Error("Expected either command_result or file_download message")
	}
}
