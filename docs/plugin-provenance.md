# Native v2 plugin sources

Vendored plugins retain their MIT licenses next to the source. These copies are pinned snapshots; they do not automatically track upstream branches.
Open in App is not vendored: the installer adds the npm package
[`opencode-open-in-app`](https://www.npmjs.com/package/opencode-open-in-app)
to `cli.json`, and OpenCode installs it.

| Installed component | Source and revision | Local adaptation |
|---|---|---|
| Angel logo/MCP | Angel AI assets from base `5a827596e3be77d5a7187d4f30f366ea26ede1b1` | Central logo slot on the patched host, official footer fallback, status objects and commands |
| Subagent monitor | [Alanhiram75/sub-agent-statusline](https://github.com/Alanhiram75/sub-agent-statusline/tree/a585b0923a0c1382bba69c14f78d733eee6a3d44) | Pinned v2 port; local import layout |

Claude auth is installed from npm at the exact version
`opencode-claude-auth-v2@0.4.0-beta.5`, from
[heymaaz/opencode-claude-auth-v2](https://github.com/heymaaz/opencode-claude-auth-v2).
It is a community beta port. The inspected source revision was
`ca2800d3ea4045b8b5a4f6afd1e28bee6027fbfa`; npm reports integrity
`sha512-dVA2AY58JxrZP3QqetevB3yebwQLVoMGyBFrPbJPDdCgJ94UEzQpK9/5Jk0Ibeyeom5mWD/HInaJgfX9O5MljA==`.
Its successful live authentication/model test does not establish compatibility
with future OpenCode releases.

The optional OpenCode executable uses upstream commit
`cd9a14a6b688d4021bee381dfd39d2cef9c0f862` plus
[`opencode-2.0.18-home-logo.patch`](../patches/opencode-2.0.18-home-logo.patch).
The upstream [MIT license](../patches/OPENCODE-LICENSE) is retained.
