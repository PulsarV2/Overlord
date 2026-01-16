package handlers

import (
	"context"
	"log"
	"time"

	"overlord-client/cmd/agent/capture"
	"overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

func HandlePing(ctx context.Context, env *runtime.Env, envelope map[string]interface{}) error {
	ts := extractTimestamp(envelope["ts"])
	if ts == 0 {
		ts = time.Now().UnixMilli()
	}
	log.Printf("ping: received ts=%d, sending pong", ts)
	pong := wire.Pong{Type: "pong", TS: ts}
	if err := wire.WriteMsg(ctx, env.Conn, pong); err != nil {
		log.Printf("ping: failed to send pong: %v", err)
		return err
	}
	log.Printf("ping: pong sent successfully")

	return capture.Now(ctx, env)
}
