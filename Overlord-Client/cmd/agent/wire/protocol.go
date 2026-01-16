package wire

type Hello struct {
	Type     string `msgpack:"type"`
	ID       string `msgpack:"id"`
	HWID     string `msgpack:"hwid"`
	Host     string `msgpack:"host"`
	OS       string `msgpack:"os"`
	Arch     string `msgpack:"arch"`
	Version  string `msgpack:"version"`
	User     string `msgpack:"user"`
	Monitors int    `msgpack:"monitors"`
	Country  string `msgpack:"country,omitempty"`
}

type Ping struct {
	Type string `msgpack:"type"`
	TS   int64  `msgpack:"ts,omitempty"`
}

type Pong struct {
	Type string `msgpack:"type"`
	TS   int64  `msgpack:"ts,omitempty"`
}

type Command struct {
	Type        string      `msgpack:"type"`
	CommandType string      `msgpack:"commandType"`
	Payload     interface{} `msgpack:"payload,omitempty"`
	ID          string      `msgpack:"id,omitempty"`
}

type CommandResult struct {
	Type      string `msgpack:"type"`
	CommandID string `msgpack:"commandId,omitempty"`
	OK        bool   `msgpack:"ok"`
	Message   string `msgpack:"message,omitempty"`
}

type FrameHeader struct {
	Monitor int    `msgpack:"monitor"`
	FPS     int    `msgpack:"fps"`
	Format  string `msgpack:"format"`
}

type Frame struct {
	Type   string      `msgpack:"type"`
	Header FrameHeader `msgpack:"header"`
	Data   []byte      `msgpack:"data"`
}

type ConsoleOutput struct {
	Type      string `msgpack:"type"`
	SessionID string `msgpack:"sessionId"`
	Data      []byte `msgpack:"data,omitempty"`
	ExitCode  *int   `msgpack:"exitCode,omitempty"`
	Error     string `msgpack:"error,omitempty"`
}

type FileEntry struct {
	Name    string `msgpack:"name"`
	Path    string `msgpack:"path"`
	IsDir   bool   `msgpack:"isDir"`
	Size    int64  `msgpack:"size"`
	ModTime int64  `msgpack:"modTime"`
	Mode    string `msgpack:"mode,omitempty"`
	Owner   string `msgpack:"owner,omitempty"`
	Group   string `msgpack:"group,omitempty"`
}

type FileListResult struct {
	Type      string      `msgpack:"type"`
	CommandID string      `msgpack:"commandId,omitempty"`
	Path      string      `msgpack:"path"`
	Entries   []FileEntry `msgpack:"entries"`
	Error     string      `msgpack:"error,omitempty"`
}

type FileDownload struct {
	Type      string `msgpack:"type"`
	CommandID string `msgpack:"commandId,omitempty"`
	Path      string `msgpack:"path"`
	Data      []byte `msgpack:"data"`
	Offset    int64  `msgpack:"offset"`
	Total     int64  `msgpack:"total"`
	Error     string `msgpack:"error,omitempty"`
}

type FileUploadResult struct {
	Type      string `msgpack:"type"`
	CommandID string `msgpack:"commandId,omitempty"`
	Path      string `msgpack:"path"`
	OK        bool   `msgpack:"ok"`
	Error     string `msgpack:"error,omitempty"`
}

type ProcessInfo struct {
	PID      int32   `msgpack:"pid"`
	PPID     int32   `msgpack:"ppid"`
	Name     string  `msgpack:"name"`
	CPU      float64 `msgpack:"cpu"`
	Memory   uint64  `msgpack:"memory"`
	Username string  `msgpack:"username,omitempty"`
	Type     string  `msgpack:"type,omitempty"`
}

type ProcessListResult struct {
	Type      string        `msgpack:"type"`
	CommandID string        `msgpack:"commandId,omitempty"`
	Processes []ProcessInfo `msgpack:"processes"`
	Error     string        `msgpack:"error,omitempty"`
}

type FileReadResult struct {
	Type      string `msgpack:"type"`
	CommandID string `msgpack:"commandId,omitempty"`
	Path      string `msgpack:"path"`
	Content   string `msgpack:"content"`
	IsBinary  bool   `msgpack:"isBinary"`
	Error     string `msgpack:"error,omitempty"`
}

type FileSearchMatch struct {
	Path  string `msgpack:"path"`
	Line  int    `msgpack:"line,omitempty"`
	Match string `msgpack:"match,omitempty"`
}

type FileSearchResult struct {
	Type      string            `msgpack:"type"`
	CommandID string            `msgpack:"commandId,omitempty"`
	SearchID  string            `msgpack:"searchId"`
	Results   []FileSearchMatch `msgpack:"results"`
	Complete  bool              `msgpack:"complete"`
	Error     string            `msgpack:"error,omitempty"`
}

type ScriptResult struct {
	Type      string `msgpack:"type"`
	CommandID string `msgpack:"commandId,omitempty"`
	OK        bool   `msgpack:"ok"`
	Output    string `msgpack:"output"`
	Error     string `msgpack:"error,omitempty"`
}

type PluginEvent struct {
	Type     string      `msgpack:"type"`
	PluginID string      `msgpack:"pluginId"`
	Event    string      `msgpack:"event"`
	Payload  interface{} `msgpack:"payload,omitempty"`
	Error    string      `msgpack:"error,omitempty"`
}
