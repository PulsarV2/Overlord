package plugins

import (
	"context"
	"errors"
	"io"
	"log"
	"sync"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/vmihailenco/msgpack/v5"

	"overlord-client/cmd/agent/wire"
)

type Manager struct {
	mu      sync.Mutex
	plugins map[string]*pluginInstance
	pending map[string]*pendingBundle
	writer  wire.Writer
	host    HostInfo
}

type pluginInstance struct {
	id       string
	manifest PluginManifest
	ctx      context.Context
	cancel   context.CancelFunc
	runtime  wazero.Runtime
	module   api.Module
	stdin    io.WriteCloser
	stdout   io.ReadCloser
	stderr   io.ReadCloser
	enc      *msgpack.Encoder
	dec      *msgpack.Decoder
	encMu    sync.Mutex
}

type pendingBundle struct {
	manifest    PluginManifest
	totalSize   int
	totalChunks int
	chunks      map[int][]byte
	received    int
	receivedSz  int
}

func NewManager(writer wire.Writer, host HostInfo) *Manager {
	return &Manager{
		plugins: make(map[string]*pluginInstance),
		pending: make(map[string]*pendingBundle),
		writer:  writer,
		host:    host,
	}
}

func (m *Manager) StartBundle(manifest PluginManifest, totalSize int, totalChunks int) error {
	if manifest.ID == "" {
		return errors.New("missing plugin id")
	}
	if totalChunks <= 0 {
		return errors.New("invalid total chunks")
	}
	if totalSize <= 0 {
		return errors.New("invalid total size")
	}
	if totalChunks > 10000 {
		return errors.New("too many chunks")
	}

	m.mu.Lock()
	m.pending[manifest.ID] = &pendingBundle{
		manifest:    manifest,
		totalSize:   totalSize,
		totalChunks: totalChunks,
		chunks:      make(map[int][]byte),
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) AddChunk(pluginId string, index int, data []byte) error {
	if pluginId == "" {
		return errors.New("missing plugin id")
	}
	if index < 0 {
		return errors.New("invalid chunk index")
	}

	m.mu.Lock()
	b := m.pending[pluginId]
	if b == nil {
		m.mu.Unlock()
		return errors.New("bundle not initialized")
	}
	if _, exists := b.chunks[index]; !exists {
		b.chunks[index] = data
		b.received++
		b.receivedSz += len(data)
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) FinalizeBundle(ctx context.Context, pluginId string) error {
	m.mu.Lock()
	b := m.pending[pluginId]
	if b == nil {
		m.mu.Unlock()
		return errors.New("bundle not initialized")
	}
	if b.received < b.totalChunks {
		m.mu.Unlock()
		return errors.New("bundle incomplete")
	}

	chunks := make([][]byte, b.totalChunks)
	for i := 0; i < b.totalChunks; i++ {
		chunks[i] = b.chunks[i]
		if chunks[i] == nil {
			m.mu.Unlock()
			return errors.New("missing chunk")
		}
	}
	manifest := b.manifest
	delete(m.pending, pluginId)
	m.mu.Unlock()

	combined := make([]byte, 0, b.totalSize)
	for _, part := range chunks {
		combined = append(combined, part...)
	}
	return m.Load(ctx, manifest, combined)
}

func (m *Manager) Load(ctx context.Context, manifest PluginManifest, wasm []byte) error {
	if len(wasm) == 0 {
		return errors.New("empty wasm payload")
	}
	pluginID := manifest.ID
	if pluginID == "" {
		return errors.New("missing plugin id")
	}

	m.mu.Lock()
	if existing, ok := m.plugins[pluginID]; ok {
		_ = existing.Close()
		delete(m.plugins, pluginID)
	}
	m.mu.Unlock()

	runtimeCtx, cancel := context.WithCancel(ctx)
	rt := wazero.NewRuntime(runtimeCtx)
	if _, err := wasi_snapshot_preview1.Instantiate(runtimeCtx, rt); err != nil {
		cancel()
		return err
	}

	stdinR, stdinW := io.Pipe()
	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()

	config := wazero.NewModuleConfig().
		WithStdin(stdinR).
		WithStdout(stdoutW).
		WithStderr(stderrW).
		WithStartFunctions()

	compiled, err := rt.CompileModule(runtimeCtx, wasm)
	if err != nil {
		cancel()
		return err
	}

	module, err := rt.InstantiateModule(runtimeCtx, compiled, config)
	if err != nil {
		cancel()
		return err
	}

	pi := &pluginInstance{
		id:       pluginID,
		manifest: manifest,
		ctx:      runtimeCtx,
		cancel:   cancel,
		runtime:  rt,
		module:   module,
		stdin:    stdinW,
		stdout:   stdoutR,
		stderr:   stderrR,
		enc:      msgpack.NewEncoder(stdinW),
		dec:      msgpack.NewDecoder(stdoutR),
	}

	go m.readLoop(pi)
	go m.readStderr(pi)

	if start := module.ExportedFunction("_start"); start != nil {
		go func() {
			if _, err := start.Call(runtimeCtx); err != nil {
				log.Printf("[plugin] %s _start error: %v", pluginID, err)
			}
		}()
	}

	if err := m.sendInit(pi); err != nil {
		_ = pi.Close()
		return err
	}

	m.mu.Lock()
	m.plugins[pluginID] = pi
	m.mu.Unlock()

	log.Printf("[plugin] loaded %s", pluginID)
	return nil
}

func (m *Manager) Dispatch(ctx context.Context, pluginId, event string, payload interface{}) error {
	m.mu.Lock()
	pi := m.plugins[pluginId]
	m.mu.Unlock()
	if pi == nil {
		return nil
	}
	msg := PluginMessage{Type: "event", Event: event, Payload: payload}
	return m.sendMessage(ctx, pi, msg)
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, pi := range m.plugins {
		_ = pi.Close()
		delete(m.plugins, id)
	}
}

func (m *Manager) Unload(pluginId string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if pi, ok := m.plugins[pluginId]; ok {
		_ = pi.Close()
		delete(m.plugins, pluginId)
	}
}

func (m *Manager) sendInit(pi *pluginInstance) error {
	payload := map[string]interface{}{
		"manifest": pi.manifest,
		"host":     m.host,
	}
	msg := PluginMessage{Type: "init", Payload: payload}
	return m.sendMessage(context.Background(), pi, msg)
}

func (m *Manager) sendMessage(ctx context.Context, pi *pluginInstance, msg PluginMessage) error {
	pi.encMu.Lock()
	defer pi.encMu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return pi.enc.Encode(msg)
	}
}

func (m *Manager) readLoop(pi *pluginInstance) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[plugin] %s read loop panic: %v", pi.id, r)
		}
	}()
	for {
		var msg map[string]interface{}
		if err := pi.dec.Decode(&msg); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) {
				return
			}
			log.Printf("[plugin] %s read error: %v", pi.id, err)
			return
		}
		m.handlePluginMessage(pi.id, msg)
	}
}

func (m *Manager) readStderr(pi *pluginInstance) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[plugin] %s stderr loop panic: %v", pi.id, r)
		}
	}()
	buf := make([]byte, 4096)
	for {
		n, err := pi.stderr.Read(buf)
		if n > 0 {
			log.Printf("[plugin] %s stderr: %s", pi.id, string(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

func (m *Manager) handlePluginMessage(pluginId string, msg map[string]interface{}) {
	msgType, _ := msg["type"].(string)
	if msgType == "log" {
		log.Printf("[plugin] %s log: %v", pluginId, msg["payload"])
		return
	}
	if msgType == "event" {
		event, _ := msg["event"].(string)
		payload := msg["payload"]
		if event == "" {
			return
		}
		err := wire.WriteMsg(context.Background(), m.writer, wire.PluginEvent{
			Type:     "plugin_event",
			PluginID: pluginId,
			Event:    event,
			Payload:  payload,
		})
		if err != nil {
			log.Printf("[plugin] %s send event error: %v", pluginId, err)
		}
		return
	}
}

func (pi *pluginInstance) Close() error {
	pi.cancel()
	_ = pi.stdin.Close()
	_ = pi.stdout.Close()
	_ = pi.stderr.Close()
	if pi.module != nil {
		_ = pi.module.Close(context.Background())
	}
	if pi.runtime != nil {
		_ = pi.runtime.Close(context.Background())
	}
	return nil
}
