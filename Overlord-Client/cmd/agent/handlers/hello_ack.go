package handlers

import (
	"context"
	"log"

	"overlord-client/cmd/agent/runtime"
)

func HandleHelloAck(_ context.Context, _ *runtime.Env, _ map[string]interface{}) error {
	log.Printf("hello ack received")
	return nil
}
