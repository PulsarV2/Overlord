package runtime

import (
	"context"
	"os"
	"sync"
	"time"

	"overlord-client/cmd/agent/config"
	"overlord-client/cmd/agent/plugins"
	"overlord-client/cmd/agent/wire"
)

type Env struct {
	Conn                      wire.Writer
	Cfg                       config.Config
	Cancel                    context.CancelFunc
	Console                   *ConsoleHub
	SelectedDisplay           int
	MouseControl              bool
	KeyboardControl           bool
	CursorCapture             bool
	DesktopCancel             context.CancelFunc
	Plugins                   *plugins.Manager
	NotificationMu            sync.RWMutex
	NotificationKeywords      []string
	NotificationMinIntervalMs int
}

func (e *Env) SetNotificationConfig(keywords []string, minIntervalMs int) {
	e.NotificationMu.Lock()
	e.NotificationKeywords = keywords
	if minIntervalMs > 0 {
		e.NotificationMinIntervalMs = minIntervalMs
	}
	e.NotificationMu.Unlock()
}

func (e *Env) GetNotificationKeywords() []string {
	e.NotificationMu.RLock()
	defer e.NotificationMu.RUnlock()
	if len(e.NotificationKeywords) == 0 {
		return nil
	}
	out := make([]string, len(e.NotificationKeywords))
	copy(out, e.NotificationKeywords)
	return out
}

func (e *Env) GetNotificationMinIntervalMs() int {
	e.NotificationMu.RLock()
	defer e.NotificationMu.RUnlock()
	return e.NotificationMinIntervalMs
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
