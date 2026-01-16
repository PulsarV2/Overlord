package handlers

import (
	"bytes"
	"context"
	"image/jpeg"
	"log"

	"overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"

	"github.com/kbinani/screenshot"
)

func HandleScreenshot(ctx context.Context, env *runtime.Env, cmdID string) error {
	log.Printf("screenshot: capturing primary display")

	defer func() {
		if r := recover(); r != nil {
			log.Printf("screenshot: panic recovered: %v", r)
			wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
				Type:      "command_result",
				CommandID: cmdID,
				OK:        false,
				Message:   "screenshot capture panicked",
			})
		}
	}()

	n := screenshot.NumActiveDisplays()
	if n == 0 {
		log.Printf("screenshot: no active displays found")
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   "no active displays available",
		})
	}

	displayIndex := 0
	minX := int(1e9)
	minY := int(1e9)

	for i := 0; i < n; i++ {
		bounds := screenshot.GetDisplayBounds(i)

		if bounds.Min.X <= minX && bounds.Min.Y <= minY {
			minX = bounds.Min.X
			minY = bounds.Min.Y
			displayIndex = i
		}
	}

	log.Printf("screenshot: selected display %d out of %d displays", displayIndex, n)
	bounds := screenshot.GetDisplayBounds(displayIndex)
	img, err := screenshot.CaptureRect(bounds)
	if err != nil {
		log.Printf("screenshot: capture failed: %v", err)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   err.Error(),
		})
	}

	var buf bytes.Buffer
	opts := &jpeg.Options{Quality: 85}
	if err := jpeg.Encode(&buf, img, opts); err != nil {
		log.Printf("screenshot: jpeg encode failed: %v", err)
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   err.Error(),
		})
	}

	jpegData := buf.Bytes()
	log.Printf("screenshot: captured %dx%d, encoded %d bytes", bounds.Dx(), bounds.Dy(), len(jpegData))

	frame := wire.Frame{
		Type: "frame",
		Header: wire.FrameHeader{
			Monitor: displayIndex,
			FPS:     0,
			Format:  "jpeg",
		},
		Data: jpegData,
	}

	if err := wire.WriteMsg(ctx, env.Conn, frame); err != nil {
		log.Printf("screenshot: failed to send frame: %v", err)
		return err
	}

	return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        true,
	})
}
