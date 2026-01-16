//go:build !windows

package console

import "syscall"

func platformSysProcAttr() *syscall.SysProcAttr {
	return nil
}
