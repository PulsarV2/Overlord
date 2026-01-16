//go:build !windows

package handlers

func setCursorPos(x, y int32)        {}
func sendMouseDown(button int)       {}
func sendMouseUp(button int)         {}
func sendKeyDown(vk uint16)          {}
func sendKeyUp(vk uint16)            {}
func keyCodeToVK(code string) uint16 { return 0 }
