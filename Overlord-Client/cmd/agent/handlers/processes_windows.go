//go:build windows
// +build windows

package handlers

import (
	"fmt"
	"strings"
	"syscall"
	"unsafe"

	"overlord-client/cmd/agent/wire"

	"golang.org/x/sys/windows"
)

var (
	modKernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	modPsapi                     = windows.NewLazySystemDLL("psapi.dll")
	procEnumProcesses            = modPsapi.NewProc("EnumProcesses")
	procGetProcessMemoryInfo     = modPsapi.NewProc("GetProcessMemoryInfo")
	procOpenProcess              = modKernel32.NewProc("OpenProcess")
	procGetProcessImageFileNameW = modPsapi.NewProc("GetProcessImageFileNameW")
)

type PROCESS_MEMORY_COUNTERS struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
}

func listProcesses() ([]wire.ProcessInfo, error) {
	var pids [4096]uint32
	var bytesReturned uint32

	ret, _, _ := procEnumProcesses.Call(
		uintptr(unsafe.Pointer(&pids[0])),
		uintptr(len(pids)*4),
		uintptr(unsafe.Pointer(&bytesReturned)),
	)

	if ret == 0 {
		return nil, fmt.Errorf("EnumProcesses failed")
	}

	numProcesses := int(bytesReturned / 4)
	processes := make([]wire.ProcessInfo, 0, numProcesses)

	for i := 0; i < numProcesses; i++ {
		pid := int32(pids[i])
		if pid == 0 {
			continue
		}

		handle, _, _ := procOpenProcess.Call(
			windows.PROCESS_QUERY_INFORMATION|windows.PROCESS_VM_READ,
			0,
			uintptr(pid),
		)

		if handle == 0 {
			continue
		}
		defer windows.CloseHandle(windows.Handle(handle))

		var filename [windows.MAX_PATH]uint16
		ret, _, _ := procGetProcessImageFileNameW.Call(
			handle,
			uintptr(unsafe.Pointer(&filename[0])),
			uintptr(len(filename)),
		)

		name := "Unknown"
		if ret != 0 {
			name = syscall.UTF16ToString(filename[:])

			for i := len(name) - 1; i >= 0; i-- {
				if name[i] == '\\' || name[i] == '/' {
					name = name[i+1:]
					break
				}
			}
		}

		var memCounters PROCESS_MEMORY_COUNTERS
		memCounters.CB = uint32(unsafe.Sizeof(memCounters))
		memory := uint64(0)

		ret, _, _ = procGetProcessMemoryInfo.Call(
			handle,
			uintptr(unsafe.Pointer(&memCounters)),
			uintptr(memCounters.CB),
		)

		if ret != 0 {
			memory = uint64(memCounters.WorkingSetSize)
		}

		var pbi windows.PROCESS_BASIC_INFORMATION
		ppid := int32(0)
		err := windows.NtQueryInformationProcess(windows.Handle(handle), windows.ProcessBasicInformation, unsafe.Pointer(&pbi), uint32(unsafe.Sizeof(pbi)), nil)
		if err == nil {
			ppid = int32(pbi.InheritedFromUniqueProcessId)
		}

		username := "System"
		var token windows.Token
		if err := windows.OpenProcessToken(windows.Handle(handle), windows.TOKEN_QUERY, &token); err == nil {
			defer token.Close()
			tokenUser, err := token.GetTokenUser()
			if err == nil {
				account, domain, _, err := tokenUser.User.Sid.LookupAccount("")
				if err == nil {
					if domain != "" {
						username = domain + "\\" + account
					} else {
						username = account
					}
				}
			}
		}

		procType := "other"
		usernameLower := strings.ToLower(username)
		nameLower := strings.ToLower(name)

		if pid <= 4 || nameLower == "system" || nameLower == "registry" {
			procType = "system"
		} else if strings.Contains(usernameLower, "system") ||
			strings.Contains(usernameLower, "local service") ||
			strings.Contains(usernameLower, "network service") ||
			usernameLower == "system" {
			procType = "service"
		} else {

			currentUser, err := windows.GetCurrentProcessToken().GetTokenUser()
			if err == nil {
				tokenUser, err := token.GetTokenUser()
				if err == nil && tokenUser.User.Sid.Equals(currentUser.User.Sid) {
					procType = "own"
				}
			}
		}

		processes = append(processes, wire.ProcessInfo{
			PID:      pid,
			PPID:     ppid,
			Name:     name,
			CPU:      0.0,
			Memory:   memory,
			Username: username,
			Type:     procType,
		})
	}

	return processes, nil
}

func killProcess(pid int32) error {
	handle, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)

	return windows.TerminateProcess(handle, 1)
}
