# Angel AI for OpenCode 2

This repository migrates Angel AI to **OpenCode 2.0.18**. It started from
[`angel-ai-opencode` main at `5a82759`](https://github.com/Angel-M-R/angel-ai-opencode/commit/5a827596e3be77d5a7187d4f30f366ea26ede1b1).
The original repository remains the OpenCode 1 version.

The [Angel home build](docs/angel-home-build.md) restores the v1 layout: the blue
Angel AI logo and MCP table appear above the prompt, replacing the official logo.
It applies a small, pinned patch to OpenCode 2.0.18. Stock OpenCode remains
supported through a footer fallback. Open in App, OpenSpec progress, subagent
monitoring and SDD profiles use native v2 plugins.

## Migrate an existing installation

Open OpenCode 2 once so it converts `tui.json` to `cli.json`, then close the TUI.
From this checkout, preview and apply the plugin migration:

```sh
go run ./cmd/migrate-v2
go run ./cmd/migrate-v2 --apply
opencode reload
opencode
```

The migration backs up changed files and preserves agent prompts, model choices,
MCP definitions and permissions. See the [migration and recovery guide](docs/opencode-v2-migration.md)
for backup, authentication and verification commands.

There is no published v2 Angel AI release yet. Use this checkout; the updater
now targets this repository and will not fetch an OpenCode 1 bundle.
For a fresh installation, `go run .` opens the installer wizard. Go is required
for these source commands; Bun is required only for plugin development tests.

## Harness design comparison

The comparison covers agents, planning and interviews, memory, specs, token
savings, and final code review across eight harnesses.

Because every OpenCode subagent can run on its own model, the harness can mix
them by role: a highly capable model as the orchestrator, cheaper models as the
executor workers, and a different model again for the reviewers. The wizard's
agent-models step configures this per-agent selection.

**[Read the full design comparison](docs/harness-comparison.md)**

## Orchestrator workflow

The [`angel-orchestrator`](assets/agents/angel-orchestrator.md) agent is a thin
coordinator: it interviews the user, builds a confirmed Brief, routes the work
through Direct workers or the OpenSpec workflow, and closes with an optional
review gate.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/orchestrator-workflow-dark.svg">
  <img alt="Orchestrator workflow: a user prompt is triaged; trivial changes take the quick lane, everything else goes through the interview gate, is routed to Direct workers or the OpenSpec agents, and both routes close at the review gate." src="docs/diagrams/orchestrator-workflow.svg" width="1416">
</picture>

## What it does

Angel AI creates or updates the selected files under `~/.config/opencode/`.
When a managed file already exists and its contents change, the installer first
creates a timestamped backup. Agent, skill, theme, and plugin assets are updated
file by file, so files not managed by Angel AI remain untouched. `AGENTS.md` is
the only full replacement; `opencode.json` and `cli.json` are merged with the
existing configuration.

After a successful installation, Angel AI writes
`~/.config/opencode/.angel-ai-state.json`. The file records the selected assets,
extras, agent model assignments, current asset bundle digest, and the digest of
each installed file. `angel-ai doctor` compares that record without changing
the target. `angel-ai sync` uses the same installer planner with the saved
selection. It stops before writing if a managed file is missing or differs from
the last recorded digest. It checks that digest again when the installer reads
each destination for writing.

The inventory hashes the complete bytes of merged JSON destinations such as
`opencode.json`. `sync` does not infer field-level ownership, so any later edit
to one of those files blocks the managed update. Rerun the wizard when you want
to accept the current file as a new installation baseline.

`sync` uses a conservative policy for selected directories. A file added to the
new bundle is installed only if its destination is still absent. A file removed
from the bundle is reported as `retired_file` while its installed copy remains;
`doctor` and `sync` leave that copy and the old state unchanged. Move or remove
the retired file, then rerun `sync` to update the inventory. The state file is
saved after the installer finishes. If that final save fails, the command
reports that the assets may already be installed and asks you to fix the target
and rerun the installer.

| File modified | What it is |
|---|---|
| **Agents config** | |
| `~/.config/opencode/agents/*.md` | Selected [agent definitions](assets/agents/) are created or replaced. Each file contains YAML frontmatter and a system prompt. |
| `~/.config/opencode/skills/<skill>/**` | Selected [skills](assets/skills/) are updated recursively. Additional files already present in the destination are preserved. |
| `~/.config/opencode/AGENTS.md` | The existing file is fully replaced with the [global Angel AI rules](assets/agents-md/AGENTS.md), plus the [CodeGraph guidance](assets/integrations/codegraph/AGENTS.md) when selected. |
| **TUI config** | |
| `~/.config/opencode/plugins/cmux-*.js` | The [cmux session and feed plugins](assets/integrations/cmux/) are created or replaced when the cmux integration is selected. |
| `~/.config/opencode/themes/*.json` | Selected [themes](assets/themes/) are created or replaced. |
| `~/.config/opencode/tui-plugins/*` | The selected [Angel AI TUI plugins](assets/tui-plugins/) are created or replaced. |
| `~/.config/opencode/opencode.json` | The [MCP](assets/fragments/mcp.json), [permission](assets/fragments/permissions.json), and [settings](assets/fragments/settings.json) fragments are deep-merged into the existing configuration. Selected agent models, CodeGraph, and tsgo settings are also reconciled without removing unrelated keys. |
| `~/.config/opencode/.angel-ai-state.json` | The versioned selection and file inventory used by `doctor` and `sync`. The state file is written atomically with mode `0600`. |

## Extras

The last wizard step offers standalone integrations and UI toggles.

- **[CodeGraph](https://github.com/colbymchenry/codegraph)**: installs the
  CLI, registers the local MCP server, and appends its guidance to `AGENTS.md`.
- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)**: installs or updates
  the official OpenSpec CLI.
- **[tsgo](https://github.com/microsoft/typescript-go)**: installs or updates
  tsgo and configures it as the TypeScript LSP.
- **[Angel AI logo](assets/tui-plugins/)**: custom ASCII logo plus MCP status
  in the TUI footer.
- **[one-dark-pro theme](assets/themes/one-dark-pro.json)**: sets one-dark-pro
  as the TUI theme (`cli.json`).
- **[Subagent statusline](https://github.com/Joaquinvesapa/sub-agent-statusline)**:
  vendored v2 plugin showing worker activity in the sidebar.
- **[Open in App](https://github.com/Angel-M-R/opencode-open-in-app)**: local v2
  plugin that opens files and resources in their native applications.
- **[OpenSpec task TUI](https://github.com/Angel-M-R/opencode-openspec-task-tui)**:
  local v2 plugin showing OpenSpec task progress in the sidebar.
- **SDD profiles and Engram hooks**: optional native v2 adapters. Engram hooks
  retain the installed Engram 1.20 HTTP contract.
- **[cmux](https://cmux.com)**: cmux notifications and Feed for OpenCode
  sessions.

## Usage from the repository

```sh
go run .                  # opens the wizard
go run . --all            # installs everything without the TUI
go run . --all --dry-run  # shows the plan without changing anything
go run . --target /path   # installs in another directory (for testing)
go run . doctor --target /path
go run . sync --dry-run --target /path
```
