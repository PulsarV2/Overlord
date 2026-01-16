package wire

import "github.com/vmihailenco/msgpack/v5"

func DecodeEnvelope(data []byte) (map[string]interface{}, error) {
	env := make(map[string]interface{})
	if err := msgpack.Unmarshal(data, &env); err != nil {
		return nil, err
	}
	return env, nil
}
