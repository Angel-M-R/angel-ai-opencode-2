# cmux OpenCode 2 integration

These adapters port the cmux 0.64.20 (100), build `14e3400b9` hook snapshot
from the original Angel AI repository to the native OpenCode 2.0.18 server API.
The original snapshot came from `cmux hooks opencode install`.

The port maps native session, text, permission and simple form events to cmux
Feed/session hooks. Rich or conditional forms retain the native OpenCode UI.
Permission decisions remain scoped to the originating request; the adapter does
not apply blanket session permission changes.

Launch `opencode --standalone` inside cmux so its private server inherits the
current `CMUX_SURFACE_ID`. The shared background service may belong to another
terminal and cannot reliably identify that surface. Outside cmux both adapters
are dormant. Restored sessions launch the TUI with `--standalone`, not a copy
of the v2 server process arguments.

Installation copies these files; it never runs the cmux generator. Running the
upstream generator again may replace them with incompatible v1 files. Update
these adapters and their tests deliberately after checking the cmux version.
Live Feed and restored-session verification still requires a cmux host.

Current SHA-256 digests:

- `cmux-session.js`: `860bef6efb4679f80fd49f61a5e1078dbceeb519d28eb212d76e3a0f21046c0a`
- `cmux-feed.js`: `ad3026081d3d63400b52cb13ee124c6ca0880d7ead8c8b8a0c82ab195a0ffd2c`
