package plugins

import "errors"

// PluginAssets describes UI asset filenames in the plugin bundle.
type PluginAssets struct {
	HTML string `msgpack:"html" json:"html"`
	CSS  string `msgpack:"css" json:"css"`
	JS   string `msgpack:"js" json:"js"`
}

// PluginManifest describes a plugin bundle.
type PluginManifest struct {
	ID          string       `msgpack:"id" json:"id"`
	Name        string       `msgpack:"name" json:"name"`
	Version     string       `msgpack:"version,omitempty" json:"version,omitempty"`
	Description string       `msgpack:"description,omitempty" json:"description,omitempty"`
	Binary      string       `msgpack:"binary,omitempty" json:"binary,omitempty"`
	Entry       string       `msgpack:"entry,omitempty" json:"entry,omitempty"`
	Assets      PluginAssets `msgpack:"assets,omitempty" json:"assets,omitempty"`
}

// PluginMessage is the msgpack envelope exchanged with the WASM plugin.
type PluginMessage struct {
	Type    string      `msgpack:"type"`
	Event   string      `msgpack:"event,omitempty"`
	Payload interface{} `msgpack:"payload,omitempty"`
	Error   string      `msgpack:"error,omitempty"`
}

// HostInfo describes basic host metadata provided to plugins.
type HostInfo struct {
	ClientID string `msgpack:"clientId"`
	OS       string `msgpack:"os"`
	Arch     string `msgpack:"arch"`
	Version  string `msgpack:"version"`
}

// ManifestFromMap converts a loosely-typed manifest map into a typed manifest.
func ManifestFromMap(m map[string]interface{}) (PluginManifest, error) {
	manifest := PluginManifest{}
	manifest.ID = stringVal(m["id"])
	manifest.Name = stringVal(m["name"])
	manifest.Version = stringVal(m["version"])
	manifest.Description = stringVal(m["description"])
	manifest.Binary = stringVal(m["binary"])
	manifest.Entry = stringVal(m["entry"])

	if assetsRaw, ok := m["assets"].(map[string]interface{}); ok {
		manifest.Assets = PluginAssets{
			HTML: stringVal(assetsRaw["html"]),
			CSS:  stringVal(assetsRaw["css"]),
			JS:   stringVal(assetsRaw["js"]),
		}
	}

	if manifest.ID == "" {
		return PluginManifest{}, errors.New("missing plugin id")
	}
	if manifest.Name == "" {
		manifest.Name = manifest.ID
	}
	return manifest, nil
}

func stringVal(v interface{}) string {
	s, _ := v.(string)
	return s
}
