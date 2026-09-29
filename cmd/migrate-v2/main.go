// migrate-v2 migrates existing Angel integrations without reinstalling agents or CLIs.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"angel-ai-opencode/internal/assets"
	"angel-ai-opencode/internal/install"
)

func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		fail(err)
	}
	target := flag.String("target", defaultConfigDir(home), "OpenCode config directory")
	source := flag.String("assets", "assets", "Angel v2 assets directory")
	apply := flag.Bool("apply", false, "apply migration with timestamped backups; default is preview")
	flag.Parse()
	absolute, err := filepath.Abs(*target)
	if err != nil {
		fail(err)
	}
	request, err := install.V2MigrationRequest(assets.Directory(*source), absolute)
	if err != nil {
		fail(err)
	}
	var lines []string
	if *apply {
		lines, err = install.ApplyInstallation(request)
	} else {
		lines, err = install.PlanInstallation(request)
	}
	for _, line := range lines {
		fmt.Println(line)
	}
	if err != nil {
		fail(err)
	}
	if !*apply {
		fmt.Println("Preview only. Pass --apply to migrate.")
	}
}
func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }

func defaultConfigDir(home string) string {
	if target := os.Getenv("OPENCODE_CONFIG_DIR"); target != "" {
		return target
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "opencode")
}
