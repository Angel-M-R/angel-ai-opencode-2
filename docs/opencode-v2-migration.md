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
| OpenSpec tasks | Native session sidebar, project-specific task progress |
| Subagent status | Native session family and outcome data |
| SDD/Engram menu | `/sdd-model`, native dialogs and storage; hide empty model badge |
| Engram hooks | Native server events/hooks adapted to Engram 1.20 HTTP |
| Claude authentication | Pinned `opencode-claude-auth-v2@0.4.0-beta.5` |
| cmux | Native event adapters; use `opencode --standalone` inside cmux |

TUI plugins are installed as directories, so OpenCode can resolve the native
`tui.tsx` entrypoint. Solid/OpenTUI are supplied by the host. Do not add these
UI plugins to the server's `opencode.json` plugin list. Server hooks under
`plugins/` are auto-discovered and should not also be configured explicitly.

SDD profiles still use legacy `agent` JSON configuration, which OpenCode 2.0.18
accepts. Activation preserves file references, backs up the configuration and
writes atomically. Invalid JSON/JSONC and native `agents` configurations fail
closed; convert/review those before using profile activation. v1 preference
storage is not generally readable through the v2 API; UI preferences may reset.

## Verify

```sh
opencode --version
opencode api get /api/plugin
opencode mcp list
```

Open `/plugins` in the TUI and check for failures. Check `/open-in-app` and
`/sdd-model`, then open a session with an OpenSpec change and delegated workers.
A short terminal deliberately uses a compact Angel AI footer to keep the prompt
visible. Enlarge the terminal to see the full MCP table.

Claude Code credentials already on the machine can be imported with:

```sh
opencode auth login anthropic --method claude-code
```

Reconnect MCP services when requested by v2:

```sh
opencode mcp auth notion
opencode mcp auth railway
```

These commands require the account owner's browser authorization. Disabled MCP
servers stay disabled. No migration can substitute for the OAuth approval.

## Verification performed on this Mac

- OpenCode 2.0.18 loaded all five TUI plugins and the four external server plugins.
- Angel-Orchestrator completed a real Claude request (`ANGEL_V2_OK`) and a real
  General Agent delegation (`ANGEL_DELEGATION_OK`). The subagent footer updated
  from running to completed.
- CodeGraph, Context7, Chrome DevTools and Engram connected. Notion authorization
  is left to the owner; Railway already required authorization before migration.
- Go unit tests, twelve installer integration cases, TypeScript checking, and
  ten Bun tests passed. Tests cover MCP rendering, Engram root-session attribution
  and redaction, SDD config preservation, OpenSpec parsing and subagent outcomes. OpenSpec sidebar rendering and home command registration
  are exercised through OpenTUI with controlled fixtures.
- cmux is not available on PATH on this machine: its adapters load but are dormant
  outside cmux. A live cmux Feed/restore check remains necessary on a cmux host.
- Open in App and SDD management menus were opened successfully in the live TUI.
- SDD profile activation is covered with temporary config files; the user's
  actual profiles and memories were not changed or deleted for testing.

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
