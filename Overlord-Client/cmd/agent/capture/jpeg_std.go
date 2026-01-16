package capture

import (
	"bytes"
	"image"
	"image/jpeg"
)

func encodeJPEG(img image.Image, quality int) ([]byte, error) {
	buf := bytes.Buffer{}
	err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality})
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
