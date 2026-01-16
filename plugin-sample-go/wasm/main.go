package main

import (
	"log"
	"os"

	"github.com/vmihailenco/msgpack/v5"
)

type Incoming struct {
	Type    string      `msgpack:"type"`
	Event   string      `msgpack:"event,omitempty"`
	Payload interface{} `msgpack:"payload,omitempty"`
}

type Outgoing struct {
	Type    string      `msgpack:"type"`
	Event   string      `msgpack:"event,omitempty"`
	Payload interface{} `msgpack:"payload,omitempty"`
}

type UiMessage struct {
	Message string `msgpack:"message"`
}

func main() {
	dec := msgpack.NewDecoder(os.Stdin)
	enc := msgpack.NewEncoder(os.Stdout)

	for {
		var msg Incoming
		if err := dec.Decode(&msg); err != nil {
			log.Printf("decode error: %v", err)
			return
		}

		switch msg.Type {
		case "init":
			_ = enc.Encode(Outgoing{Type: "event", Event: "ready", Payload: "sample plugin ready"})
		case "event":
			if msg.Event == "ui_message" {
				payloadBytes, _ := msgpack.Marshal(msg.Payload)
				var ui UiMessage
				_ = msgpack.Unmarshal(payloadBytes, &ui)
				_ = enc.Encode(Outgoing{Type: "event", Event: "echo", Payload: ui.Message})
			}
		}
	}
}
