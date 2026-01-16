//go:build turbojpeg

package capture

import (
	"bytes"
	"image"

	ljpeg "github.com/pixiv/go-libjpeg/jpeg"
)

func encodeJPEG(img image.Image, quality int) ([]byte, error) {
	opts := &ljpeg.EncoderOptions{
		Quality:        quality,
		OptimizeCoding: true,
		DCTMethod:      ljpeg.DCTISlow,
	}
	buf := bytes.Buffer{}
	if err := ljpeg.Encode(&buf, img, opts); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
