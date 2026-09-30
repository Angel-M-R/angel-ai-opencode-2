// angel is a personal installer for opencode configuration: it reads the
// editable content under assets/ and installs the selection into
// ~/.config/opencode through a step-by-step TUI wizard.
package main

import (
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"angel-ai-opencode/internal/assets"
	"angel-ai-opencode/internal/catalog"
	"angel-ai-opencode/internal/install"
	"angel-ai-opencode/internal/managedassets"
	"angel-ai-opencode/internal/tui"
	"angel-ai-opencode/internal/updater"
	"github.com/charmbracelet/x/term"
)

//go:embed all:assets
var embeddedAssetTree embed.FS

// version is set from a stable release tag through -ldflags. Local builds use
// dev so they cannot update themselves accidentally.
var version = "dev"

type rootOptions struct {
	assetsDir string
	configDir string
	all       bool
	dryRun    bool
}

type updatePolicy interface {
	Run(currentVersion string, forced bool) error
}

var errInteractiveTerminalRequired = errors.New("interactive terminal required")

type interactiveTerminalError struct {
	streams []string
}

func (err *interactiveTerminalError) Error() string {
	subject := strings.Join(err.streams, " and ")
	verb := "is"
	object := "a terminal"
	if len(err.streams) > 1 {
		verb = "are"
		object = "terminals"
	}
	return fmt.Sprintf("interactive mode requires terminal input and output; %s %s not %s. Use --all for non-interactive installation", subject, verb, object)
}

func (err *interactiveTerminalError) Unwrap() error {
	return errInteractiveTerminalRequired
}

type cliDependencies struct {
	stdout                   io.Writer
	checkInteractiveTerminal func() error
	runInstaller             func(rootOptions) error
	newUpdatePolicy          func() updatePolicy
}

func main() {
	if err := runCLI(os.Args[1:], defaultCLIDependencies()); err != nil {
		fmt.Fprintln(os.Stderr, "angel:", err)
		os.Exit(1)
	}
}

func defaultCLIDependencies() cliDependencies {
	return cliDependencies{
		stdout: os.Stdout,
		checkInteractiveTerminal: func() error {
			return validateInteractiveTerminal(isTerminal(os.Stdin), isTerminal(os.Stdout))
		},
		runInstaller: func(options rootOptions) error {
			return run(options.assetsDir, options.configDir, options.all, options.dryRun)
		},
		newUpdatePolicy: func() updatePolicy {
			return updater.New(updater.Config{Output: os.Stdout})
		},
	}
}

func runCLI(args []string, dependencies cliDependencies) error {
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "version":
			return runVersionCommand(args[1:], dependencies)
		case "update":
			return runUpdateCommand(args[1:], dependencies)
		case "sync":
			return runSyncCommand(args[1:], dependencies)
		case "doctor":
			return runDoctorCommand(args[1:], dependencies)
		default:
			return fmt.Errorf("unknown command %q", args[0])
		}
	}
	return runRootCommand(args, dependencies)
}

func runRootCommand(args []string, dependencies cliDependencies) error {
	flags := flag.NewFlagSet("angel-ai", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	options := rootOptions{}
	flags.StringVar(&options.assetsDir, "assets", "", "assets directory override (default: embedded assets)")
	flags.StringVar(&options.configDir, "target", "", "opencode config directory (default: ~/.config/opencode)")
	flags.BoolVar(&options.all, "all", false, "install everything without the TUI")
	flags.BoolVar(&options.dryRun, "dry-run", false, "with --all, print the plan without installing")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unknown command %q", flags.Arg(0))
	}

	if !options.all {
		if dependencies.checkInteractiveTerminal == nil {
			return fmt.Errorf("interactive terminal check is unavailable")
		}
		if err := dependencies.checkInteractiveTerminal(); err != nil {
			return err
		}
		if err := runUpdatePolicyFailOpen(false, dependencies); err != nil {
			return err
		}
	}
	return dependencies.runInstaller(options)
}

func isTerminal(file *os.File) bool {
	return term.IsTerminal(file.Fd())
}

func validateInteractiveTerminal(stdinTTY, stdoutTTY bool) error {
	var streams []string
	if !stdinTTY {
		streams = append(streams, "stdin")
	}
	if !stdoutTTY {
		streams = append(streams, "stdout")
	}
	if len(streams) == 0 {
		return nil
	}
	return &interactiveTerminalError{streams: streams}
}

func runVersionCommand(args []string, dependencies cliDependencies) error {
	flags := flag.NewFlagSet("angel-ai version", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("version: unexpected argument %q", flags.Arg(0))
	}
	_, err := fmt.Fprintln(dependencies.stdout, version)
	return err
}

func runUpdateCommand(args []string, dependencies cliDependencies) error {
	flags := flag.NewFlagSet("angel-ai update", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("update: unexpected argument %q", flags.Arg(0))
	}
	return runUpdatePolicyFailOpen(true, dependencies)
}

func runSyncCommand(args []string, dependencies cliDependencies) error {
	flags := flag.NewFlagSet("angel-ai sync", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	assetsDir := flags.String("assets", "", "assets directory override (default: embedded assets)")
	configDir := flags.String("target", "", "opencode config directory (default: ~/.config/opencode)")
	dryRun := flags.Bool("dry-run", false, "print the saved selection's plan without writing")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("sync: unexpected argument %q", flags.Arg(0))
	}
	source, err := sourceForAssets(*assetsDir)
	if err != nil {
		return err
	}
	target, err := resolveConfigDir(*configDir)
	if err != nil {
		return err
	}
	report, err := managedassets.Sync(source, target, *dryRun)
	for _, line := range report {
		if _, writeErr := fmt.Fprintln(dependencies.stdout, line); writeErr != nil {
			return writeErr
		}
	}
	return err
}

func runDoctorCommand(args []string, dependencies cliDependencies) error {
	flags := flag.NewFlagSet("angel-ai doctor", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	assetsDir := flags.String("assets", "", "assets directory override (default: embedded assets)")
	configDir := flags.String("target", "", "opencode config directory (default: ~/.config/opencode)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("doctor: unexpected argument %q", flags.Arg(0))
	}
	source, err := sourceForAssets(*assetsDir)
	if err != nil {
		return err
	}
	target, err := resolveConfigDir(*configDir)
	if err != nil {
		return err
	}
	report, err := managedassets.Doctor(source, target)
	if err != nil {
		return err
	}
	if report.Healthy {
		_, err := fmt.Fprintln(dependencies.stdout, "estado y archivos gestionados correctos")
		return err
	}
	for _, finding := range report.Findings {
		if _, err := fmt.Fprintln(dependencies.stdout, doctorFindingLine(finding)); err != nil {
			return err
		}
	}
	return fmt.Errorf("doctor encontró %d problema(s) en los assets gestionados", len(report.Findings))
}

func doctorFindingLine(finding managedassets.Finding) string {
	switch finding.Code {
	case managedassets.FindingStateMissing:
		return "estado ausente      " + finding.Path
	case managedassets.FindingBundleChanged:
		return "bundle desactualizado " + finding.Expected + " -> " + finding.Actual
	case managedassets.FindingFileMissing:
		return "archivo ausente      " + finding.Path
	case managedassets.FindingFileModified:
		return "archivo modificado    " + finding.Path
	case managedassets.FindingRetiredFile:
		return "archivo retirado      " + finding.Path
	default:
		return "problema desconocido  " + finding.Path
	}
}

func runUpdatePolicyFailOpen(forced bool, dependencies cliDependencies) error {
	if err := runUpdatePolicy(forced, dependencies); err != nil {
		_, warningErr := fmt.Fprintf(dependencies.stdout, "warning: update failed: %v\n", err)
		return warningErr
	}
	return nil
}

func runUpdatePolicy(forced bool, dependencies cliDependencies) error {
	if version == "dev" {
		if forced {
			_, err := fmt.Fprintln(dependencies.stdout, "self-update is disabled for dev builds")
			return err
		}
		return nil
	}
	return dependencies.newUpdatePolicy().Run(version, forced)
}

func run(assetsDir, configDir string, all, dryRun bool) error {
	assetSource, err := sourceForAssets(assetsDir)
	if err != nil {
		return err
	}
	configDir, err = resolveConfigDir(configDir)
	if err != nil {
		return err
	}

	categories, err := catalog.Load(assetSource)
	if err != nil {
		return err
	}

	if !all {
		return tui.Run(categories, assetSource, configDir)
	}

	var items []catalog.Item
	for _, category := range categories {
		items = append(items, category.Items...)
	}
	extras := make(map[string]bool, len(install.ExtraOptions))
	for _, extra := range install.ExtraOptions {
		extras[extra.Key] = true
	}

	if dryRun {
		plan, err := install.PlanInstallation(install.InstallationRequest{
			Items: items, Extras: extras, Assets: assetSource, ConfigDir: configDir,
		})
		if err != nil {
			return err
		}
		for _, line := range plan {
			fmt.Println(line)
		}
		return nil
	}
	report, err := managedassets.Apply(install.InstallationRequest{
		Items: items, Extras: extras, Assets: assetSource, ConfigDir: configDir,
	})
	for _, line := range report {
		fmt.Println(line)
	}
	return err
}

func resolveConfigDir(configDir string) (string, error) {
	if configDir != "" {
		return configDir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "opencode"), nil
}

func sourceForAssets(directory string) (assets.Source, error) {
	if directory != "" {
		return assets.Directory(directory), nil
	}
	embedded, err := fs.Sub(embeddedAssetTree, "assets")
	if err != nil {
		return assets.Source{}, fmt.Errorf("opening embedded assets: %w", err)
	}
	return assets.Embedded(embedded), nil
}
