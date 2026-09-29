package install

import (
	assetfs "angel-ai-opencode/internal/assets"
	"angel-ai-opencode/internal/catalog"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func readRepositoryAsset(t *testing.T, elements ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "assets"}, elements...)...)
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

// Every Angel AI agent asset is cataloged as a plain file copy and installed
// byte-identical to the repository source.
func TestAgentAssetsAreCatalogedAndInstalledUnchanged(t *testing.T) {
	assetsRoot := filepath.Join("..", "..", "assets")
	assetSource := assetfs.Directory(assetsRoot)
	categories, err := catalog.Load(assetSource)
	if err != nil {
		t.Fatal(err)
	}

	items := map[string]catalog.Item{}
	for _, category := range categories {
		if category.Name != "agents" {
			continue
		}
		for _, item := range category.Items {
			items[item.Name] = item
		}
	}

	var selected []catalog.Item
	for _, name := range ConfigurableAgents() {
		item, ok := items[name]
		if !ok {
			t.Fatalf("agent %q is not cataloged", name)
		}
		fileName := name + ".md"
		if item.Kind != catalog.CopyFile || item.Source != "agents/"+fileName || item.Dest != filepath.Join("agents", fileName) {
			t.Fatalf("catalog item %q = %#v", name, item)
		}
		selected = append(selected, item)
	}

	configDir := t.TempDir()
	if _, err := ApplyInstallation(InstallationRequest{
		Items: selected, Assets: assetSource, ConfigDir: configDir,
	}); err != nil {
		t.Fatal(err)
	}
	for _, item := range selected {
		want, err := assetSource.ReadFile(item.Source)
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(filepath.Join(configDir, item.Dest))
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("installed %s differs from the repository asset", item.Name)
		}
	}
}

// Agent frontmatter stays structurally safe without pinning prompt prose: it
// parses, declares no deprecated variant, subagents keep a tools block that
// denies recursive task delegation, read-only agents keep edit and write
// disabled, and the verifier stays skill-free. Command permissions live in
// the shared assets/fragments/permissions.json, not per-agent frontmatter.
func TestAgentFrontmatterRemainsStructurallySafe(t *testing.T) {
	readOnly := map[string]bool{
		"review-correctness":   true,
		"review-security-risk": true,
		"review-simplicity":    true,
	}
	for _, name := range ConfigurableAgents() {
		t.Run(name, func(t *testing.T) {
			asset := readRepositoryAsset(t, "agents", name+".md")
			frontmatter, _, found := strings.Cut(strings.TrimPrefix(asset, "---\n"), "---\n")
			if !found {
				t.Fatal("agent frontmatter is missing")
			}
			for _, line := range strings.Split(frontmatter, "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), "variant:") {
					t.Errorf("frontmatter still declares a variant: %q", strings.TrimSpace(line))
				}
			}
			if name != "angel-orchestrator" {
				if !strings.Contains(frontmatter, "tools:") {
					t.Error("subagent frontmatter lost its tools block")
				}
				if !strings.Contains(frontmatter, "task: false") {
					t.Error("subagent frontmatter allows recursive task delegation")
				}
			}
			if readOnly[name] {
				for _, contract := range []string{"edit: false", "write: false"} {
					if !strings.Contains(frontmatter, contract) {
						t.Errorf("read-only agent lost %q", contract)
					}
				}
			}

		})
	}
}

// The orchestrator loads its interview skills by name at runtime. Every
// `*-grilling` skill it names must exist as an installable skill asset, so a
// rename or removal on either side fails here instead of mid-interview.
func TestOrchestratorInterviewSkillsAreInstallableAssets(t *testing.T) {
	asset := readRepositoryAsset(t, "agents", "angel-orchestrator.md")
	reference := regexp.MustCompile("`([a-z0-9]+(?:-[a-z0-9]+)*-grilling)`")
	matches := reference.FindAllStringSubmatch(asset, -1)
	if len(matches) == 0 {
		t.Fatal("orchestrator no longer names any interview skill")
	}
	for _, match := range matches {
		name := match[1]
		skillPath := filepath.Join("..", "..", "assets", "skills", name, "SKILL.md")
		if _, err := os.Stat(skillPath); err != nil {
			t.Errorf("orchestrator references interview skill %q with no installable asset: %v", name, err)
		}
	}
}

// Installer reconciliation propagates an updated repository asset only when the
// agent is selected again, and never mutates an existing configured copy on its
// own.
func TestExistingOrchestratorCopyRequiresUpdatedSourceAndSelectedReconciliation(t *testing.T) {
	assetRoot := t.TempDir()
	agentsDir := filepath.Join(assetRoot, "agents")
	if err := os.Mkdir(agentsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	assetPath := filepath.Join(agentsDir, "angel-orchestrator.md")
	original := []byte("original orchestrator policy\n")
	updated := []byte("updated recovered-probe policy\n")
	if err := os.WriteFile(assetPath, original, 0o644); err != nil {
		t.Fatal(err)
	}

	assetSource := assetfs.Directory(assetRoot)
	categories, err := catalog.Load(assetSource)
	if err != nil {
		t.Fatal(err)
	}
	var selected catalog.Item
	for _, category := range categories {
		if category.Name == "agents" && len(category.Items) == 1 {
			selected = category.Items[0]
		}
	}
	if selected.Name != "angel-orchestrator" {
		t.Fatalf("selected agent = %#v", selected)
	}

	configDir := t.TempDir()
	reconcile := func() {
		t.Helper()
		if _, err := ApplyInstallation(InstallationRequest{
			Items: []catalog.Item{selected}, Assets: assetSource, ConfigDir: configDir,
		}); err != nil {
			t.Fatal(err)
		}
	}
	reconcile()
	installedPath := filepath.Join(configDir, selected.Dest)

	// Repository edits similarly do not mutate an existing configured copy. A
	// rebuild or explicit updated asset source must still be followed by
	// reconciliation with angel-orchestrator selected.
	if err := os.WriteFile(assetPath, updated, 0o644); err != nil {
		t.Fatal(err)
	}
	installed, err := os.ReadFile(installedPath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(installed, original) {
		t.Fatal("configured copy changed before selected-agent reconciliation")
	}

	reconcile()
	installed, err = os.ReadFile(installedPath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(installed, updated) {
		t.Fatal("selected-agent reconciliation did not propagate the updated source")
	}
}
