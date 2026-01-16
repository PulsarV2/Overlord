//go:build !windows

package capture

import (
	"image"
)

func SetCursorCapture(enabled bool) {}

func DrawCursorOnImage(img *image.RGBA, captureBounds image.Rectangle) {
	// if you're not windows fuck you
}
