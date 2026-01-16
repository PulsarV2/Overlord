//go:build linux

package capture

import (
	"image"
)

var activeDisplays = func() int { return 0 }

var captureDisplayFn = func(int) (*image.RGBA, error) { return nil, nil }

func displayCount() int { return 0 }
