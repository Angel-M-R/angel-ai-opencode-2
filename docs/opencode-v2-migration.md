# Migrate Angel AI to OpenCode 2.0.18

This migration ports the installed UI and server plugins to v2 while preserving
user configuration. The [Angel home build](angel-home-build.md) adds the missing
`home.logo` slot to restore the v1 layout above the prompt. On official OpenCode,
the same plugin falls back to `home.footer`. See the [API research](research/opencode-v2-migration.md)
for official documentation and source references.

## Apply from this checkout

1. Install OpenCode 2.0.18 and launch it once. It creates `cli.json` from
   `tui.json`. Close the TUI before migrating.
2. Back up `~/.config/opencode` outside that directory. Keep the backup private:
   configuration can contain credentials. The migration also creates timestamped
   backups beside every file it changes.
3. Run the preview and inspect the file list:

   ```sh
   go run ./cmd/migrate-v2
   go run ./cmd/migrate-v2 --apply
   opencode reload
   opencode
   ```

Use `--target /path/to/opencode-config` for another installation. The migration
only reconciles recognized installed plugins. Unknown entries are preserved.
It does not reinstall agents, change model assignments, rewrite MCP definitions,
upgrade the Engram binary/database, or overwrite `AGENTS.md`.

The migration does not rebaseline `.angel-ai-state.json`. An existing v1 `doctor`
can therefore report drift, and `sync` can stop on that drift. Use this migration
command to refresh these ports. Review a new wizard installation before adopting
its inventory, especially if agent prompts have local edits.

## What changed

| Component | v2 implementation |
|---|---|
| TUI configuration | `cli.json`, `plugins` array, theme object |
| Angel AI and MCP | Above the prompt in the Angel build; footer fallback on official OpenCode; `/angel-mcps` |
| Open in App | Native sidebar and `/open-in-app`, Alt+O |
| Subagent status | Native session family and outcome data |
| Claude authentication | Pinned `opencode-claude-auth-v2@0.4.0-beta.5` |
| cmux | Native event adapters; use `opencode --standalone` inside cmux |

TUI plugins are installed as directories, so OpenCode can resolve the native
`tui.tsx` entrypoint. Solid/OpenTUI are supplied by the host. Do not add these
UI plugins to the server's `opencode.json` plugin list. Server hooks under
`plugins/` are auto-discovered and should not also be configured explicitly.

After the native plugin migration, run the separate
[retired-integration cleanup](retired-integrations.md). It removes the v1
workflows and selected MCP connections; the migration above deliberately
preserves existing configuration until that explicit cleanup step.

## Verify

```sh
opencode --version
opencode api get /api/plugin
opencode mcp list
```

Open `/plugins` in the TUI and check for failures. Check `/open-in-app`, then open a session with delegated workers.
A short terminal deliberately uses a compact Angel AI footer to keep the prompt
visible. Enlarge the terminal to see the full MCP table.

Claude Code credentials already on the machine can be imported with:

```sh
opencode auth login anthropic --method claude-code
```

## Previous migration verification

Before the cleanup, this Mac passed a real Claude request and General Agent
delegation, native plugin loading, and PTY checks of the restored home layout.
Those results describe the parent migration. See the cleanup guide for the
remaining integration set and its checks. cmux is absent on this machine, so
its hooks load but a live Feed/restore check still requires a cmux host.

## Recovery

Close OpenCode and restore the backed-up config directory as a whole (keep the
migrated directory separately if you may need its changes). Reload OpenCode after
restoring. Individual `.bak-*` files can restore individual edits, but restoring
only `cli.json` will not undo server plugin changes. The former `tui.json` is
left in place. Using the full v1 setup also requires a compatible OpenCode 1 CLI.

For this machine, the full pre-migration config backup is:
`~/.local/state/angel-ai/backups/opencode-v2-20260928-234514`.
The Engram database was not migrated. Reauthentication changes stored credentials
outside the config backup; repeat the appropriate auth command if needed.

## Develop and test

```sh
go test ./...
/bin/sh tests/install_integration_test.sh
bun install --frozen-lockfile
bun run typecheck
bun run test
```

Pinned port origins and licenses are recorded in
[plugin provenance](plugin-provenance.md).

The follow-up home-layout change was also checked in real PTYs at 180×55,
110×40 and 80×24, with the MCP panel above the prompt and no official logo.
The official executable reproduces the prior failure with the same test.
The patched upstream passed `bun run check` across 35 packages and 74 focused
TUI/plugin tests. The launcher installer/rollback tests cover both a regular
command file and a relative symlink.
