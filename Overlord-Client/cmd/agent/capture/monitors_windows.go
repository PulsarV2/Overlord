//go:build windows

package capture

import (
	"image"
	"log"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procEnumDisplayMonitors  = user32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfoW      = user32.NewProc("GetMonitorInfoW")
	procEnumDisplaySettingsW = user32.NewProc("EnumDisplaySettingsW")
)

type rect struct {
	left   int32
	top    int32
	right  int32
	bottom int32
}

type monitorInfoEx struct {
	cbSize    uint32
	rcMonitor rect
	rcWork    rect
	dwFlags   uint32
	szDevice  [32]uint16
}

type devMode struct {
	dmDeviceName         [32]uint16
	dmSpecVersion        uint16
	dmDriverVersion      uint16
	dmSize               uint16
	dmDriverExtra        uint16
	dmFields             uint32
	dmPositionX          int32
	dmPositionY          int32
	dmDisplayOrientation uint32
	dmDisplayFixedOutput uint32
	dmColor              int16
	dmDuplex             int16
	dmYResolution        int16
	dmTTOption           int16
	dmCollate            int16
	dmFormName           [32]uint16
	dmLogPixels          uint16
	dmBitsPerPel         uint32
	dmPelsWidth          uint32
	dmPelsHeight         uint32
	dmDisplayFlags       uint32
	dmDisplayFrequency   uint32
	dmICMMethod          uint32
	dmICMIntent          uint32
	dmMediaType          uint32
	dmDitherType         uint32
	dmReserved1          uint32
	dmReserved2          uint32
	dmPanningWidth       uint32
	dmPanningHeight      uint32
}

const (
	monitorInfofPrimary = 1
	enumCurrentSettings = 0xFFFFFFFF
)

type monitorDesc struct {
	name     string
	rect     image.Rectangle
	workRect image.Rectangle
	primary  bool
	physW    int
	physH    int
	scale    float64
}

var (
	monitorsCache atomic.Value
	monitorsMu    sync.Mutex
	monitorsTs    int64
)

func displayCount() int {
	return len(monitorList())
}

func displayBounds(idx int) image.Rectangle {
	mons := monitorList()
	if idx >= 0 && idx < len(mons) {
		return mons[idx].rect
	}

	if len(mons) > 0 {
		return mons[0].rect
	}

	w := int(getSystemMetric(SM_CXSCREEN))
	h := int(getSystemMetric(SM_CYSCREEN))
	return image.Rect(0, 0, w, h)
}

func displayScale(idx int) float64 {
	mons := monitorList()
	if idx >= 0 && idx < len(mons) {
		if mons[idx].scale > 0 {
			return mons[idx].scale
		}
	}
	return 1.0
}

func monitorList() []monitorDesc {
	if v, ok := monitorsCache.Load().([]monitorDesc); ok && len(v) > 0 && time.Since(time.Unix(0, monitorsTs)) < 30*time.Second {
		return v
	}

	monitorsMu.Lock()
	defer monitorsMu.Unlock()

	if v, ok := monitorsCache.Load().([]monitorDesc); ok && len(v) > 0 && time.Since(time.Unix(0, monitorsTs)) < 30*time.Second {
		return v
	}

	mons := enumerateMonitors()
	monitorsCache.Store(mons)
	monitorsTs = time.Now().UnixNano()
	logMonitors(mons)
	return mons
}

func enumerateMonitors() []monitorDesc {
	var result []monitorDesc

	cb := syscall.NewCallback(func(hMonitor, hdc, lprcMonitor, lparam uintptr) uintptr {
		var mi monitorInfoEx
		mi.cbSize = uint32(unsafe.Sizeof(mi))
		if ret, _, _ := procGetMonitorInfoW.Call(hMonitor, uintptr(unsafe.Pointer(&mi))); ret == 0 {
			return 1
		}

		name := windows.UTF16ToString(mi.szDevice[:])
		primary := mi.dwFlags&monitorInfofPrimary != 0

		var dm devMode
		dm.dmSize = uint16(unsafe.Sizeof(dm))
		var physW, physH int
		var scale float64 = 1.0
		if ret, _, _ := procEnumDisplaySettingsW.Call(uintptr(unsafe.Pointer(&mi.szDevice[0])), enumCurrentSettings, uintptr(unsafe.Pointer(&dm))); ret != 0 {
			physW = int(dm.dmPelsWidth)
			physH = int(dm.dmPelsHeight)
			vw := int(mi.rcMonitor.right - mi.rcMonitor.left)
			if vw > 0 {
				scale = float64(dm.dmPelsWidth) / float64(vw)
			}
		}

		r := image.Rect(int(mi.rcMonitor.left), int(mi.rcMonitor.top), int(mi.rcMonitor.right), int(mi.rcMonitor.bottom))
		w := image.Rect(int(mi.rcWork.left), int(mi.rcWork.top), int(mi.rcWork.right), int(mi.rcWork.bottom))

		result = append(result, monitorDesc{
			name:     name,
			rect:     r,
			workRect: w,
			primary:  primary,
			physW:    physW,
			physH:    physH,
			scale:    scale,
		})
		return 1
	})

	if ret, _, _ := procEnumDisplayMonitors.Call(0, 0, cb, 0); ret == 0 {

		w := int(getSystemMetric(SM_CXSCREEN))
		h := int(getSystemMetric(SM_CYSCREEN))
		return []monitorDesc{{
			name:    "Primary",
			rect:    image.Rect(0, 0, w, h),
			primary: true,
			physW:   w,
			physH:   h,
			scale:   1.0,
		}}
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].primary != result[j].primary {
			return result[i].primary
		}
		oi := deviceOrdinal(result[i].name)
		oj := deviceOrdinal(result[j].name)
		if oi >= 0 && oj >= 0 && oi != oj {
			return oi < oj
		}
		if result[i].rect.Min.Y == result[j].rect.Min.Y {
			return result[i].rect.Min.X < result[j].rect.Min.X
		}
		return result[i].rect.Min.Y < result[j].rect.Min.Y
	})

	return result
}

func deviceOrdinal(name string) int {
	name = strings.TrimSpace(name)
	end := len(name)
	start := end
	for start > 0 {
		c := name[start-1]
		if c < '0' || c > '9' {
			break
		}
		start--
	}
	if start == end {
		return -1
	}
	n, err := strconv.Atoi(name[start:end])
	if err != nil {
		return -1
	}
	return n
}

func logMonitors(mons []monitorDesc) {
	log.Printf("capture: detected %d monitor(s)", len(mons))
	for i, m := range mons {
		log.Printf("capture: monitor %d name=%q primary=%v virtual=%v phys=%dx%d scale=%.2f", i, m.name, m.primary, m.rect, m.physW, m.physH, m.scale)
	}
}
