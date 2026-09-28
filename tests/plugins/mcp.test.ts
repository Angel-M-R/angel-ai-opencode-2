import { describe, expect, test } from "bun:test"
import { resolveMcpFooterState } from "../../assets/tui-plugins/angel-logo/mcp-footer-state"
import { AngelHome } from "../../assets/tui-plugins/angel-logo/tui"
import { testRender } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"

const servers = [
  { name: "connected-server", status: { status: "connected" as const } },
  { name: "starting-server", status: { status: "pending" as const } },
  { name: "disabled-server", status: { status: "disabled" as const } },
  { name: "login-server", status: { status: "needs_auth" as const, error: "Login required" } },
]

describe("v2 MCP state", () => {
  test("distinguishes unavailable, empty and pending without inventing failures", () => {
    expect(resolveMcpFooterState(undefined)).toEqual({ status: "loading" })
    expect(resolveMcpFooterState(undefined, true)).toEqual({ status: "unavailable" })
    expect(resolveMcpFooterState([])).toEqual({ status: "empty" })
    expect(resolveMcpFooterState(servers, true)).toEqual({ status: "resolved", servers })
  })
  test("renders native v2 status objects in a tall terminal", async () => {
    const context = {
      data: { location: { mcp: { server: { list: () => servers } } } },
      theme: { text: { accent: "#00aaff", muted: "#aaaaaa", feedback: {
        success: { base: "#00ff00" }, warning: { base: "#ffff00" }, error: { base: "#ff0000" },
      } } },
    } as unknown as Plugin.Context
    const rendered = await testRender(() => AngelHome({ context }), { width: 160, height: 60 })
    try {
      await rendered.renderOnce()
      const frame = rendered.captureCharFrame()
      for (const item of servers) expect(frame).toContain(item.name)
      expect(frame).toContain("authentication required")
      expect(frame).toContain("connecting")
    } finally { rendered.renderer.destroy() }
  })
})
