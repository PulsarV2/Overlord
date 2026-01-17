package handlers

import (
	"context"
	"log"
	"strings"

	"overlord-client/cmd/agent/runtime"
)

func HandleHelloAck(_ context.Context, env *runtime.Env, envelope map[string]interface{}) error {
	log.Printf("hello ack received")
	if env == nil || envelope == nil {
		return nil
	}

	var keywords []string
	minInterval := 0

	if raw, ok := envelope["notification"].(map[string]interface{}); ok {
		if rawKeywords, ok := raw["keywords"].([]interface{}); ok {
			for _, v := range rawKeywords {
				if s, ok := v.(string); ok {
					s = strings.TrimSpace(s)
					if s != "" {
						keywords = append(keywords, s)
					}
				}
			}
		}
		if v, ok := raw["minIntervalMs"].(float64); ok {
			minInterval = int(v)
		}
		if v, ok := raw["minIntervalMs"].(int); ok {
			minInterval = v
		}
	}

	if len(keywords) > 0 || minInterval > 0 {
		env.SetNotificationConfig(keywords, minInterval)
		log.Printf("hello ack: loaded %d notification keywords", len(keywords))
	}
	return nil
}
