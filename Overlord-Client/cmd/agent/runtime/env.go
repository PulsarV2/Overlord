package runtime

import (
	"context"
	"os"
	"time"

	"overlord-client/cmd/agent/config"
	"overlord-client/cmd/agent/plugins"
	"overlord-client/cmd/agent/wire"
)

type Env struct {
	Conn            wire.Writer
	Cfg             config.Config
	Cancel          context.CancelFunc
	Console         *ConsoleHub
	SelectedDisplay int
	MouseControl    bool
	KeyboardControl bool
	CursorCapture   bool
	DesktopCancel   context.CancelFunc
	Plugins         *plugins.Manager
}

func Hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

func CurrentUser() string {
	if u := os.Getenv("USERNAME"); u != "" {
		return u
	}
	if u := os.Getenv("USER"); u != "" {
		return u
	}
	return "unknown"
}

func MinDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
