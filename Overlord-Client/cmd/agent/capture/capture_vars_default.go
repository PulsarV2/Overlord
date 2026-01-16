//go:build !linux && !windows

package capture

import "github.com/kbinani/screenshot"

var (
	activeDisplays   = screenshot.NumActiveDisplays
	captureDisplayFn = screenshot.CaptureDisplay
)

func displayCount() int {
	return screenshot.NumActiveDisplays()
}
