package config

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"runtime"
	"strings"
	"time"
)

const AgentVersion = "0"

var DefaultPersistence = "false"
var DefaultServerURL = "wss://10.0.0.37:5173"
var DefaultID = ""
var DefaultCountry = ""
var DefaultAgentToken = ""

const settingsFile = "config/settings.json"
const serverIndexFile = "config/server_index.json"

type settings struct {
	ID      string `json:"id"`
	HWID    string `json:"hwid"`
	Country string `json:"country"`
	Version string `json:"version"`
}

type serverIndexData struct {
	LastWorkingIndex int `json:"last_working_index"`
}

type Config struct {
	ServerURLs            []string
	ServerIndex           int
	ID                    string
	HWID                  string
	Country               string
	OS                    string
	Arch                  string
	Version               string
	AgentToken            string
	CaptureInterval       time.Duration
	DisableCapture        bool
	EnablePersistence     bool
	TLSInsecureSkipVerify bool
	TLSCAPath             string
	TLSClientCert         string
	TLSClientKey          string
}

func Load() Config {
	server := strings.TrimSpace(os.Getenv("OVERLORD_SERVER"))
	if server == "" {
		server = DefaultServerURL
	}

	serverURLs := []string{}
	for _, url := range strings.Split(server, ",") {
		url = strings.TrimSpace(url)
		if url != "" {
			url = strings.TrimRight(url, "/")
			serverURLs = append(serverURLs, url)
		}
	}

	serverIndex := loadServerIndex()

	fileSettings := readSettings()
	defaultHWID := deriveHWID()
	defaultID := defaultHWID
	interval := 20 * time.Second
	if v := strings.TrimSpace(os.Getenv("OVERLORD_CAPTURE_INTERVAL")); v != "" {
		if parsed, err := time.ParseDuration(v); err == nil && parsed > 0 {
			interval = parsed
		}
	}

	disableCapture := false
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("OVERLORD_DISABLE_CAPTURE"))); v != "" {
		disableCapture = v == "true" || v == "1" || v == "yes"
	}

	enablePersistence := strings.ToLower(DefaultPersistence) == "true"
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("OVERLORD_ENABLE_PERSISTENCE"))); v != "" {
		enablePersistence = v == "true" || v == "1" || v == "yes"
	}

	tlsInsecureSkipVerify := true
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("OVERLORD_TLS_INSECURE_SKIP_VERIFY"))); v != "" {
		tlsInsecureSkipVerify = v == "true" || v == "1" || v == "yes"
	}
	tlsCAPath := strings.TrimSpace(os.Getenv("OVERLORD_TLS_CA"))
	tlsClientCert := strings.TrimSpace(os.Getenv("OVERLORD_TLS_CLIENT_CERT"))
	tlsClientKey := strings.TrimSpace(os.Getenv("OVERLORD_TLS_CLIENT_KEY"))

	agentToken := strings.TrimSpace(os.Getenv("OVERLORD_AGENT_TOKEN"))
	tokenSource := "env"
	if agentToken == "" {
		agentToken = DefaultAgentToken
		tokenSource = "build-time"
	}

	if agentToken != "" {
		log.Printf("[config] Agent token loaded from %s (len=%d)", tokenSource, len(agentToken))
	} else {
		log.Printf("[config] WARNING: No agent token configured (neither env nor build-time)")
	}

	return Config{
		ServerURLs:            serverURLs,
		ServerIndex:           serverIndex,
		ID:                    firstNonEmpty(fileSettings.ID, DefaultID, defaultID),
		HWID:                  firstNonEmpty(fileSettings.HWID, defaultHWID),
		EnablePersistence:     enablePersistence,
		Country:               firstNonEmpty(strings.TrimSpace(fileSettings.Country), DefaultCountry),
		OS:                    runtime.GOOS,
		Arch:                  runtime.GOARCH,
		Version:               firstNonEmpty(fileSettings.Version, AgentVersion),
		AgentToken:            agentToken,
		CaptureInterval:       interval,
		DisableCapture:        disableCapture,
		TLSInsecureSkipVerify: tlsInsecureSkipVerify,
		TLSCAPath:             tlsCAPath,
		TLSClientCert:         tlsClientCert,
		TLSClientKey:          tlsClientKey,
	}
}

func loadServerIndex() int {
	bytes, err := os.ReadFile(serverIndexFile)
	if err != nil {
		return 0
	}
	var data serverIndexData
	if err := json.Unmarshal(bytes, &data); err != nil {
		return 0
	}
	return data.LastWorkingIndex
}

func SaveServerIndex(index int) error {
	data := serverIndexData{LastWorkingIndex: index}
	bytes, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(serverIndexFile, bytes, 0644)
}

func readSettings() settings {
	bytes, err := os.ReadFile(settingsFile)
	if err != nil {
		return settings{}
	}
	var s settings
	if err := json.Unmarshal(bytes, &s); err != nil {
		return settings{}
	}
	return s
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func deriveHWID() string {
	h := sha256.New()
	h.Write([]byte(hostname()))
	h.Write([]byte("|"))
	h.Write([]byte(os.Getenv("USERNAME")))
	h.Write([]byte("|"))
	h.Write([]byte(runtime.GOOS))
	h.Write([]byte("|"))
	h.Write([]byte(runtime.GOARCH))
	return hex.EncodeToString(h.Sum(nil))
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}
