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
	oldPackage := filepath.Join(t.TempDir(), "openspec")
	writeTestFile(t, filepath.Join(oldPackage, "package.json"), `{"name":"opencode-openspec-task-tui"}`)
	bundled := filepath.Join(oldPackage, "dist", "tui.js")
	writeTestFile(t, bundled, `throw new Error("must not execute plugin when planning")`)
	cli := map[string]any{"theme": map[string]any{"name": "custom", "mode": "dark"}, "keybinds": map[string]any{"leader": "ctrl+x"}, "plugins": []any{
		"foreign", filepath.Join(target, "tui-plugins", "angel-logo.tsx"), bundled, "opencode-openspec-task-tui", "opencode-subagent-statusline@1.3.0",
	}}
	raw, _ := json.Marshal(cli)
	writeTestFile(t, filepath.Join(target, "cli.json"), string(raw))
	original := `{"agent":{"angel-orchestrator":{"model":"test/model"}},"mcp":{"example":{"enabled":false}},"permission":{"bash":{"rm *":"deny"}},"plugin":["./plugins/cmux-session.js","opencode-claude-auth@latest","foreign-server"]}`
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
	want := []any{"foreign", filepath.Join(target, "tui-plugins", "angel-logo"), filepath.Join(target, "tui-plugins", "openspec-tasks"), filepath.Join(target, "tui-plugins", "subagent-statusline")}
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
