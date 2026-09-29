# Retire the OpenCode 1 integrations

This cleanup removes Engram, SDD profiles, OpenSpec, Notion, Supabase, Railway
and CodeGraph. It builds on the OpenCode 2 migration already merged into `main`.

The installer no longer ships their plugins, agents, CLI installers or workflow
commands. The orchestrator keeps interviews, a confirmed Brief, bounded `general`
workers, integrated validation and optional reviewers. Angel branding, themes,
Open in App, subagent monitoring, cmux and tsgo remain available. Context7,
Chrome DevTools and unrelated MCP configuration are preserved.

## Existing installations

Close the TUI, then run from this checkout:

```sh
python3 scripts/remove-retired-integrations.py
python3 scripts/remove-retired-integrations.py --apply
opencode reload
opencode
```

Use `--target /path/to/config` for a different installation. Preview is the
default. All JSON inputs are validated before writing. JSONC files require conversion
to JSON first; the tool stops instead of editing them incompletely. The command removes
recognized retired MCP/agent/plugin entries from `opencode.json`, `cli.json`
and legacy `tui.json`, removes their known package dependencies, including optional
dependencies, and local `.patch` files owned only by retired packages,
and archives their installed hooks, UI directories, worker prompts and skills.
It also removes the managed CodeGraph guidance block, installs the revised
orchestrator and product interview skill, and drops retired inventory selections.
Shared skill symlinks are replaced locally; their external targets are untouched.
Patch files outside the configuration directory or still referenced by retained
packages are preserved. If such a patch lives inside a directory being retired,
move it and update its registration before cleanup. Unknown integrations and
permissions are preserved. Custom copies of replaced prompts remain in the backup.

The command makes a private configuration snapshot before editing. It includes
nested `node_modules` inside directories being removed, so rollback restores them
completely, and excludes unrelated dependency caches. Backups are stored
under `~/.local/state/angel-ai/backups/retired-*`. A write failure
restores edited paths. Successful repeated runs make no changes or new backups.
It preserves pre-existing inventory drift instead of silently accepting it;
`doctor` may still report changes from the earlier v2 migration. Review a wizard
installation before adopting a new inventory baseline.

Engram databases, existing project specifications, CodeGraph indexes, credentials,
and shared global CLI installations are not deleted. Dependency caches and lockfiles
may retain unused packages; `bun install --ignore-scripts` in the config directory
refreshes the lockfile from the cleaned package manifest. No retired plugin remains
registered or auto-loaded by the cleaned configuration.

## Recovery and verification

To undo, close OpenCode, move the current configuration aside and restore the
backup's `config` directory at the original location. Run `bun install
--ignore-scripts` there if restoring package dependencies, then `opencode reload`.
The configuration snapshot does not contain external databases or credentials.
The earlier full migration backup remains independent of this cleanup.

Verify with `opencode mcp list`, `opencode api get /api/plugin` and `/plugins` in
the TUI. The three retained UI plugins are Angel logo/MCP, Open in App and subagent
statusline. No SDD menu or OpenSpec progress panel should load. In the Angel home
build, branding and the remaining MCP table still appear above the prompt.

Repository checks:

```sh
go test ./...
/bin/sh tests/install_integration_test.sh
bun run typecheck
bun run test
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

The cleanup tests cover preservation of unrelated configuration, preview,
idempotence, exact backups, failure rollback, shared symlink isolation and
inventory drift. Prompt wording is not pinned by tests.

## Verification on this Mac

After cleanup, Chrome DevTools and Context7 connect; Plane remains disabled.
The Engram server hook is absent from the native plugin list. The real PTY home
check at 180×55 renders the Angel logo and those MCP rows above the prompt,
without the official logo. A real request through Angel-Orchestrator returned
`ANGEL_CLEANUP_OK`. Go tests, 12 installer integration cases, TypeScript
checking, 6 Bun tests and 7 Python tests passed.

The installed `angel-ai` command was rebuilt from this branch (`dev`, automatic
updates disabled). Its previous binary and the full configuration snapshot are
in `~/.local/state/angel-ai/backups/retired-20260929-083850-51ug0rhq`.
The local dependency lockfile was refreshed with `bun install --ignore-scripts`.
Restoring the prior installer additionally requires copying
`angel-ai-before-cleanup` from that backup to `~/.local/bin/angel-ai`.
