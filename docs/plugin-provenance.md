# Native v2 plugin sources

Vendored plugins retain their MIT licenses next to the source. These copies are
owned by this migration; they do not automatically track upstream branches.

| Installed component | Source and revision | Local adaptation |
|---|---|---|
| Angel logo/MCP | Angel AI assets from base `5a827596e3be77d5a7187d4f30f366ea26ede1b1` | Native home footer, status objects, theme and commands |
| Open in App | [Angel-M-R/opencode-open-in-app](https://github.com/Angel-M-R/opencode-open-in-app) `6569d529fe030cb82a2f344fa358b8575c76be99` | Native plugin, sidebar, dialog and preference store |
| OpenSpec tasks | [Angel-M-R/opencode-openspec-task-tui](https://github.com/Angel-M-R/opencode-openspec-task-tui) `b0bb42a62a24c2178da5c44d1531c8ff72e06591` | Native plugin, session location, theme and storage adapters |
| Subagent monitor | [Alanhiram75/sub-agent-statusline](https://github.com/Alanhiram75/sub-agent-statusline/tree/a585b0923a0c1382bba69c14f78d733eee6a3d44) | Pinned v2 port; local import layout |
| SDD/Engram UI | [OJPalenzuela/sdd-engram-plugin](https://github.com/OJPalenzuela/sdd-engram-plugin/tree/c7048a01c58bd7db52bcef4c736ae3bdf51416c0) | Config root, fail-closed atomic writes/backups, TSX runtime resolution, hide empty badge |
| Engram server hooks | Installed Engram 1.20 OpenCode adapter, [Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram) | Native event/hook bridge, Node process calls, root-session checks, bounded prompt deduplication; retains legacy HTTP API |
| cmux hooks | Files embedded in the original Angel AI base | Native events/permissions/forms, standalone launch restoration, cleanup |

Claude auth is installed from npm at the exact version
`opencode-claude-auth-v2@0.4.0-beta.5`, from
[heymaaz/opencode-claude-auth-v2](https://github.com/heymaaz/opencode-claude-auth-v2).
It is a community beta port. The inspected source revision was
`ca2800d3ea4045b8b5a4f6afd1e28bee6027fbfa`; npm reports integrity
`sha512-dVA2AY58JxrZP3QqetevB3yebwQLVoMGyBFrPbJPDdCgJ94UEzQpK9/5Jk0Ibeyeom5mWD/HInaJgfX9O5MljA==`.
Its successful live authentication/model test does not establish compatibility
with future OpenCode releases.

The newer Engram v2.2 adapter investigated in the research report was not adopted:
it requires HTTP/database features absent from the installed Engram 1.20 binary.
