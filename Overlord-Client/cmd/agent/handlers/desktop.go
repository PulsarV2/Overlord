package handlers

import (
	"context"
	"log"
	"overlord-client/cmd/agent/capture"
	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
	"runtime"
	"sync"
)

var (
	persistedDisplayValue int
	persistedDisplayMu    sync.Mutex
)

func persistDisplaySelection(display int) {
	persistedDisplayMu.Lock()
	persistedDisplayValue = display
	persistedDisplayMu.Unlock()
}

func GetPersistedDisplay() int {
	persistedDisplayMu.Lock()
	defer persistedDisplayMu.Unlock()
	return persistedDisplayValue
}

func DesktopStart(ctx context.Context, env *rt.Env) error {
	log.Printf("desktop: starting unlimited stream")
	for {
		select {
		case <-ctx.Done():
			log.Printf("desktop: stopping stream")
			return nil
		default:
			if err := capture.Now(ctx, env); err != nil {

				log.Printf("desktop: capture error: %v", err)
				continue
			}

			runtime.Gosched()
		}
	}
}

func DesktopSelect(ctx context.Context, env *rt.Env, display int) error {
	prev := env.SelectedDisplay
	maxDisplays := capture.MonitorCount()
	if display < 0 || display >= maxDisplays {
		log.Printf("desktop: WARNING - requested display %d out of range (0-%d), clamping to 0", display, maxDisplays-1)
		display = 0
	}
	env.SelectedDisplay = display

	persistDisplaySelection(display)
	log.Printf("desktop: set selected display from %d to %d (reported monitors=%d, will capture monitor at index %d)", prev, display, maxDisplays, display)
	return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", OK: true})
}

func DesktopMouseControl(ctx context.Context, env *rt.Env, enabled bool) error {
	env.MouseControl = enabled
	return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", OK: true})
}

func DesktopKeyboardControl(ctx context.Context, env *rt.Env, enabled bool) error {
	env.KeyboardControl = enabled
	return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", OK: true})
}

func DesktopCursorControl(ctx context.Context, env *rt.Env, enabled bool) error {
	env.CursorCapture = enabled
	capture.SetCursorCapture(enabled)
	return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{Type: "command_result", OK: true})
}
