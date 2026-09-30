package install

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"angel-ai-opencode/internal/assets"
)

func TestV2MigrationPreservesUserConfigAndReconcilesPackages(t *testing.T) {
	target := t.TempDir()
	oldPackage := filepath.Join(t.TempDir(), "open-in-app")
	writeTestFile(t, filepath.Join(oldPackage, "package.json"), `{"name":"opencode-open-in-app"}`)
	bundled := filepath.Join(oldPackage, "dist", "tui.js")
	writeTestFile(t, bundled, `throw new Error("must not execute plugin when planning")`)
	cli := map[string]any{"theme": map[string]any{"name": "custom", "mode": "dark"}, "keybinds": map[string]any{"leader": "ctrl+x"}, "plugins": []any{
		"foreign", filepath.Join(target, "tui-plugins", "angel-logo.tsx"), bundled, "opencode-open-in-app", "opencode-subagent-statusline@1.3.0",
	}}
	raw, _ := json.Marshal(cli)
	writeTestFile(t, filepath.Join(target, "cli.json"), string(raw))
	original := `{"agent":{"angel-orchestrator":{"model":"test/model"}},"mcp":{"example":{"enabled":false}},"permission":{"bash":{"rm *":"deny"}},"plugin":["./plugins/engram.ts","./plugins/cmux-session.js","opencode-claude-auth@latest","foreign-server"]}`
	writeTestFile(t, filepath.Join(target, "opencode.json"), original)
	writeTestFile(t, filepath.Join(target, "plugins", "cmux-session.js"), "legacy")
	writeTestFile(t, filepath.Join(target, "agents", "angel-orchestrator.md"), "user-customized prompt\n")
	writeTestFile(t, filepath.Join(target, "tui.json"), "legacy rollback bytes\n")
	source := assets.Directory(filepath.Join("..", "..", "assets"))
	request, err := V2MigrationRequest(source, target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = PlanInstallation(request); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(target, "opencode.json"))
	if string(before) != original {
		t.Fatal("preview mutated config")
	}
	if _, err = ApplyInstallation(request); err != nil {
		t.Fatal(err)
	}
	config, err := readOptionalConfig(filepath.Join(target, "opencode.json"))
	if err != nil {
		t.Fatal(err)
	}
	var expected map[string]any
	_ = json.Unmarshal([]byte(original), &expected)
	expected["plugin"] = []any{"opencode-claude-auth-v2@0.4.0-beta.5", "foreign-server"}
	if !reflect.DeepEqual(config, expected) {
		t.Fatalf("server config = %#v", config)
	}
	migrated, err := readOptionalConfig(filepath.Join(target, "cli.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(migrated["theme"], cli["theme"]) || !reflect.DeepEqual(migrated["keybinds"], cli["keybinds"]) {
		t.Fatal("lost UI preferences")
	}
	want := []any{"foreign", filepath.Join(target, "tui-plugins", "angel-logo"), "opencode-open-in-app", filepath.Join(target, "tui-plugins", "subagent-statusline")}
	if !reflect.DeepEqual(migrated["plugins"], want) {
		t.Fatalf("plugins = %#v", migrated["plugins"])
	}
	for file, want := range map[string]string{"agents/angel-orchestrator.md": "user-customized prompt\n", "tui.json": "legacy rollback bytes\n"} {
		got, _ := os.ReadFile(filepath.Join(target, file))
		if string(got) != want {
			t.Fatalf("changed %s", file)
		}
	}
	first, _ := filepath.Glob(filepath.Join(target, "cli.json.bak-*"))
	request, err = V2MigrationRequest(source, target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ApplyInstallation(request); err != nil {
		t.Fatal(err)
	}
	second, _ := filepath.Glob(filepath.Join(target, "cli.json.bak-*"))
	if len(first) != 1 || len(second) != 1 {
		t.Fatal("migration not idempotent")
	}
}

func TestV2MigrationRejectsInvalidCLIConfigBeforeWriting(t *testing.T) {
	target := t.TempDir()
	writeTestFile(t, filepath.Join(target, "cli.json"), "{ invalid")
	_, err := V2MigrationRequest(assets.Directory("../../assets"), target)
	if err == nil {
		t.Fatal("expected invalid config error")
	}
}

func TestV2MigrationReconcilesDescriptorsAndPreservesOptions(t *testing.T) {
	target := t.TempDir()
	writeTestFile(t, filepath.Join(target, "cli.json"), `{"plugins":[{"package":"opencode-open-in-app@1.0.0","options":{"favourite":"editor"}},"opencode-open-in-app@2.0.0",{"package":"foreign","options":{"keep":true}}]}`)
	request, err := V2MigrationRequest(assets.Directory("../../assets"), target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyInstallation(request); err != nil {
		t.Fatal(err)
	}
	config, err := readOptionalConfig(filepath.Join(target, "cli.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := []any{map[string]any{"package": "opencode-open-in-app", "options": map[string]any{"favourite": "editor"}}, map[string]any{"package": "foreign", "options": map[string]any{"keep": true}}}
	if !reflect.DeepEqual(config["plugins"], want) {
		t.Fatalf("plugins = %#v", config["plugins"])
	}
}

func TestV2MigrationRecognizesPackageDirectory(t *testing.T) {
	target, external := t.TempDir(), t.TempDir()
	writeTestFile(t, filepath.Join(external, "package.json"), `{"name":"opencode-open-in-app"}`)
	raw, _ := json.Marshal(map[string]any{"plugins": []any{external}})
	writeTestFile(t, filepath.Join(target, "cli.json"), string(raw))
	request, err := V2MigrationRequest(assets.Directory("../../assets"), target)
	if err != nil {
		t.Fatal(err)
	}
	if !request.Extras["opencode-open-in-app"] {
		t.Fatal("directory package not selected for migration")
	}
}

func TestV2MigrationPreservesCustomDescriptorByPackagePath(t *testing.T) {
	target, custom := t.TempDir(), t.TempDir()
	entry := filepath.Join(custom, "custom.tsx")
	writeTestFile(t, entry, `export default { id: "opencode-open-in-app", setup() {} }`)
	descriptor := map[string]any{"package": entry, "options": map[string]any{"custom": true}}
	resolver := v2UIPluginIdentityResolver(target, map[string]bool{"opencode-open-in-app": true})
	// Prove the fixture triggers the legacy exported-ID path for strings.
	// The same bundle as a descriptor must instead retain package-path identity.
	if got := resolver(entry); got != "opencode-open-in-app" {
		t.Fatalf("fixture does not exercise exported-ID matching: %q", got)
	}
	desired := filepath.Join(target, "tui-plugins", "open-in-app")
	got := mergePluginArrayWithIdentity([]any{descriptor}, []any{desired}, resolver)
	if !reflect.DeepEqual(got, []any{descriptor, desired}) {
		t.Fatalf("custom descriptor was replaced: %#v", got)
	}
}
