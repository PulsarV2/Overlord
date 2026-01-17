package handlers

import (
	"context"
	"fmt"
	"log"

	"overlord-client/cmd/agent/runtime"
)

type Dispatcher struct {
	Env *runtime.Env
}

func NewDispatcher(env *runtime.Env) *Dispatcher {
	return &Dispatcher{Env: env}
}

func (d *Dispatcher) Dispatch(ctx context.Context, envelope map[string]interface{}) (err error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("dispatcher: panic: %v", r)
			err = fmt.Errorf("dispatcher panic: %v", r)
		}
	}()

	msgType := envelope["type"]
	switch msgType {
	case "hello_ack":
		return HandleHelloAck(ctx, d.Env, envelope)
	case "ping":
		log.Printf("dispatcher: received ping")
		return HandlePing(ctx, d.Env, envelope)
	case "command":
		log.Printf("dispatcher: handling command type=%s", envelope["commandType"])
		return HandleCommand(ctx, d.Env, envelope)
	case "plugin_event":
		return HandlePluginEvent(ctx, d.Env, envelope)
	case "notification_config":
		return HandleNotificationConfig(ctx, d.Env, envelope)
	case "command_abort":
		cmdID, _ := envelope["commandId"].(string)
		if cmdID != "" {
			if cancelCommand(cmdID) {
				log.Printf("dispatcher: cancelled command %s", cmdID)
			} else {
				log.Printf("dispatcher: command %s not found or already completed", cmdID)
			}
		}
		return nil
	default:
		log.Printf("dispatcher: unknown message type=%v", msgType)
		return nil
	}
}
