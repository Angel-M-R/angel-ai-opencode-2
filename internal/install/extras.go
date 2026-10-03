package install

const (
	tsgoOptionKey      = "tsgo"
	openInAppOptionKey = "opencode-open-in-app"
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
	{
		Key:             tsgoOptionKey,
		Label:           "tsgo",
		Description:     "Instala o actualiza tsgo y lo configura como LSP de TypeScript",
		DefaultSelected: true,
	},
	{
		Key:             "angel-logo",
		Label:           "Logo Angel AI",
		Description:     "ASCII logo propio + estado de los MCP sobre la entrada en la compilación Angel",
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
		Description:     "Plugin v2: abre el proyecto en un editor o explorador de archivos",
		DefaultSelected: true,
	},
}

// uiPlugins with a package are installed from npm at a pinned version; the
// rest are copied from assets/tui-plugins/<directory>. The directory also
// identifies an earlier local copy so reinstalling replaces it with the
// package entry.
var uiPlugins = []struct{ option, identity, directory, npmPackage string }{
	{"angel-logo", "angel-logo", "angel-logo", ""},
	{"subagent-statusline", "opencode-subagent-statusline", "subagent-statusline", ""},
	{openInAppOptionKey, "opencode-open-in-app", "open-in-app", "opencode-open-in-app@1.0.0"},
}
