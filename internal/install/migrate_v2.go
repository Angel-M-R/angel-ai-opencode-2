package install

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"angel-ai-opencode/internal/assets"
	"angel-ai-opencode/internal/catalog"
)

// V2MigrationRequest updates only integrations already installed. It leaves
// agent prompts, MCP definitions, model assignments and user rules intact.
func V2MigrationRequest(source assets.Source, configDir string) (InstallationRequest, error) {
	request := InstallationRequest{Assets: source, ConfigDir: configDir, Extras: map[string]bool{}, migrateV2: true}
	cli, err := readOptionalConfig(filepath.Join(configDir, "cli.json"))
	if err != nil {
		return request, err
	}
	if cli == nil {
		if _, err := os.Stat(filepath.Join(configDir, "tui.json")); err == nil {
			return request, fmt.Errorf("start OpenCode v2 once to migrate tui.json into cli.json before running this migration")
		}
	}
	selected := map[string]bool{}
	for _, p := range uiPlugins {
		selected[p.identity] = true
	}
	resolve := v2UIPluginIdentityResolver(configDir, selected)
	if entries, ok := cli["plugins"].([]any); ok {
		for _, entry := range entries {
			id := resolve(entry)
			for _, p := range uiPlugins {
				if id == p.identity {
					request.Extras[p.option] = true
				}
			}
		}
	}
	// Existing server files are auto-discovered in both versions. Updating them
	// does not require the cmux executable on machines that no longer use cmux.
	for _, name := range cmuxPluginFiles {
		if _, err := os.Stat(filepath.Join(configDir, "plugins", name)); err == nil {
			request.Items = append(request.Items, catalog.Item{Name: name, Source: "integrations/cmux/" + name, Dest: "plugins/" + name, Kind: catalog.CopyFile})
		} else if !os.IsNotExist(err) {
			return request, err
		}
	}
	if _, err := os.Stat(filepath.Join(configDir, "plugins", "engram.ts")); err == nil {
		request.Extras["engram-plugin"] = true
	}
	return request, nil
}

func readOptionalConfig(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if result == nil {
		return nil, fmt.Errorf("%s must contain a JSON object", path)
	}
	return result, nil
}

func migrateV2ServerConfig(configDir string, config map[string]any) error {
	for _, key := range []string{"plugin", "plugins"} {
		entries, ok := config[key].([]any)
		if !ok {
			continue
		}
		updated := make([]any, 0, len(entries))
		authSeen := false
		for _, entry := range entries {
			name, ok := entry.(string)
			if !ok {
				updated = append(updated, entry)
				continue
			}
			if pluginIdentity(name) == "opencode-claude-auth-v2" {
				if !authSeen {
					updated = append(updated, "opencode-claude-auth-v2@0.4.0-beta.5")
					authSeen = true
				}
				continue
			}
			file, local := tuiPluginBundlePath(configDir, name)
			// These files are auto-discovered. V2 rejects explicit file references.
			if local && (file == filepath.Join(configDir, "plugins", "cmux-session.js") ||
				file == filepath.Join(configDir, "plugins", "cmux-feed.js") || file == filepath.Join(configDir, "plugins", "engram.ts")) {
				continue
			}
			if strings.TrimSpace(name) != "" {
				updated = append(updated, entry)
			}
		}
		config[key] = updated
	}
	return nil
}
