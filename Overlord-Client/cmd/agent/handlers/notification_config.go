package handlers

import (
	"context"
	"log"
	"strings"

	"overlord-client/cmd/agent/runtime"
)

func HandleNotificationConfig(_ context.Context, env *runtime.Env, envelope map[string]interface{}) error {
	if env == nil || envelope == nil {
		return nil
	}

	var keywords []string
	minInterval := 0

	if raw, ok := envelope["keywords"].([]interface{}); ok {
		for _, v := range raw {
			if s, ok := v.(string); ok {
				s = strings.TrimSpace(s)
				if s != "" {
					keywords = append(keywords, s)
				}
			}
		}
	}
	if v, ok := envelope["minIntervalMs"].(float64); ok {
		minInterval = int(v)
	}
	if v, ok := envelope["minIntervalMs"].(int); ok {
		minInterval = v
	}

	env.SetNotificationConfig(keywords, minInterval)
	log.Printf("notification_config: loaded %d keywords", len(keywords))
	return nil
}
