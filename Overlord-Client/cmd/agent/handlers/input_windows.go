//go:build windows

package handlers

import (
	"syscall"
	"unsafe"
)

var (
	user32             = syscall.NewLazyDLL("user32.dll")
	procSetCursorPos   = user32.NewProc("SetCursorPos")
	procMouseEvent     = user32.NewProc("mouse_event")
	procSendInput      = user32.NewProc("SendInput")
	procMapVirtualKeyW = user32.NewProc("MapVirtualKeyW")
	procVkKeyScanW     = user32.NewProc("VkKeyScanW")
)

const (
	MOUSEEVENTF_MOVE       = 0x0001
	MOUSEEVENTF_LEFTDOWN   = 0x0002
	MOUSEEVENTF_LEFTUP     = 0x0004
	MOUSEEVENTF_RIGHTDOWN  = 0x0008
	MOUSEEVENTF_RIGHTUP    = 0x0010
	MOUSEEVENTF_MIDDLEDOWN = 0x0020
	MOUSEEVENTF_MIDDLEUP   = 0x0040
	MOUSEEVENTF_ABSOLUTE   = 0x8000
	INPUT_MOUSE            = 0
	INPUT_KEYBOARD         = 1
	KEYEVENTF_EXTENDEDKEY  = 0x0001
	KEYEVENTF_KEYUP        = 0x0002
	KEYEVENTF_UNICODE      = 0x0004
	KEYEVENTF_SCANCODE     = 0x0008
)

type mouseInput struct {
	dx          int32
	dy          int32
	mouseData   uint32
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type keybdInput struct {
	wVk         uint16
	wScan       uint16
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type hardwareInput struct {
	uMsg    uint32
	wParamL uint16
	wParamH uint16
}

type input struct {
	inputType uint32
	union     [24]byte
}

func setCursorPos(x, y int32) {
	_, _, _ = procSetCursorPos.Call(uintptr(x), uintptr(y))
}

func mouseEvent(flags uint32, dx, dy int32) {
	_, _, _ = procMouseEvent.Call(uintptr(flags), uintptr(dx), uintptr(dy), 0, 0)
}

func sendMouseDown(button int) {
	switch button {
	case 0:
		mouseEvent(MOUSEEVENTF_LEFTDOWN, 0, 0)
	case 2:
		mouseEvent(MOUSEEVENTF_RIGHTDOWN, 0, 0)
	case 1:
		mouseEvent(MOUSEEVENTF_MIDDLEDOWN, 0, 0)
	}
}

func sendMouseUp(button int) {
	switch button {
	case 0:
		mouseEvent(MOUSEEVENTF_LEFTUP, 0, 0)
	case 2:
		mouseEvent(MOUSEEVENTF_RIGHTUP, 0, 0)
	case 1:
		mouseEvent(MOUSEEVENTF_MIDDLEUP, 0, 0)
	}
}

func sendKeyDown(vk uint16) {
	var inp input
	inp.inputType = INPUT_KEYBOARD
	ki := (*keybdInput)(unsafe.Pointer(&inp.union[0]))
	ki.wVk = vk
	ki.dwFlags = 0
	_, _, _ = procSendInput.Call(1, uintptr(unsafe.Pointer(&inp)), unsafe.Sizeof(inp))
}

func sendKeyUp(vk uint16) {
	var inp input
	inp.inputType = INPUT_KEYBOARD
	ki := (*keybdInput)(unsafe.Pointer(&inp.union[0]))
	ki.wVk = vk
	ki.dwFlags = KEYEVENTF_KEYUP
	_, _, _ = procSendInput.Call(1, uintptr(unsafe.Pointer(&inp)), unsafe.Sizeof(inp))
}

func keyCodeToVK(code string) uint16 {
	vkMap := map[string]uint16{
		"KeyA": 0x41, "KeyB": 0x42, "KeyC": 0x43, "KeyD": 0x44, "KeyE": 0x45,
		"KeyF": 0x46, "KeyG": 0x47, "KeyH": 0x48, "KeyI": 0x49, "KeyJ": 0x4A,
		"KeyK": 0x4B, "KeyL": 0x4C, "KeyM": 0x4D, "KeyN": 0x4E, "KeyO": 0x4F,
		"KeyP": 0x50, "KeyQ": 0x51, "KeyR": 0x52, "KeyS": 0x53, "KeyT": 0x54,
		"KeyU": 0x55, "KeyV": 0x56, "KeyW": 0x57, "KeyX": 0x58, "KeyY": 0x59, "KeyZ": 0x5A,
		"Digit0": 0x30, "Digit1": 0x31, "Digit2": 0x32, "Digit3": 0x33, "Digit4": 0x34,
		"Digit5": 0x35, "Digit6": 0x36, "Digit7": 0x37, "Digit8": 0x38, "Digit9": 0x39,
		"Enter": 0x0D, "Space": 0x20, "Backspace": 0x08, "Tab": 0x09, "Escape": 0x1B,
		"ShiftLeft": 0xA0, "ShiftRight": 0xA1, "ControlLeft": 0xA2, "ControlRight": 0xA3,
		"AltLeft": 0xA4, "AltRight": 0xA5, "MetaLeft": 0x5B, "MetaRight": 0x5C,
		"ArrowLeft": 0x25, "ArrowUp": 0x26, "ArrowRight": 0x27, "ArrowDown": 0x28,
		"Delete": 0x2E, "Home": 0x24, "End": 0x23, "PageUp": 0x21, "PageDown": 0x22,
		"F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73, "F5": 0x74, "F6": 0x75,
		"F7": 0x76, "F8": 0x77, "F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B,
	}
	if vk, ok := vkMap[code]; ok {
		return vk
	}
	return 0
}
