import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"
import angel from "../../assets/tui-plugins/angel-logo/tui"
import openInApp from "../../assets/tui-plugins/open-in-app/tui"

function host() {
  const slots: any[] = [], commands: any[] = []
  const context = {
    location: { directory: "/default" },
    data: { session: { get: () => ({ location: { directory: "/project" } }) } },
    storage: { store: (_key: string, options: any) => [options.initial, async (update: any) => update(options.initial)] },
    keymap: { layer: (factory: any) => { commands.push(...factory().commands) } },
    ui: { slot: (slot: any) => { slots.push(slot) }, toast: { show() {} } },
    theme: { text: { base: "#ffffff", muted: "#aaaaaa", accent: "#00aaff", feedback: {
      success: { base: "#00ff00" }, warning: { base: "#ffff00" }, error: { base: "#ff0000" },
    } }, background: { base: "#000000", raised: "#111111" }, border: { base: "#555555" } },
  } as unknown as Plugin.Context
  return { slots, commands, context }
}

test("commands mount in the official home footer without relying on the app slot", async () => {
  for (const [plugin, slash] of [[angel, "angel-mcps"], [openInApp, "open-in-app"]] as const) {
    const h = host()
    const cleanup = await plugin.setup(h.context)
    const slot = h.slots.find(slot => slot.append === "home.footer.status")
    expect(slot).toBeDefined()
    const rendered = await testRender(() => slot.render({}), { width: 80, height: 20 })
    try {
      await rendered.renderOnce()
      expect(h.commands.some(command => command.slash?.name === slash)).toBe(true)
    } finally { rendered.renderer.destroy(); await cleanup?.() }
  }
})

test("patched hosts replace the central logo without duplicating branding in the footer", async () => {
  const h = host()
  Object.assign(h.context, { app: { version: "2.0.18", channel: "latest", angelHomeLogo: true } })
  await angel.setup(h.context)
  expect(h.slots.filter(slot => slot.replace === "home.logo")).toHaveLength(1)
  expect(h.slots.some(slot => slot.before === "home.footer")).toBe(false)
})

test("official hosts retain the supported footer layout", async () => {
  const h = host()
  Object.assign(h.context, { app: { version: "2.0.18", channel: "latest" } })
  await angel.setup(h.context)
  expect(h.slots.some(slot => slot.replace === "home.logo")).toBe(false)
  expect(h.slots.filter(slot => slot.before === "home.footer")).toHaveLength(1)
})
