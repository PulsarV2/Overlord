//go:build darwin
// +build darwin

package persistence

import (
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"text/template"
)

const launchAgentPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.overlord.agent</string>
	<key>ProgramArguments</key>
	<array>
		<string>{{.ExePath}}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/tmp/overlord-agent.log</string>
	<key>StandardErrorPath</key>
	<string>/tmp/overlord-agent-error.log</string>
</dict>
</plist>
`

func getPlistPath() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(usr.HomeDir, "Library", "LaunchAgents", "com.overlord.agent.plist"), nil
}

func getTargetPath() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(usr.HomeDir, "Library", "Application Support", "Overlord", "agent"), nil
}

func install(exePath string) error {

	targetPath, err := getTargetPath()
	if err != nil {
		return fmt.Errorf("failed to get target path: %w", err)
	}

	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create Overlord directory: %w", err)
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

	plistPath, err := getPlistPath()
	if err != nil {
		return fmt.Errorf("failed to get plist path: %w", err)
	}

	launchAgentsDir := filepath.Dir(plistPath)
	if err := os.MkdirAll(launchAgentsDir, 0755); err != nil {
		return fmt.Errorf("failed to create LaunchAgents directory: %w", err)
	}

	file, err := os.Create(plistPath)
	if err != nil {
		return fmt.Errorf("failed to create plist file: %w", err)
	}
	defer file.Close()

	tmpl, err := template.New("plist").Parse(launchAgentPlist)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	data := struct {
		ExePath string
	}{
		ExePath: targetPath,
	}

	if err := tmpl.Execute(file, data); err != nil {
		return fmt.Errorf("failed to write plist file: %w", err)
	}

	return nil
}

func uninstall() error {
	plistPath, err := getPlistPath()
	if err != nil {
		return fmt.Errorf("failed to get plist path: %w", err)
	}

	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove plist file: %w", err)
	}

	if targetPath, err := getTargetPath(); err == nil {
		os.Remove(targetPath)
	}

	return nil
}
