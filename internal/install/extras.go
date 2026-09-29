package install

import "fmt"

const (
	codegraphOptionKey       = "codegraph"
	openSpecOptionKey        = "openspec"
	tsgoOptionKey            = "tsgo"
	cmuxOptionKey            = "cmux"
	openInAppOptionKey       = "opencode-open-in-app"
	openSpecTaskTUIOptionKey = "opencode-openspec-task-tui"
)

// ExtraOption is a standalone integration or UI toggle applied at the end of
// the wizard, outside the assets/ catalog.
type ExtraOption struct {
	Key             string
	Label           string
	Description     string
	DefaultSelected bool
}

// ExtraOptions is the fixed set of end-of-install toggles. Unlike the assets/
// catalog, these are hardcoded because each one requires behavior that plain
// file scanning cannot express.
var ExtraOptions = []ExtraOption{
	{Key: "engram-plugin", Label: "Engram memory hooks", Description: "Adaptador OpenCode v2 para Engram 1.20 existente"},
	{Key: "sdd-engram", Label: "SDD profiles and memories", Description: "Gestor de perfiles y memorias adaptado a OpenCode v2"},
	{
		Key:             codegraphOptionKey,
		Label:           "CodeGraph",
		Description:     "Instala el CLI, registra el MCP local y añade sus reglas a AGENTS.md",
		DefaultSelected: true,
	},
	{
		Key:             openSpecOptionKey,
		Label:           "OpenSpec",
		Description:     "Instala o actualiza el CLI global de OpenSpec",
		DefaultSelected: true,
	},
	{
		Key:             tsgoOptionKey,
		Label:           "tsgo",
		Description:     "Instala o actualiza tsgo y lo configura como LSP de TypeScript",
		DefaultSelected: true,
	},
	{
		Key:             "angel-logo",
		Label:           "Logo Angel AI",
		Description:     "ASCII logo propio + estado de los MCP en el pie de la TUI v2",
		DefaultSelected: true,
	},
	{
		Key:             "theme",
		Label:           "Tema one-dark-pro",
		Description:     "Activa one-dark-pro como tema de la TUI (cli.json)",
		DefaultSelected: true,
	},
	{
		Key:             "subagent-statusline",
		Label:           "Subagent statusline",
		Description:     "Plugin v2: actividad de los workers en la sidebar",
		DefaultSelected: true,
	},
	{
		Key:             openInAppOptionKey,
		Label:           "Open in App",
		Description:     "Plugin v2: abre archivos y recursos en sus aplicaciones nativas",
		DefaultSelected: true,
	},
	{
		Key:             openSpecTaskTUIOptionKey,
		Label:           "OpenSpec task TUI",
		Description:     "Plugin v2: muestra el progreso de tareas de OpenSpec en la sidebar",
		DefaultSelected: true,
	},
	{
		Key:             cmuxOptionKey,
		Label:           "cmux",
		Description:     "Notificaciones y Feed de cmux para sesiones de OpenCode",
		DefaultSelected: false,
	},
}

var uiPlugins = []struct{ option, identity, directory string }{
	{"angel-logo", "angel-logo", "angel-logo"},
	{"sdd-engram", "opencode-sdd-engram-manage", "sdd-engram"},
	{"subagent-statusline", "opencode-subagent-statusline", "subagent-statusline"},
	{openInAppOptionKey, "opencode-open-in-app", "open-in-app"},
	{openSpecTaskTUIOptionKey, "opencode-openspec-task-tui", "openspec-tasks"},
}
var cmuxPluginFiles = []string{"cmux-session.js", "cmux-feed.js"}

type executableLookup func(string) (string, error)

func preflightSelectedExtras(extras map[string]bool, lookPath executableLookup) error {
	if !extras[cmuxOptionKey] {
		return nil
	}
	if _, err := lookPath("cmux"); err != nil {
		return fmt.Errorf("cmux extra requires cmux to be available on PATH: %w", err)
	}
	return nil
}
