//go:build !windows
// +build !windows

package handlers

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"
	"syscall"

	"overlord-client/cmd/agent/wire"
)

func getFilePermissions(info os.FileInfo) (mode, owner, group string) {

	mode = fmt.Sprintf("%04o", info.Mode().Perm())

	if stat, ok := info.Sys().(*syscall.Stat_t); ok {

		if u, err := user.LookupId(strconv.Itoa(int(stat.Uid))); err == nil {
			owner = u.Username
		} else {
			owner = strconv.Itoa(int(stat.Uid))
		}

		if g, err := user.LookupGroupId(strconv.Itoa(int(stat.Gid))); err == nil {
			group = g.Name
		} else {
			group = strconv.Itoa(int(stat.Gid))
		}
	}

	return
}

func enrichFileEntry(entry *wire.FileEntry, info os.FileInfo) {
	mode, owner, group := getFilePermissions(info)
	entry.Mode = mode
	entry.Owner = owner
	entry.Group = group
}

func ChangeFilePermissions(path string, mode string) error {

	var modeVal uint32
	_, err := fmt.Sscanf(mode, "%o", &modeVal)
	if err != nil {
		return fmt.Errorf("invalid mode format: %v", err)
	}

	return os.Chmod(path, os.FileMode(modeVal))
}

func ExecuteFile(path string) error {
	ext := ""
	if idx := strings.LastIndex(path, "."); idx != -1 {
		ext = path[idx:]
	}

	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("file not found: %s", path)
	}

	switch ext {
	case ".sh", ".bash":

		return execCommand("bash", path)
	case ".py":

		return execCommand("python3", path)
	case ".rb":

		return execCommand("ruby", path)
	case ".js":

		return execCommand("node", path)
	case ".pl":

		return execCommand("perl", path)
	case "":

		if info.Mode()&0111 != 0 {
			return execCommand(path)
		}
		return fmt.Errorf("file is not executable")
	default:

		if info.Mode()&0111 != 0 {
			return execCommand(path)
		}
		return fmt.Errorf("unsupported file type: %s", ext)
	}
}

func execCommand(name string, args ...string) error {
	cmd := exec.Command(name, args...)

	return cmd.Start()
}
