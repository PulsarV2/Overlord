package console

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"

	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

type session struct {
	id     string
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	cancel context.CancelFunc
	env    *rt.Env
	closed chan struct{}
	once   sync.Once
}

var sessions sync.Map

func shellCommand() []string {
	if runtime.GOOS == "windows" {
		return []string{"cmd.exe", "/d"}
	}

	return []string{"/bin/sh"}
}

func Start(ctx context.Context, env *rt.Env, sessionID string, _ int, _ int) error {
	if sessionID == "" {
		return errors.New("session id required")
	}

	Stop(sessionID)

	parts := shellCommand()
	cctx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(cctx, parts[0], parts[1:]...)
	if attr := platformSysProcAttr(); attr != nil {
		cmd.SysProcAttr = attr
	}
	cmd.Env = append(os.Environ(), "CLINK_NOAUTORUN=1")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return err
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return err
	}

	sess := &session{id: sessionID, cmd: cmd, stdin: stdin, cancel: cancel, env: env, closed: make(chan struct{})}
	sessions.Store(sessionID, sess)

	go sess.forwardOutput(stdout)
	go sess.forwardOutput(stderr)
	go sess.waitExit()

	return nil
}

func Stop(sessionID string) {
	val, ok := sessions.LoadAndDelete(sessionID)
	if !ok {
		return
	}
	sess := val.(*session)
	sess.cancel()
	if sess.cmd.Process != nil {
		_ = sess.cmd.Process.Kill()
	}
	sess.once.Do(func() { close(sess.closed) })
}

func Input(sessionID string, data string) error {
	val, ok := sessions.Load(sessionID)
	if !ok {
		return errors.New("session not found")
	}
	sess := val.(*session)
	if sess.stdin == nil {
		return errors.New("stdin missing")
	}
	_, err := sess.stdin.Write([]byte(data))
	return err
}

func Resize(_ string, _ int, _ int) {

}

func (s *session) forwardOutput(r io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			clean := stripBackspaces(buf[:n])
			if len(clean) > 0 {
				_ = sendOutput(s.env, s.id, clean, nil, "")
			}
		}
		if err != nil {
			return
		}
	}
}

func (s *session) waitExit() {
	err := s.cmd.Wait()
	var codePtr *int
	msg := ""
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code := exitErr.ExitCode()
			codePtr = &code
		} else {
			msg = err.Error()
		}
	} else {
		code := 0
		codePtr = &code
	}
	_ = sendOutput(s.env, s.id, nil, codePtr, msg)
	sessions.Delete(s.id)
	s.once.Do(func() { close(s.closed) })
}

func sendOutput(env *rt.Env, sessionID string, data []byte, exitCode *int, errMsg string) error {
	payload := wire.ConsoleOutput{Type: "console_output", SessionID: sessionID}
	if len(data) > 0 {
		payload.Data = data
	}
	if errMsg != "" {
		payload.Error = errMsg
	}
	if exitCode != nil {
		payload.ExitCode = exitCode
	}
	return wire.WriteMsg(context.Background(), env.Conn, payload)
}

func stripBackspaces(src []byte) []byte {
	out := make([]byte, 0, len(src))
	for _, b := range src {
		if b == '\b' {
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
			continue
		}
		out = append(out, b)
	}
	return out
}
