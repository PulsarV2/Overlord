package wire

import (
	"context"

	"github.com/vmihailenco/msgpack/v5"
	"nhooyr.io/websocket"
)

type Writer interface {
	Write(ctx context.Context, messageType websocket.MessageType, p []byte) error
}

func WriteMsg(ctx context.Context, w Writer, v interface{}) error {
	payload, err := msgpack.Marshal(v)
	if err != nil {
		return err
	}
	return w.Write(ctx, websocket.MessageBinary, payload)
}
