//go:build linux
// +build linux

package persistence

import (
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"text/template"
)

const systemdService = `[Unit]
Description=Overlord Agent
After=network.target

[Service]
Type=simple
ExecStart={{.ExePath}}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`

const desktopEntry = `[Desktop Entry]
Type=Application
Name=Overlord Agent
Exec={{.ExePath}}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`

func getSystemdPath() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(usr.HomeDir, ".config", "systemd", "user", "overlord-agent.service"), nil
}

func getAutostartPath() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(usr.HomeDir, ".config", "autostart", "overlord-agent.desktop"), nil
}

func getTargetPath() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(usr.HomeDir, ".local", "share", "overlord", "agent"), nil
}

func install(exePath string) error {

	targetPath, err := getTargetPath()
	if err != nil {
		return fmt.Errorf("failed to get target path: %w", err)
	}

	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create overlord directory: %w", err)
	}

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

		if err := os.Chmod(targetPath, 0755); err != nil {
			return fmt.Errorf("failed to set executable permissions: %w", err)
		}
	}

	if err := installSystemd(targetPath); err == nil {
		return nil
	}

	return installAutostart(targetPath)
}

func installSystemd(exePath string) error {
	servicePath, err := getSystemdPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(servicePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create systemd directory: %w", err)
	}

	file, err := os.Create(servicePath)
	if err != nil {
		return fmt.Errorf("failed to create service file: %w", err)
	}
	defer file.Close()

	tmpl, err := template.New("service").Parse(systemdService)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	data := struct {
		ExePath string
	}{
		ExePath: exePath,
	}

	if err := tmpl.Execute(file, data); err != nil {
		return fmt.Errorf("failed to write service file: %w", err)
	}

	return nil
}

func installAutostart(exePath string) error {
	autostartPath, err := getAutostartPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(autostartPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create autostart directory: %w", err)
	}

	file, err := os.Create(autostartPath)
	if err != nil {
		return fmt.Errorf("failed to create desktop entry: %w", err)
	}
	defer file.Close()

	tmpl, err := template.New("desktop").Parse(desktopEntry)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	data := struct {
		ExePath string
	}{
		ExePath: exePath,
	}

	if err := tmpl.Execute(file, data); err != nil {
		return fmt.Errorf("failed to write desktop entry: %w", err)
	}

	return nil
}

func uninstall() error {

	var lastErr error

	if servicePath, err := getSystemdPath(); err == nil {
		if err := os.Remove(servicePath); err != nil && !os.IsNotExist(err) {
			lastErr = fmt.Errorf("failed to remove systemd service: %w", err)
		}
	}

	if autostartPath, err := getAutostartPath(); err == nil {
		if err := os.Remove(autostartPath); err != nil && !os.IsNotExist(err) {
			lastErr = fmt.Errorf("failed to remove autostart entry: %w", err)
		}
	}

	if targetPath, err := getTargetPath(); err == nil {
		os.Remove(targetPath)
	}

	return lastErr
}
