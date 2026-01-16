package handlers

import (
	"context"
	"log"

	"overlord-client/cmd/agent/runtime"
)

func HandlePluginEvent(ctx context.Context, env *runtime.Env, envelope map[string]interface{}) error {
	if env.Plugins == nil {
		return nil
	}
	pluginID, _ := envelope["pluginId"].(string)
	event, _ := envelope["event"].(string)
	payload := envelope["payload"]
	if pluginID == "" || event == "" {
		log.Printf("plugin_event: missing pluginId or event")
		return nil
	}
	if err := env.Plugins.Dispatch(ctx, pluginID, event, payload); err != nil {
		log.Printf("plugin_event: dispatch failed for %s: %v", pluginID, err)
	}
	return nil
}
