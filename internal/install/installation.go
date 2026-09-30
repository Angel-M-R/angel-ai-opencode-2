package install

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"angel-ai-opencode/internal/assets"
	"angel-ai-opencode/internal/catalog"
)

// InstallationRequest is the complete desired installer selection. Planning
// and applying consume the same request so they cannot disagree about extras or
// about files shared by more than one feature, such as AGENTS.md.
type InstallationRequest struct {
	migrateV2 bool
	Items     []catalog.Item
	Extras    map[string]bool
	Assets    assets.Source
	ConfigDir string
	// AgentModels are the per-agent model and reasoning effort choices. A nil
	// or empty map writes nothing, which is what the non-interactive path
	// passes.
	AgentModels AgentModelAssignments
	// FileExpectations guard managed updates against changes made after
	// planning. Files without an entry use normal installer reconciliation.
	FileExpectations map[string]FileExpectation
}

// FileExpectation describes the state a managed destination must retain until
// publication. SHA256 and Absent are mutually exclusive.
type FileExpectation struct {
	SHA256 string
	Absent bool
}

type preparedFile struct {
	path            string
	content         []byte
	perm            os.FileMode
	exists          bool
	unchanged       bool
	fullReplacement bool
	jsonObject      map[string]any
}

type preparedInstallation struct {
	files      []preparedFile
	globalCLIs []globalCLIDescriptor
}

var prepareInstallationForApply = prepareInstallation

// PlanInstallation inspects the destination and describes the exact changes
// ApplyInstallation would make without mutating the machine.
func PlanInstallation(request InstallationRequest) ([]string, error) {
	prepared, err := prepareInstallation(request)
	if err != nil {
		return nil, err
	}
	snapshot, err := preflightGlobalCLIs(prepared.globalCLIs, systemGlobalCLICommands)
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(prepared.files)+len(snapshot.inspections))
	for _, file := range prepared.files {
		lines = append(lines, file.planLine())
	}
	for _, inspection := range snapshot.inspections {
		lines = append(lines, inspection.reportLine())
	}
	return lines, nil
}

// ApplyInstallation validates the complete desired state before performing any
// package installation or file write, then applies only changed files.
func ApplyInstallation(request InstallationRequest) ([]string, error) {
	done, _, err := ApplyInstallationWithDigests(request)
	return done, err
}

// ApplyInstallationWithDigests additionally reports the SHA-256 of the bytes
// each managed destination held as this installation's transaction completed,
// so callers can record a baseline that no concurrent installer can taint.
func ApplyInstallationWithDigests(
	request InstallationRequest,
) (done []string, digests map[string]string, resultErr error) {
	lease, err := acquireInstallationLock(request.ConfigDir)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		if err := lease.release(); err != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("releasing installation lock: %w", err))
		}
	}()
	// Bind every validation and write to the canonical root whose lock we hold.
	// Re-resolving request.ConfigDir later could adopt a retargeted symlink while
	// still holding the old root's lock.
	allowlist, err := newLockedManagedPathAllowlist(request.ConfigDir, lease.target)
	if err != nil {
		return nil, nil, err
	}
	prepared, err := prepareInstallationForApply(request)
	if err != nil {
		return nil, nil, err
	}
	if err := validatePreparedFiles(allowlist, prepared.files); err != nil {
		return nil, nil, err
	}
	snapshot, err := preflightGlobalCLIs(prepared.globalCLIs, systemGlobalCLICommands)
	if err != nil {
		return nil, nil, err
	}
	reprepareAfterCLIs := len(snapshot.inspections) > 0
	externalEffects := false
	for _, inspection := range snapshot.inspections {
		mayChangePackageManager := inspection.disposition == globalCLIInstall ||
			inspection.disposition == globalCLIOutdated
		line, err := applyGlobalCLIInspection(inspection, snapshot.manager, systemGlobalCLICommands)
		if err != nil {
			return done, nil, withExternalEffectsNotice(err, externalEffects || mayChangePackageManager)
		}
		if mayChangePackageManager {
			externalEffects = true
			line += " [efecto externo, fuera del rollback de archivos]"
		}
		done = append(done, line)
	}
	if reprepareAfterCLIs {
		prepared, err = prepareInstallationForApply(request)
		if err != nil {
			return done, nil, withExternalEffectsNotice(err, externalEffects)
		}
		if err := validatePreparedFiles(allowlist, prepared.files); err != nil {
			return done, nil, withExternalEffectsNotice(err, externalEffects)
		}
	}
	transaction, err := newInstallationTransaction(allowlist, prepared.files, request.FileExpectations)
	if err != nil {
		return done, nil, withExternalEffectsNotice(err, externalEffects)
	}
	results, err := transaction.apply()
	if err != nil {
		return done, nil, withExternalEffectsNotice(err, externalEffects)
	}
	for index, file := range prepared.files {
		result := results[index]
		done = append(done, fileResultLines(file.path, result)...)
	}
	return done, transaction.publishedDigests(), nil
}

// ManagedFilePaths returns the files the request reconciles under ConfigDir.
// It uses the same preparation path as planning and applying, but it performs
// no package installation or file write.
func ManagedFilePaths(request InstallationRequest) ([]string, error) {
	prepared, err := prepareInstallation(request)
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(prepared.files))
	seen := make(map[string]struct{}, len(prepared.files))
	for _, file := range prepared.files {
		if _, ok := seen[file.path]; ok {
			continue
		}
		seen[file.path] = struct{}{}
		paths = append(paths, file.path)
	}
	sort.Strings(paths)
	return paths, nil
}

func withExternalEffectsNotice(err error, externalEffects bool) error {
	if err == nil || !externalEffects {
		return err
	}
	return fmt.Errorf("%w; external package-manager effects were not reverted", err)
}

func (file preparedFile) contentMatches(content []byte) bool {
	if file.jsonObject == nil {
		return bytes.Equal(content, file.content)
	}
	var current map[string]any
	if err := json.Unmarshal(content, &current); err != nil {
		return false
	}
	return reflect.DeepEqual(current, file.jsonObject)
}

func prepareInstallation(request InstallationRequest) (preparedInstallation, error) {
	prepared := preparedInstallation{globalCLIs: selectedGlobalCLIs(request.Extras)}
	var fragments []map[string]any
	var globalAgents *catalog.Item

	for _, item := range request.Items {
		switch item.Kind {
		case catalog.MergeJSON:
			patch, err := readAssetJSONObject(request.Assets, item.Source)
			if err != nil {
				return preparedInstallation{}, fmt.Errorf("parsing fragment %s: %w", item.Name, err)
			}
			fragments = append(fragments, patch)
		case catalog.CopyDir:
			files, err := prepareDirectory(request.Assets, item.Source, filepath.Join(request.ConfigDir, item.Dest))
			if err != nil {
				return preparedInstallation{}, fmt.Errorf("preparing %s: %w", item.Name, err)
			}
			prepared.files = append(prepared.files, files...)
		default:
			if filepath.Clean(item.Dest) == "AGENTS.md" {
				copy := item
				globalAgents = &copy
				continue
			}
			file, err := prepareSourceFile(request.Assets, item.Source, filepath.Join(request.ConfigDir, item.Dest), false)
			if err != nil {
				return preparedInstallation{}, fmt.Errorf("preparing %s: %w", item.Name, err)
			}
			prepared.files = append(prepared.files, file)
		}
	}

	if patch, ok := agentModelsPatch(request.AgentModels); ok {
		fragments = append(fragments, patch)
	}

	tsgoSelected, tsgoSpecified := request.Extras[tsgoOptionKey]

	opencodeFile, ok, err := prepareOpenCodeJSONObject(
		filepath.Join(request.ConfigDir, "opencode.json"),
		"https://opencode.ai/config.json",
		fragments,
		tsgoSpecified,
		tsgoSelected,
	)
	if err != nil {
		return preparedInstallation{}, err
	}
	if request.migrateV2 {
		opencodeFile, ok, err = prepareJSONObjectCore(filepath.Join(request.ConfigDir, "opencode.json"),
			"https://opencode.ai/config.json", nil, pluginIdentity,
			func(config map[string]any) error { return migrateV2ServerConfig(request.ConfigDir, config) }, false)
		if err != nil {
			return preparedInstallation{}, err
		}
	}
	if ok {
		prepared.files = append(prepared.files, opencodeFile)
	}

	if err := prepareUIExtras(&prepared, request); err != nil {
		return preparedInstallation{}, err
	}
	agentsFile, ok, err := prepareAgentsFile(request, globalAgents)
	if err != nil {
		return preparedInstallation{}, err
	}
	if ok {
		prepared.files = append(prepared.files, agentsFile)
	}

	sort.SliceStable(prepared.files, func(i, j int) bool {
		if prepared.files[i].fullReplacement != prepared.files[j].fullReplacement {
			return prepared.files[i].fullReplacement
		}
		return prepared.files[i].path < prepared.files[j].path
	})
	return prepared, nil
}

func (file preparedFile) planLine() string {
	switch {
	case file.unchanged:
		return "SIN CAMBIOS " + file.path
	case !file.exists:
		return "CREAR       " + file.path
	case file.fullReplacement:
		return "REEMPLAZAR  " + file.path + " (reemplazo completo; se creará backup)"
	default:
		return "ACTUALIZAR  " + file.path + " (se creará backup)"
	}
}

func prepareSourceFile(source assets.Source, sourcePath, target string, fullReplacement bool) (preparedFile, error) {
	content, err := source.ReadFile(sourcePath)
	if err != nil {
		return preparedFile{}, err
	}
	mode, err := source.FileMode(sourcePath)
	if err != nil {
		return preparedFile{}, err
	}
	return prepareFile(target, content, mode, fullReplacement)
}

func prepareDirectory(source assets.Source, sourceRoot, target string) ([]preparedFile, error) {
	var files []preparedFile
	err := source.WalkDir(sourceRoot, func(sourcePath string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		relative := strings.TrimPrefix(sourcePath, sourceRoot+"/")
		file, err := prepareSourceFile(source, sourcePath, filepath.Join(target, filepath.FromSlash(relative)), false)
		if err != nil {
			return err
		}
		files = append(files, file)
		return nil
	})
	return files, err
}

func prepareFile(path string, content []byte, perm os.FileMode, fullReplacement bool) (preparedFile, error) {
	file := preparedFile{
		path: path, content: append([]byte(nil), content...), perm: perm,
		fullReplacement: fullReplacement,
	}
	existing, err := os.ReadFile(path)
	switch {
	case err == nil:
		file.exists = true
		file.unchanged = bytes.Equal(existing, content)
	case os.IsNotExist(err):
	case err != nil:
		return preparedFile{}, err
	}
	return file, nil
}

func readAssetJSONObject(source assets.Source, sourcePath string) (map[string]any, error) {
	raw, err := source.ReadFile(sourcePath)
	if err != nil {
		return nil, err
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, err
	}
	if object == nil {
		return nil, fmt.Errorf("JSON root is not an object")
	}
	return object, nil
}

func prepareJSONObject(
	path, defaultSchema string,
	patches []map[string]any,
	resolvePluginIdentity pluginIdentityResolver,
) (preparedFile, bool, error) {
	return prepareJSONObjectCore(path, defaultSchema, patches, resolvePluginIdentity, nil, false)
}

func prepareOpenCodeJSONObject(
	path, defaultSchema string,
	patches []map[string]any,
	tsgoSpecified, tsgoSelected bool,
) (preparedFile, bool, error) {
	var mutate func(map[string]any) error
	if tsgoSpecified && tsgoSelected {
		mutate = configureTsgo
	}
	return prepareJSONObjectCore(path, defaultSchema, patches, pluginIdentity, mutate, tsgoSpecified && tsgoSelected)
}

var tsgoLSPCommand = []any{"tsgo", "--lsp", "--stdio"}

func configureTsgo(config map[string]any) error {
	expected := map[string]any{"command": append([]any(nil), tsgoLSPCommand...)}

	lsp, lspPresent := config["lsp"]
	lspObject, lspOK := lsp.(map[string]any)
	if lspPresent && !lspOK {
		if _, isBoolean := lsp.(bool); !isBoolean {
			return fmt.Errorf("tsgo configuration conflicts with manual lsp configuration")
		}
		lspObject = map[string]any{}
		config["lsp"] = lspObject
	}
	if !lspPresent {
		lspObject = map[string]any{}
		config["lsp"] = lspObject
	}
	typescript, typescriptPresent := lspObject["typescript"]
	if typescriptPresent && !reflect.DeepEqual(typescript, expected) {
		return fmt.Errorf("tsgo configuration conflicts with manually modified lsp.typescript")
	}

	lspObject["typescript"] = expected
	return nil
}

func prepareJSONObjectCore(
	path, defaultSchema string,
	patches []map[string]any,
	resolvePluginIdentity pluginIdentityResolver,
	mutate func(map[string]any) error,
	createForMutation bool,
) (preparedFile, bool, error) {
	raw, err := os.ReadFile(path)
	exists := err == nil
	if err != nil && !os.IsNotExist(err) {
		return preparedFile{}, false, err
	}
	if !exists && len(patches) == 0 && !createForMutation {
		return preparedFile{}, false, nil
	}

	original := map[string]any{}
	if exists {
		if err := json.Unmarshal(raw, &original); err != nil {
			return preparedFile{}, false, fmt.Errorf("parsing %s: %w", path, err)
		}
	}
	config, err := cloneJSONObject(original)
	if err != nil {
		return preparedFile{}, false, err
	}
	if len(patches) > 0 || createForMutation {
		if _, ok := config["$schema"]; !ok {
			config["$schema"] = defaultSchema
		}
	}
	for _, patch := range patches {
		mergeWithPluginIdentity(config, patch, resolvePluginIdentity)
	}
	if mutate != nil {
		if err := mutate(config); err != nil {
			return preparedFile{}, false, err
		}
	}

	encoded, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return preparedFile{}, false, err
	}
	file, err := prepareFile(path, append(encoded, '\n'), 0o644, false)
	if err != nil {
		return preparedFile{}, false, err
	}
	file.jsonObject = config
	file.unchanged = exists && reflect.DeepEqual(original, config)
	return file, true, nil
}

func cloneJSONObject(source map[string]any) (map[string]any, error) {
	if source == nil {
		return map[string]any{}, nil
	}
	raw, err := json.Marshal(source)
	if err != nil {
		return nil, err
	}
	var cloned map[string]any
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

// prepareUIExtras installs local and npm v2 plugin packages. cli.json is the v2
// client configuration; tui.json is retained as the user's v1 rollback copy.
func prepareUIExtras(prepared *preparedInstallation, request InstallationRequest) error {
	var patches []map[string]any
	selected := map[string]bool{}
	for _, plugin := range uiPlugins {
		if !request.Extras[plugin.option] {
			continue
		}
		selected[plugin.identity] = true
		if plugin.npmPackage != "" {
			patches = append(patches, map[string]any{"plugins": []any{plugin.npmPackage}})
			continue
		}
		target := filepath.Join(request.ConfigDir, "tui-plugins", plugin.directory)
		files, err := prepareDirectory(request.Assets, path.Join("tui-plugins", plugin.directory), target)
		if err != nil {
			return fmt.Errorf("preparing %s: %w", plugin.identity, err)
		}
		prepared.files = append(prepared.files, files...)
		patches = append(patches, map[string]any{"plugins": []any{target}})
	}
	if request.Extras["theme"] {
		patches = append(patches, map[string]any{"theme": map[string]any{"name": "one-dark-pro"}})
	}
	if len(patches) == 0 {
		return nil
	}
	file, ok, err := prepareJSONObject(
		filepath.Join(request.ConfigDir, "cli.json"),
		"https://opencode.ai/v2/cli.json", patches,
		v2UIPluginIdentityResolver(request.ConfigDir, selected),
	)
	if err != nil {
		return err
	}
	if ok {
		prepared.files = append(prepared.files, file)
	}
	return nil
}

func prepareAgentsFile(request InstallationRequest, globalAgents *catalog.Item) (preparedFile, bool, error) {
	if globalAgents == nil {
		return preparedFile{}, false, nil
	}
	content, err := request.Assets.ReadFile(globalAgents.Source)
	if err != nil {
		return preparedFile{}, false, err
	}
	file, err := prepareFile(filepath.Join(request.ConfigDir, "AGENTS.md"), content, 0o644, true)
	return file, true, err
}
