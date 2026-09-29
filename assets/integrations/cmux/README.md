# cmux OpenCode 2 integration

These adapters port the cmux 0.64.20 (100), build `14e3400b9` hook snapshot
from the original Angel AI repository to the native OpenCode 2.0.18 server API.
The original snapshot came from `cmux hooks opencode install`.

The port maps native session, text, permission and simple form events to cmux
Feed/session hooks. Rich or conditional forms retain the native OpenCode UI.
Once/always/reject responses address the originating request. The explicit
`all` and `bypass` Feed choices install session-wide wildcard rules; plan approval
modes update session edit, shell and external-directory permissions.

Launch `opencode --standalone` inside cmux so its private server inherits the
current `CMUX_SURFACE_ID`. The shared background service may belong to another
terminal and cannot reliably identify that surface. Outside cmux both adapters
are dormant. Restored sessions launch the TUI with `--standalone`, not a copy
of the v2 server process arguments.

Installation copies these files; it never runs the cmux generator. Running the
upstream generator again may replace them with incompatible v1 files. Update
these adapters and their tests deliberately after checking the cmux version.
Live Feed and restored-session verification still requires a cmux host.
