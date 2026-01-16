package handlers

import (
	"context"
	"testing"

	"overlord-client/cmd/agent/config"
	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"

	"github.com/vmihailenco/msgpack/v5"
)

func TestHandleProcessList(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-proc-1"

	if err := HandleProcessList(ctx, env, cmdID); err != nil {
		t.Fatalf("HandleProcessList failed: %v", err)
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.ProcessListResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	if result.Type != "process_list_result" {
		t.Errorf("Expected type 'process_list_result', got '%s'", result.Type)
	}
	if result.CommandID != cmdID {
		t.Errorf("Expected CommandID '%s', got '%s'", cmdID, result.CommandID)
	}

	if len(result.Processes) == 0 {
		t.Log("WARNING: No processes returned (may indicate platform issue)")
	} else {
		t.Logf("Found %d processes", len(result.Processes))

		for i, proc := range result.Processes {
			if proc.PID <= 0 {
				t.Errorf("Process %d has invalid PID: %d", i, proc.PID)
			}
			if proc.Name == "" {
				t.Errorf("Process %d has empty name", i)
			}
			if proc.Memory < 0 {
				t.Errorf("Process %d has negative memory: %d", i, proc.Memory)
			}
			if proc.CPU < 0 {
				t.Errorf("Process %d has negative CPU: %f", i, proc.CPU)
			}

			validTypes := map[string]bool{
				"system":  true,
				"service": true,
				"own":     true,
				"other":   true,
				"":        true,
			}
			if !validTypes[proc.Type] {
				t.Errorf("Process %d has invalid type: %s", i, proc.Type)
			}
		}

		pidExists := make(map[int32]bool)
		for _, proc := range result.Processes {
			pidExists[proc.PID] = true
		}

		for _, proc := range result.Processes {
			if proc.PPID != 0 && !pidExists[proc.PPID] {
				t.Logf("INFO: Process %d (%s) has PPID %d which is not in the list (may have exited)",
					proc.PID, proc.Name, proc.PPID)
			}
		}
	}
}

func TestHandleProcessList_ProcessTypes(t *testing.T) {
	writer := &testWriter{}
	env := &rt.Env{
		Conn: writer,
		Cfg:  config.Config{},
	}

	ctx := context.Background()
	cmdID := "test-cmd-proc-2"

	if err := HandleProcessList(ctx, env, cmdID); err != nil {
		t.Fatalf("HandleProcessList failed: %v", err)
	}

	if len(writer.msgs) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(writer.msgs))
	}

	var result wire.ProcessListResult
	if err := msgpack.Unmarshal(writer.msgs[0], &result); err != nil {
		t.Fatalf("Failed to unmarshal result: %v", err)
	}

	typeCounts := make(map[string]int)
	for _, proc := range result.Processes {
		typeCounts[proc.Type]++
	}

	t.Logf("Process type distribution:")
	for typ, count := range typeCounts {
		label := typ
		if label == "" {
			label = "uncategorized"
		}
		t.Logf("  %s: %d", label, count)
	}

	if typeCounts["system"] == 0 {
		t.Log("WARNING: No system processes detected")
	}

	examples := make(map[string][]string)
	for _, proc := range result.Processes {
		if len(examples[proc.Type]) < 3 {
			examples[proc.Type] = append(examples[proc.Type], proc.Name)
		}
	}

	t.Log("Example processes by type:")
	for typ, procs := range examples {
		label := typ
		if label == "" {
			label = "uncategorized"
		}
		t.Logf("  %s: %v", label, procs)
	}
}

func TestProcessInfoFields(t *testing.T) {

	proc := wire.ProcessInfo{
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

	var decoded wire.ProcessInfo
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
	if decoded.Memory != proc.Memory {
		t.Errorf("Memory mismatch: got %d, want %d", decoded.Memory, proc.Memory)
	}
	if decoded.Username != proc.Username {
		t.Errorf("Username mismatch: got %s, want %s", decoded.Username, proc.Username)
	}
	if decoded.Type != proc.Type {
		t.Errorf("Type mismatch: got %s, want %s", decoded.Type, proc.Type)
	}
}

func TestListProcesses_PlatformSpecific(t *testing.T) {

	processes, err := listProcesses()
	if err != nil {
		t.Fatalf("listProcesses failed: %v", err)
	}

	if len(processes) == 0 {
		t.Log("WARNING: No processes returned from listProcesses()")
		return
	}

	t.Logf("Retrieved %d processes from system", len(processes))

	for i, proc := range processes {
		if i < 10 {
			t.Logf("Process: PID=%d PPID=%d Name=%s CPU=%.2f%% Mem=%d User=%s Type=%s",
				proc.PID, proc.PPID, proc.Name, proc.CPU, proc.Memory, proc.Username, proc.Type)
		}

		if proc.PID <= 0 {
			t.Errorf("Process %d has invalid PID: %d", i, proc.PID)
		}
	}
}

func TestProcessTypeClassification(t *testing.T) {

	processes, err := listProcesses()
	if err != nil {
		t.Fatalf("listProcesses failed: %v", err)
	}

	if len(processes) == 0 {
		t.Skip("No processes available for testing")
	}

	var foundSystem, foundService, foundOwn bool
	for _, proc := range processes {
		switch proc.Type {
		case "system":
			foundSystem = true
			t.Logf("System process example: PID=%d Name=%s User=%s",
				proc.PID, proc.Name, proc.Username)
		case "service":
			foundService = true
			t.Logf("Service process example: PID=%d Name=%s User=%s",
				proc.PID, proc.Name, proc.Username)
		case "own":
			foundOwn = true
			t.Logf("Own process example: PID=%d Name=%s User=%s",
				proc.PID, proc.Name, proc.Username)
		}

		if foundSystem && foundService && foundOwn {
			break
		}
	}

	if !foundSystem {
		t.Log("INFO: No system processes detected in classification")
	}
	if !foundService {
		t.Log("INFO: No service processes detected in classification")
	}
	if !foundOwn {
		t.Log("INFO: No own processes detected in classification")
	}
}
