import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { labelFor, resolveTokensTotal } from "../../assets/tui-plugins/subagent-statusline/format"
import { takeColumns, textColumns, truncateToColumns } from "../../assets/tui-plugins/subagent-statusline/text-width"
import monitor from "../../assets/tui-plugins/subagent-statusline/tui"
import { createOpenInAppPlugin } from "../../assets/tui-plugins/open-in-app/tui"
const open = createOpenInAppPlugin(() => ({ getDetectedApps: async () => [] }))
import angel from "../../assets/tui-plugins/angel-logo/tui"
import { defaultProcessExecutor } from "../../assets/tui-plugins/open-in-app/process"
import { launchApp } from "../../assets/tui-plugins/open-in-app/apps"
import type { Plugin } from "@opencode/plugin/tui"

test("monitor preserves graphemes, explicit totals and delimited agent tags", () => {
  expect(textColumns("©︎")).toBe(1)
  expect(textColumns("1️⃣")).toBe(2)
  expect(takeColumns("1️⃣x", 1)).toBe("")
  expect(textColumns("👨‍👩‍👧‍👦")).toBe(2)
  expect(takeColumns("👨‍👩‍👧‍👦abc", 2)).toBe("👨‍👩‍👧‍👦")
  expect(truncateToColumns("👨‍👩‍👧‍👦abc", 3)).toBe("👨‍👩‍👧‍👦…")
  expect(takeColumns("किx", 1)).toBe("कि")
  expect(resolveTokensTotal({ id: "s", tokens: { total: 42 } })).toBe(42)
  expect(labelFor({ id: "s", title: "Explore API", agent: "explore" })).toBe("Explore API (explore)")
  expect(labelFor({ id: "s", title: "API (explore)", agent: "explore" })).toBe("API (explore)")
})

test("Open in App reports output overflow and genuine Explorer exits", async () => {
  const result = await defaultProcessExecutor({ command: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(2*1024*1024))"], cwd: process.cwd(), timeoutMs: 2000 })
  expect(result.failure?.kind).toBe("output")
  const app = { id: "explorer", name: "Explorer", command: "explorer", fixedArgs: [] } as const
  for (const code of [1, 2]) {
    const result = await launchApp(app, process.cwd(), { timeoutMs: 10, executor: async () => ({ stdout: "", stderr: "", failure: { kind: "exit", exitCode: code } }) })
    expect(result.success).toBe(code === 1)
  }
})

test("UI unload releases every registered slot and picker is keyboard accessible", async () => {
  for (const plugin of [open, angel]) {
    const slots: any[] = [], released: any[] = [], commands: any[] = []
    const context = {
      app: { angelHomeLogo: true },
      storage: { store: (_: any, options: any) => [options.initial, async () => {}] },
      ui: { slot: (slot: any) => { slots.push(slot); return () => released.push(slot) } },
      keymap: { layer: (factory: any) => { commands.push(...factory().commands) } },
    } as unknown as Plugin.Context
    const cleanup = await plugin.setup(context)
    const commandSlot = slots.find(slot => slot.append === "home.footer.status")
    const rendered = await testRender(() => commandSlot.render({}), { width: 80, height: 20 })
    await rendered.renderOnce()
    if (plugin === open) expect(commands.some(command => command.slash?.name === "open-in-app-choose")).toBe(true)
    rendered.renderer.destroy()
    await cleanup?.()
    expect(released).toEqual(slots)
  }
})

test("monitor schedules trailing updates and labels the home aggregate by workspace", async () => {
  const slots: any[] = []
  let listen!: () => void
  let sessions: any[] = [{ id: "worker", parentID: "root", location: { directory: "/one" } }, { id: "other", parentID: "else", location: { directory: "/two" } }]
  const context = {
    location: { directory: "/one" },
    storage: { store: (_: any, options: any) => [options.initial, async () => {}] },
    data: { listen: (callback: any) => { listen = callback; return () => {} }, session: { list: () => sessions } },
    ui: { slot: (slot: any) => { slots.push(slot); return () => {} } },
    theme: { text: { feedback: { warning: { base: RGBA.fromHex("#abcdef") }, error: { base: RGBA.fromHex("#ff0000") } } } },
  } as unknown as Plugin.Context
  const cleanup = await monitor.setup(context)
  const rendered = await testRender(() => slots.find(slot => slot.append === "home.footer.status").render({}), { width: 80, height: 10 })
  try {
    await rendered.renderOnce()
    expect(rendered.captureCharFrame()).toContain("All workspace workers: 1 run")
    sessions = sessions.map(session => ({ ...session, outcome: "failed" }))
    listen()
    await new Promise(resolve => setTimeout(resolve, 250))
    await rendered.renderOnce()
    expect(rendered.captureCharFrame()).toContain("All workspace workers: 0 run · 0 done · 1 err")
  } finally { rendered.renderer.destroy(); await cleanup?.() }
})
