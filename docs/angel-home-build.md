# Restore the Angel AI home layout

The Angel build of OpenCode 2.0.18 places the blue Angel AI logo and MCP status
above the prompt, replacing the official central logo. It restores the layout
from OpenCode 1 while retaining the v2 prompt, shortcuts and other functionality.

The patch adds `home.logo` around the existing logo and advertises that capability
to plugins. The Angel plugin replaces that slot. If the plugin is disabled, the
host displays its original logo. On an unpatched official host, the plugin keeps
its supported footer fallback. No private render-tree manipulation is used.

## Build and install

Requirements: Git, npm, Python 3 and sufficient disk space for the upstream
workspace. Bun 1.4.2 is downloaded into npm's tool cache without replacing your
global Bun. The script builds for the current platform, including the web UI.

```sh
scripts/build-opencode-home.sh
go run ./cmd/migrate-v2 --apply
python3 scripts/install-opencode-home.py .build/opencode/cli-darwin-arm64/bin/opencode
opencode
```

Change `cli-darwin-arm64` to the generated platform directory on another host.
`ANGEL_OPENCODE_SOURCE=/path/to/source` can reuse a source checkout. The script
requires the exact pinned revision and refuses unrelated tracked edits.
The default source cache is `~/.cache/angel-ai/opencode-2.0.18`.

The installer keeps both the original command entry, including relative symlinks,
and a copy of the executable. It places the new binary under
`~/.local/share/angel-ai/opencode/2.0.18-home1/` and changes the existing `opencode`
command entry to point to its launcher. If that entry is a regular executable,
it is backed up and replaced; if it is a symlink, its package-manager target
remains intact. `--command` and `--install-dir` support alternate locations.

The displayed/protocol version stays 2.0.18 so the client can use the existing
2.0.18 background service. This is a custom build, not an official release.
The launcher disables automatic CLI updates to avoid losing the patch. Global
package-manager upgrades may replace the launcher; rebuild and retest the patch
before adopting a new OpenCode version. Updating the Angel plugin alone does
not rebuild the CLI.

## Restore the original command

The installer prints the exact backup directory and restore command:

```sh
python3 scripts/install-opencode-home.py --restore /path/printed/by/installer
```

Restore checks that the command still points to this launcher before replacing
it. The plugin then automatically uses the official footer layout again.
The executable backup is separate from the config backup documented in the
[migration guide](opencode-v2-migration.md).

## Source and validation

- Upstream: `anomalyco/opencode`, commit `cd9a14a6b688d4021bee381dfd39d2cef9c0f862`.
- Patch: [`opencode-2.0.18-home-logo.patch`](../patches/opencode-2.0.18-home-logo.patch), three files.
- Upstream checks: `bun run check`, 35 packages; 74 focused TUI/plugin tests.
- Angel checks: TypeScript, ten Bun tests, Go tests, installer/rollback tests.
- Real terminal checks: 180×55, 110×40 and 80×24. The official binary fails the
  same placement test; the patched binary passes. Short windows show a compact
  Angel link to avoid hiding the prompt.

To reproduce the live terminal check with the user's installed configuration:

```sh
python3 -m venv .build/terminal-tools
.build/terminal-tools/bin/pip install pyte Pillow
.build/terminal-tools/bin/python tests/native_home_smoke.py "$(command -v opencode)" \
  --output .build/screenshots/angel-installed
```

The check does not submit a model prompt. It expects an Angel-Orchestrator input
and the Angel MCP panel. Add `--png` on macOS to render the captured terminal cells
using Menlo. This image is a rendering of PTY output, not a Ghostty screenshot.

On the development Mac, the installed command backup is
`~/.local/share/angel-ai/opencode/backup-20260929-001107-878426`.
