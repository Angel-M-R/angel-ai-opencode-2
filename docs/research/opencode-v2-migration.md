# OpenCode 2.0.18 migration findings

Research date: 2026-09-28. Target: OpenCode `2.0.18`, upstream tag `v2.0.18`, commit `cd9a14a6b688d4021bee381dfd39d2cef9c0f862`. This report distinguishes upstream contracts from migration recommendations. The version matters: the unversioned documentation and upstream `dev` branch still contain the older `@opencode-ai/plugin` API. The current official documentation lives under `/v2/docs/`. Use those guides and the tagged v2 sources below when implementing this migration. [Release](https://github.com/anomalyco/opencode/releases/tag/v2.0.18), [v2 plugin package](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/package.json), [older public plugin documentation](https://opencode.ai/docs/plugins/).


Official v2 guides:

- [Configure and manage plugins](https://opencode.ai/v2/docs/plugins).
- [Build server plugins](https://opencode.ai/v2/docs/build/plugins).
- [Build CLI plugins](https://opencode.ai/v2/docs/build/plugins/cli).
- [Migrate plugins from v1](https://opencode.ai/v2/docs/build/plugins/migrate-v1).

The migration guide confirms that v1 implementations must be ported even when configuration normalizes successfully. It also distinguishes prompt admission from context transformation and maps old auth hooks to the integration API. These are behavioral changes, not just renamed methods.

## What breaks

The runtime still uses Solid and OpenTUI, but its plugin contract has changed. Changing the import alone cannot migrate Angel's `assets/tui-plugins/angel-logo.tsx`: the entrypoint, state access, theme tokens, command registration, slots and configuration all differ. The server loader also rejects legacy functions returning hook objects. It requires a default object containing `id` and `setup` or `effect`; there is no legacy hook-object adapter in this loader. [TUI definition](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/tui/plugin.ts), [server loader](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/core/src/plugin/module.ts).

| Area | v1 contract used by Angel | v2.0.18 contract |
| --- | --- | --- |
| TUI package | `@opencode-ai/plugin/tui` | `@opencode/plugin/tui` |
| TUI definition | default `{ id, tui(api) }` | default `Plugin.define({ id, setup(context) })` |
| TUI configuration | `tui.json`, `plugin`, `theme: string` | `cli.json`, `plugins`, `theme: { name, mode }` |
| Slot registration | `api.slots.register(...)` | `context.ui.slot({ append/prepend/before/after/replace: path, render })` |
| MCP state | `api.state.mcp()` and old config records | `context.data.location.mcp.server.list(location)` |
| MCP status | `item.status` | `item.status.status`; includes `pending` |
| Theme access | `api.theme.current.textMuted` | `context.theme.text.muted` |
| Commands | `api.command` / old keymap methods | `context.keymap.layer(() => ({ commands: [...] }))` |
| Persistent state | `api.kv` | `context.storage.store(key, { initial })` |
| Cleanup | lifecycle callbacks | Return a cleanup function from `setup`; slot registration also returns a disposer |
| Server plugins | exported async functions returning hooks | `Plugin.define({ id, setup(ctx) })` from `@opencode/plugin`, imperative domain hook registration |

Sources: [TUI context](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/tui/context.ts), [CLI schema](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/cli/src/config/schema.ts), [TUI config](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/config/index.tsx), [Promise plugin API](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/README.md).

## TUI plugin packaging and configuration

Use a plugin directory with `tui.tsx` as its TUI entrypoint. The resolver looks for the `tui` subpath; server entrypoints resolve through `server` or the package root. TUI auto-discovery enumerates directories under global and project `plugins/`, rather than standalone `.tsx` files. A configured directory can also live elsewhere, allowing Angel to retain a dedicated installation directory. Npm packages should expose separate `./tui` and `./server` entrypoints when they implement both. [Entrypoint resolver](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/host.ts), [TUI discovery](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/plugin/discovery.ts).

An appropriate `~/.config/opencode/cli.json` declaration is:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "theme": { "name": "angel", "mode": "dark" },
  "plugins": [
    { "package": "./tui-plugins/angel-logo", "options": {} }
  ]
}
```

The theme name above is illustrative; retain the actual installed Angel theme name. V2 automatically imports legacy `tui.json` and stored UI preferences only when `cli.json` does not already exist. Continuing to update `tui.json` after that migration does not update the active CLI config. Legacy `plugin_enabled` entries become ordered plugin directives. Disable directives prefix the plugin id with `-`. Builtin ids have also changed, for example `opencode.sidebar.mcp` and `opencode.home.footer`. [CLI config loading](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/cli/src/config/config.ts), [migration](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/cli/src/config/migrate.ts), [builtin MCP plugin](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/feature-plugins/sidebar/mcp.tsx), [builtin home footer](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/feature-plugins/home/footer.tsx).

The published plugin package is version `2.0.18`. Its peer requirements include OpenTUI core and Solid `>=0.5.12`, and SolidJS `>=1.9.0`. Pin development contract checks to the installed OpenCode version instead of installing old `@opencode-ai/*` packages or checking against the unrelated upstream `dev` API. [Package manifest](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/package.json).

## Recovering Angel's interface

The supported slot paths in this version are exactly:

```text
app
home.footer
home.footer.status
prompt.footer
prompt.footer.status
prompt.footer.file
session.composer.top
session.panel
sidebar.content
sidebar.footer
```

Slots compose in plugin enable order. Replacing a slot suppresses its original content and descendant contributions. Replacing a nonexistent slot does not create it. Additive claims to an absent path fall back to the nearest surviving ancestor. [Slot contract](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/tui/context.ts).

The native home page renders its `<Logo />` directly, followed by the prompt. It exposes only `home.footer`. There is no supported `home.logo`, `home.content` or between-logo-and-prompt slot in 2.0.18. The public UI context also does not export the host Prompt component. Reproducing the screenshot exactly therefore requires an upstream extension or a fork of the host. Replacing the entire `app` slot would mean rebuilding essential host UI. An absolute overlay would depend on layout coordinates and could cover the prompt or dialogs. These are implementation conclusions drawn from the [home component](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/routes/home.tsx) and [public UI contract](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/tui/context.ts).

Recommended supported adaptation: render Angel branding and the MCP table before `home.footer`, keep the native prompt, and add compact information to `home.footer.status` or `prompt.footer.status`. The sidebar can retain the host's native MCP section or install an Angel section into `sidebar.content`. This restores useful functionality with a different home layout. It does not replace the native OpenCode logo.

MCP data is reactive. Use `context.data.location.mcp.server.list(context.location)` on home and the session's `location` in session/sidebar contributions. An undefined list means not yet loaded; call the collection's `sync(location)` when necessary. A resolved server has `{ name, status: { status, ... } }`. Supported statuses are `connected`, `pending`, `disabled`, `failed`, and `needs_auth`. `failed` and `needs_auth` carry an error. The old `needs_client_registration` state is absent. Treat `pending` separately from an unavailable list and expose actual failures. [Public data API](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/tui/context.ts), [MCP schema](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/schema/src/mcp.ts), [host sidebar implementation](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/feature-plugins/sidebar/mcp.tsx).

Map colors to semantic v2 tokens: `text.base`, `text.muted`, `text.feedback.success.base`, `text.feedback.warning.base`, `text.feedback.error.base`, `text.action.primary.selected`, and `background.base`. V2 includes a converter for legacy theme files, so preserving the installed Angel theme is possible without initially rewriting its palette. Components still need the new token names. [Resolved theme type](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/theme/src/tui/types.ts), [theme converter](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/theme/src/tui/v1-migrate.ts).

## Backend configuration, agents, skills and MCP

The native backend schema uses `agents`, `providers`, `commands`, `plugins`, ordered `permissions`, `skills: string[]`, and `mcp: { servers, timeout }`. MCP server records use `disabled` instead of `enabled`; timeout settings distinguish startup, catalog and execution. However, v2's config normalizer explicitly recognizes legacy singular field names, legacy permission formats, old `skills.paths`/`skills.urls`, and old MCP records. Preserve existing user settings and migrate managed output deliberately; a blanket rewrite of every file is unnecessary. [Native config schema](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/schema/src/config.ts), [config normalization](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/core/src/config/normalize.ts), [MCP settings](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/schema/src/mcp.ts).

V2 retains file-backed agents and skills. It also discovers compatible skills in `.claude` and `.agents` locations. This is separate from executable plugin compatibility: successfully reading an agent or theme does not imply a v1 server/TUI plugin can execute. Preserve the project's prompt prose and verify discovery, frontmatter, installation and structured contracts rather than testing sentences. [Agent loading](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/core/src/config/plugin/agent.ts), [skill loading](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/core/src/config/plugin/skill.ts), [compatibility skill discovery](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/core/src/config/plugin/compatibility.ts).

## Server hooks and authentication

Port each server plugin by behavior. New Promise plugins register callbacks through domains such as `ctx.session.hook(...)`, `ctx.aisdk.hook(...)`, `ctx.tool.transform(...)`, `ctx.event`, `ctx.provider.transform(...)`, and `ctx.integration.transform(...)`. `setup` may return cleanup, and registrations expose `dispose()`. Configuration is `ctx.options`; location is `ctx.location`. Do not wrap the old hooks object in a new default export and assume the host will consume it. [Promise API guide](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/README.md), [server context](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/promise/plugin.ts).

V2 imports legacy `auth.json` credentials into its credential database. Generic imported OAuth entries use method id `oauth`, except for specifically mapped providers. This preserves stored tokens but does not supply a provider's OAuth login, refresh or transport behavior. The bundled provider-plugin registry contains no Anthropic OAuth implementation. Consequently a legacy `opencode-claude-auth` plugin still needs its own v2 migration; credential import alone is insufficient. This conclusion follows from the [credential importer](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts) and [builtin provider registry](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/core/src/plugin/provider.ts).

The supported integration API can register an OAuth method with `integrationID`, `method`, `authorize`, and `refresh`, and can resolve the active credential using `ctx.integration.connection.active/resolve`. A migration must preserve the matching method id for imported tokens and implement any required request behavior through the v2 provider/AI hooks. Never print tokens during validation. [Integration API](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/promise/integration.ts).

## Acceptance checks

1. Load the managed plugin directory with the exact installed 2.0.18 binary and inspect plugin errors, rather than relying only on successful transpilation.
2. Verify home and session rendering at wide and narrow terminal sizes, the prompt's usability, theme colors, MCP pending/auth/disabled/error states, and plugin unload/reload.
3. Check agent and skill discovery, backend MCP connections, server plugin registrations, and authentication separately.
4. Preserve existing sessions and credentials. Verify a provider request before claiming authentication works.
5. State the home-logo limitation explicitly if using the supported footer adaptation. A working footer is not an exact restoration of the screenshots.


## Third-party plugin status and candidate ports

Checked 2026-09-28 against npm metadata and the owning repositories. Package version numbers do not establish OpenCode compatibility: `opencode-claude-auth@2.2.1` still implements the old API. The table records candidate code, not work already integrated or runtime-tested in Angel.

| Component | Latest release checked | Native v2 candidate | Pinned source commit |
| --- | --- | --- | --- |
| Claude auth | `opencode-claude-auth@2.2.1`, published 2026-09-22 | Original project PR 274; fork also publishes `opencode-claude-auth-v2@0.4.0-beta.5`, 2026-09-26 | `ca2800d3ea4045b8b5a4f6afd1e28bee6027fbfa` |
| Subagent monitor | `opencode-subagent-statusline@1.3.0`, 2026-08-07 | Open PR 99 | `a585b0923a0c1382bba69c14f78d733eee6a3d44` |
| SDD/Engram manager | `opencode-sdd-engram-manage@1.7.0`, 2026-06-29 | Open PR 53 | `c7048a01c58bd7db52bcef4c736ae3bdf51416c0` |
| Engram adapter | Engram binary `v2.2.1`, 2026-09-25 | Open PR 1240 | `c7e40c95703cdbb2fb4f74f5983e55eccfa67c05` |

Release metadata: [Claude auth registry](https://registry.npmjs.org/opencode-claude-auth), [v2 fork registry](https://registry.npmjs.org/opencode-claude-auth-v2), [subagent registry](https://registry.npmjs.org/opencode-subagent-statusline), [SDD registry](https://registry.npmjs.org/opencode-sdd-engram-manage), [Engram release](https://github.com/Gentleman-Programming/engram/releases/tag/v2.2.1). The npm package named simply `engram` is an unrelated package; do not install it for this integration.

### Claude auth candidate

Clone `https://github.com/heymaaz/opencode-claude-auth-v2.git` at the table's commit. [PR 274](https://github.com/griffinmartin/opencode-claude-auth/pull/274) reports verification against OpenCode 2.0.18, 312 isolated unit tests, native provider requests and image handling. Those are the author's results, not reproduced by this research.

The code uses native Anthropic transport plus `http.request`/`http.response` and context-family hooks. It registers an integration method `claude-code` with credential metadata identifying this plugin. Imported v1 credentials with method id `oauth` do not satisfy that guard. Run `/connect`, select Anthropic and import the Claude Code subscription to establish the matching connection. Standard API-key connections are excluded from the subscription request transforms. [Pinned implementation](https://github.com/heymaaz/opencode-claude-auth-v2/blob/ca2800d3ea4045b8b5a4f6afd1e28bee6027fbfa/src/index.ts), [OAuth method](https://github.com/heymaaz/opencode-claude-auth-v2/blob/ca2800d3ea4045b8b5a4f6afd1e28bee6027fbfa/src/oauth-method.ts).

Vendoring is feasible. Keep `src/`, the required `anthropic-prompt.txt` asset, the entrypoint and MIT license. Its manifest builds with `pnpm run build`, which runs TypeScript and copies the prompt asset. It depends on `@opencode/plugin: latest` and develops against `@opencode/client: latest`; replace these with explicit compatible versions for a reproducible Angel build. Isolated tests are preferable before any real authentication test. Credential discovery reads macOS Keychain or Claude credential files; refresh can rotate and write back those credentials. The source contains HTTP and stream transformations, account selection and identity changes, so it deserves a narrower review than merely checking that `setup` exists. [Manifest](https://github.com/heymaaz/opencode-claude-auth-v2/blob/ca2800d3ea4045b8b5a4f6afd1e28bee6027fbfa/package.json), [license](https://github.com/heymaaz/opencode-claude-auth-v2/blob/ca2800d3ea4045b8b5a4f6afd1e28bee6027fbfa/LICENSE).

### Subagent monitor candidate

Clone `https://github.com/Alanhiram75/sub-agent-statusline.git` at the pinned commit. The [PR 99 description](https://github.com/Joaquinvesapa/sub-agent-statusline/pull/99) mentions a separate `./tui-v2` export, but the current pinned manifest actually maps both root and `./tui` to `dist/tui-v2.js`. Trust the inspected manifest over the older description. The PR reports a successful isolated OpenCode 2.0.5 load and one unrelated locale-sensitive test failure.

A minimal source vendor includes `src/v2/`, `src/text-width.ts`, and the MIT license, with a local `tui.tsx` forwarding the default export. The v2 implementation uses `sidebar.content` and `home.footer.status`, session family/data APIs, durable preferences and a keymap layer owned by a mounted component. It does not need the old SQLite/log scraping implementation to render v2 sessions. The repository's full `pnpm build` also builds legacy entries; a v2-only build avoids unnecessary old dependencies. [V2 source](https://github.com/Alanhiram75/sub-agent-statusline/tree/a585b0923a0c1382bba69c14f78d733eee6a3d44/src/v2), [manifest](https://github.com/Alanhiram75/sub-agent-statusline/blob/a585b0923a0c1382bba69c14f78d733eee6a3d44/package.json), [build](https://github.com/Alanhiram75/sub-agent-statusline/blob/a585b0923a0c1382bba69c14f78d733eee6a3d44/tsup.config.ts), [license](https://github.com/Alanhiram75/sub-agent-statusline/blob/a585b0923a0c1382bba69c14f78d733eee6a3d44/LICENSE).

Its module-global state is shared within the module generation. Rendering catches some data errors and returns an empty list; test actual child-session updates before declaring the monitor restored. The candidate also converts theme RGBA values to hex, unlike the host's direct use of RGBA, so validate colors in the live TUI.

### SDD/Engram manager candidate

Clone `https://github.com/OJPalenzuela/sdd-engram-plugin.git` at the pinned commit. The original repository now resolves to `ricardo-rod/sdd-engram-plugin`. [PR 53](https://github.com/ricardo-rod/sdd-engram-plugin/pull/53) ports dialogs, profiles, memory browsing, preferences and keymaps. It reports live profile-flow testing, but explicitly does not report a working memories flow because the Engram service was down. It also reports 19 pre-existing profile-test failures.

Vendoring requires `index.tsx`, `components.tsx`, the runtime `src/` helpers and MIT license. A local `tui.tsx` can forward `index.tsx`, or build the source with `npm run build`/`pnpm build` into `dist/tui.js`. Solid universal compilation keeps host packages external. [Build](https://github.com/OJPalenzuela/sdd-engram-plugin/blob/c7048a01c58bd7db52bcef4c736ae3bdf51416c0/tsup.config.ts), [license](https://github.com/OJPalenzuela/sdd-engram-plugin/blob/c7048a01c58bd7db52bcef4c736ae3bdf51416c0/LICENSE).

Profile activation still adapts old helpers through a shim and directly writes the global `opencode.json` with `JSON.stringify`, because v2's config mutation endpoint cannot perform the old update. Its reader uses `JSON.parse`, returns `{}` on failure, and path discovery uses `XDG_CONFIG_HOME/opencode` without honoring `OPENCODE_CONFIG_DIR`. This can target the wrong config root in isolated tests; JSONC input can be lost if treated as an empty object before writing. Test and correct this path before using profile activation on real configuration. Native `agents` versus legacy `agent` precedence also needs a regression check. Memory deletion calls the local Engram HTTP API, so only exercise it with test observations. [Entrypoint and shim](https://github.com/OJPalenzuela/sdd-engram-plugin/blob/c7048a01c58bd7db52bcef4c736ae3bdf51416c0/index.tsx), [paths](https://github.com/OJPalenzuela/sdd-engram-plugin/blob/c7048a01c58bd7db52bcef4c736ae3bdf51416c0/src/config.ts), [memory client](https://github.com/OJPalenzuela/sdd-engram-plugin/blob/c7048a01c58bd7db52bcef4c736ae3bdf51416c0/src/memories.ts).

### Engram adapter candidate

Clone `https://github.com/ScorpionConMate/engram.git` at the pinned commit. Vendoring `plugin/opencode-v2/engram.ts` and the MIT license is technically simple; it uses Node builtins and `@opencode/plugin`. However, the current [PR 1240](https://github.com/Gentleman-Programming/engram/pull/1240) includes Go server/store changes as well as the adapter. The adapter now captures admitted `session.inbox.enqueued` events instead of registering the pre-admission `prompt` hook described in older PR text. It sends `source_inbox_id`, and durable duplicate suppression is implemented by this PR's Go store migration/index. Copying only the adapter onto a released binary does not reproduce that protection. Use a matching binary or supply and test an equivalent deduplication strategy. [Adapter](https://github.com/ScorpionConMate/engram/blob/c7e40c95703cdbb2fb4f74f5983e55eccfa67c05/plugin/opencode-v2/engram.ts), [adapter tests](https://github.com/ScorpionConMate/engram/blob/c7e40c95703cdbb2fb4f74f5983e55eccfa67c05/plugin/opencode-v2/engram.test.mjs), [store](https://github.com/ScorpionConMate/engram/blob/c7e40c95703cdbb2fb4f74f5983e55eccfa67c05/internal/store/store.go).

The adapter checks `engram instance-id` against the local server and depends on `/health.instance_id`, `/project/current`, `/context/compaction`, and `/sessions/:id/end`. Older binaries may leave it inactive even though the plugin loads. It can start `engram serve`, run repository memory import, persist admitted prompts and inject memory protocol/context. Its tests cover private-span redaction, truncation and avoiding child-session capture. Preserve those behaviors and set the installed binary path explicitly. The candidate build command for its matching CLI is `go build ./cmd/engram`; source-only adapter loading needs no bundle. [Setup code](https://github.com/ScorpionConMate/engram/blob/c7e40c95703cdbb2fb4f74f5983e55eccfa67c05/internal/setup/setup.go), [license](https://github.com/ScorpionConMate/engram/blob/c7e40c95703cdbb2fb4f74f5983e55eccfa67c05/LICENSE).

All four candidate repositories carry MIT licenses. A vendor copy must retain each copyright and permission notice, record the source commit, and distinguish local fixes from upstream code. This research downloaded and inspected source archives without executing their build or installation scripts.


## Implementation follow-up

The candidate assessment above records the research before implementation.
The [migration guide](../opencode-v2-migration.md) records the implemented ports,
local corrections, reproducible checks and remaining live-test limits. The
[pinned provenance](../plugin-provenance.md) identifies the adopted sources.
In particular, Angel retains Engram 1.20 rather than adopting the newer binary;
SDD config parse failures now stop writes, and updates use backups/atomic rename.
