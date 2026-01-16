//go:build windows

package capture

import (
	"image"
	"log"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32                     = syscall.NewLazyDLL("user32.dll")
	gdi32                      = syscall.NewLazyDLL("gdi32.dll")
	shcore                     = syscall.NewLazyDLL("shcore.dll")
	procGetDC                  = user32.NewProc("GetDC")
	procReleaseDC              = user32.NewProc("ReleaseDC")
	procGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procBitBlt                 = gdi32.NewProc("BitBlt")
	procStretchBlt             = gdi32.NewProc("StretchBlt")
	procGetDIBits              = gdi32.NewProc("GetDIBits")
	procSetProcessDpiAwareness = shcore.NewProc("SetProcessDpiAwareness")
)

const (
	SM_CXSCREEN                   = 0
	SM_CYSCREEN                   = 1
	SRCCOPY                       = 0x00CC0020
	COLORONCOLOR                  = 3
	BI_RGB                        = 0
	BI_BITFIELDS                  = 3
	DIB_RGB_COLORS                = 0
	PROCESS_PER_MONITOR_DPI_AWARE = 2
)

type bitmapInfoHeader struct {
	biSize          uint32
	biWidth         int32
	biHeight        int32
	biPlanes        uint16
	biBitCount      uint16
	biCompression   uint32
	biSizeImage     uint32
	biXPelsPerMeter int32
	biYPelsPerMeter int32
	biClrUsed       uint32
	biClrImportant  uint32
}

type bitmapInfo struct {
	bmiHeader bitmapInfoHeader
	redMask   uint32
	greenMask uint32
	blueMask  uint32
	alphaMask uint32
}

func getSystemMetric(i int32) int32 {
	r, _, _ := procGetSystemMetrics.Call(uintptr(i))
	return int32(r)
}

func getDC(hwnd uintptr) uintptr {
	dc, _, _ := procGetDC.Call(hwnd)
	return dc
}

func releaseDC(hwnd, hdc uintptr) {
	_, _, _ = procReleaseDC.Call(hwnd, hdc)
}

func createCompatibleDC(hdc uintptr) uintptr {
	r, _, _ := procCreateCompatibleDC.Call(hdc)
	return r
}

func deleteDC(hdc uintptr) {
	_, _, _ = procDeleteDC.Call(hdc)
}

func createCompatibleBitmap(hdc uintptr, w, h int32) uintptr {
	r, _, _ := procCreateCompatibleBitmap.Call(hdc, uintptr(w), uintptr(h))
	return r
}

func deleteObject(obj uintptr) {
	_, _, _ = procDeleteObject.Call(obj)
}

func selectObject(hdc, hgdiobj uintptr) uintptr {
	r, _, _ := procSelectObject.Call(hdc, hgdiobj)
	return r
}

func bitBlt(hdcDest uintptr, x, y, cx, cy int32, hdcSrc uintptr, x1, y1 int32, rop uint32) bool {
	r, _, _ := procBitBlt.Call(hdcDest, uintptr(x), uintptr(y), uintptr(cx), uintptr(cy), hdcSrc, uintptr(x1), uintptr(y1), uintptr(rop))
	return r != 0
}

func stretchBlt(hdcDest uintptr, x, y, cx, cy int32, hdcSrc uintptr, x1, y1, cx1, cy1 int32, rop uint32) bool {
	r, _, _ := procStretchBlt.Call(hdcDest, uintptr(x), uintptr(y), uintptr(cx), uintptr(cy), hdcSrc, uintptr(x1), uintptr(y1), uintptr(cx1), uintptr(cy1), uintptr(rop))
	return r != 0
}

func getDIBits(hdc uintptr, hbmp uintptr, start, lines uint32, bits unsafe.Pointer, bmi *bitmapInfo, usage uint32) int {
	r, _, _ := procGetDIBits.Call(hdc, hbmp, uintptr(start), uintptr(lines), uintptr(bits), uintptr(unsafe.Pointer(bmi)), uintptr(usage))
	return int(r)
}

var dpiAwareOnce sync.Once

func setDPIAware() {
	dpiAwareOnce.Do(func() {

		if procSetProcessDpiAwareness.Find() == nil {
			procSetProcessDpiAwareness.Call(uintptr(PROCESS_PER_MONITOR_DPI_AWARE))
		}
	})
}

var (
	captureCount     atomic.Int64
	bitbltNs         atomic.Int64
	dibitsNs         atomic.Int64
	convertNs        atomic.Int64
	lastCaptureLogNs atomic.Int64
	scaleOnce        sync.Once
	cachedScale      float64
	state            capState
	captureMu        sync.Mutex
)

var captureDisplayFn = func(display int) (*image.RGBA, error) {

	captureMu.Lock()
	defer captureMu.Unlock()

	setDPIAware()

	maxDisplays := displayCount()
	if display < 0 || display >= maxDisplays {
		display = 0
	}

	mons := monitorList()
	if display >= len(mons) {
		display = 0
	}
	mon := mons[display]

	bounds := mon.rect
	physW := mon.physW
	physH := mon.physH

	if physW <= 0 || physH <= 0 {
		physW = bounds.Dx()
		physH = bounds.Dy()
	}

	userScale := captureScale()
	dstW := int(float64(physW) * userScale)
	dstH := int(float64(physH) * userScale)

	hdcScreen := getDC(0)
	if hdcScreen == 0 {
		return nil, syscall.EINVAL
	}
	defer releaseDC(0, hdcScreen)

	if dstW <= 0 || dstH <= 0 {
		return nil, syscall.EINVAL
	}

	hdcMem, hbmp, buf, stride, err := state.ensure(hdcScreen, dstW, dstH)
	if err != nil {
		return nil, err
	}

	bitStart := time.Now()

	if !stretchBlt(hdcMem, 0, 0, int32(dstW), int32(dstH), hdcScreen, int32(bounds.Min.X), int32(bounds.Min.Y), int32(physW), int32(physH), SRCCOPY) {
		return nil, syscall.EINVAL
	}
	bitDur := time.Since(bitStart)

	if len(buf) == 0 {
		return nil, syscall.EINVAL
	}

	bmi := bitmapInfo{
		bmiHeader: bitmapInfoHeader{
			biSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
			biWidth:       int32(dstW),
			biHeight:      -int32(dstH),
			biPlanes:      1,
			biBitCount:    32,
			biCompression: BI_RGB,
		},
	}
	dibStart := time.Now()
	if got := getDIBits(hdcMem, hbmp, 0, uint32(dstH), unsafe.Pointer(&buf[0]), &bmi, DIB_RGB_COLORS); got == 0 {
		return nil, syscall.EINVAL
	}
	dibDur := time.Since(dibStart)

	convStart := time.Now()
	swapRB(buf)
	img := &image.RGBA{Pix: buf, Stride: stride, Rect: image.Rect(0, 0, dstW, dstH)}
	convDur := time.Since(convStart)

	DrawCursorOnImage(img, bounds)

	logCaptureTimings(bitDur, dibDur, convDur)
	return img, nil
}

func swapRB(pix []byte) {
	for i := 0; i+3 < len(pix); i += 4 {
		pix[i], pix[i+2] = pix[i+2], pix[i]
	}
}

func logCaptureTimings(bitDur, dibDur, convDur time.Duration) {
	captureCount.Add(1)
	bitbltNs.Add(bitDur.Nanoseconds())
	dibitsNs.Add(dibDur.Nanoseconds())
	convertNs.Add(convDur.Nanoseconds())

	nowNs := time.Now().UnixNano()
	last := lastCaptureLogNs.Load()
	if last != 0 && time.Duration(nowNs-last) < 5*time.Second {
		return
	}
	if !lastCaptureLogNs.CompareAndSwap(last, nowNs) {
		return
	}
	frames := captureCount.Swap(0)
	if frames == 0 {
		return
	}
	avg := func(totalNs atomic.Int64) float64 {
		return float64(totalNs.Swap(0)) / 1e6 / float64(frames)
	}
	bitAvg := avg(bitbltNs)
	dibAvg := avg(dibitsNs)
	convAvg := avg(convertNs)
	log.Printf("capture: win bitblt avg bitblt=%.2fms dibits=%.2fms convert=%.2fms frames=%d", bitAvg, dibAvg, convAvg, frames)
}

func resizeNearest(src *image.RGBA, w, h int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	srcW := src.Bounds().Dx()
	srcH := src.Bounds().Dy()
	for y := 0; y < h; y++ {
		sy := y * srcH / h
		sp := sy * src.Stride
		dp := y * dst.Stride
		for x := 0; x < w; x++ {
			sx := x * srcW / w
			s := sp + sx*4
			d := dp + x*4
			dst.Pix[d+0] = src.Pix[s+0]
			dst.Pix[d+1] = src.Pix[s+1]
			dst.Pix[d+2] = src.Pix[s+2]
			dst.Pix[d+3] = src.Pix[s+3]
		}
	}
	return dst
}

type capState struct {
	mu     sync.Mutex
	hdcMem uintptr
	hbmp   uintptr
	buf    []byte
	stride int
	w      int
	h      int
}

func (s *capState) ensure(hdcScreen uintptr, w, h int) (uintptr, uintptr, []byte, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.hdcMem == 0 {
		s.hdcMem = createCompatibleDC(hdcScreen)
		if s.hdcMem == 0 {
			return 0, 0, nil, 0, syscall.EINVAL
		}
	}

	if s.w != w || s.h != h || s.hbmp == 0 {
		newBmp := createCompatibleBitmap(hdcScreen, int32(w), int32(h))
		if newBmp == 0 {
			return 0, 0, nil, 0, syscall.EINVAL
		}
		selectObject(s.hdcMem, newBmp)
		if s.hbmp != 0 {
			deleteObject(s.hbmp)
		}
		s.hbmp = newBmp
		s.w = w
		s.h = h
		s.stride = w * 4
		s.buf = make([]byte, s.stride*h)
	}

	return s.hdcMem, s.hbmp, s.buf, s.stride, nil
}

func captureScale() float64 {
	scaleOnce.Do(func() {
		s := 1.0
		if env := os.Getenv("OVERLORD_RD_SCALE"); env != "" {
			if v, err := strconv.ParseFloat(env, 64); err == nil && v > 0.2 && v <= 1.5 {
				s = v
			}
		}
		cachedScale = s
	})
	return cachedScale
}
