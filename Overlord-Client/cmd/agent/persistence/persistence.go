package persistence

import (
	"os"
	"path/filepath"
)

func Setup() error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return err
	}
	return install(exePath)
}

func Remove() error {
	return uninstall()
}
