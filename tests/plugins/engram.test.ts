import { expect, test } from "bun:test"
import plugin from "../../assets/integrations/engram/engram"
import type { Plugin } from "@opencode/plugin"

test("v2 memory hooks use legacy Engram HTTP and suppress child-session prompts", async () => {
  const requests: Array<{ path: string; body: any }> = []
  const oldFetch = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any) => {
    requests.push({ path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(init.body) : undefined })
    return Response.json({ ok: true, context: "test context" })
  }) as typeof fetch
  const hooks: Record<string, (event: any) => Promise<void>> = {}
  const events = ["child", "root"].map(id => ({ type: "session.inbox.enqueued", location: { directory: "/workspace/test" }, data: {
    sessionID: id, inboxID: `inbox-${id}`, item: { type: "user", payload: { text: "Test request <private>sample secret" + "x".repeat(2100) + "</private>" } },
  } }))
  let consumed!: () => void
  const done = new Promise<void>(resolve => { consumed = resolve })
  const context = {
    location: { directory: "/workspace/test" },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, parentID: sessionID === "child" ? "root" : undefined, location: { directory: sessionID === "foreign" ? "/another-project" : "/workspace/test" } }),
      hook: async (name: string, callback: any) => { hooks[name] = callback },
    },
    tool: { hook: async (name: string, callback: any) => { hooks[name] = callback } },
    event: { subscribe: async function* () { for (const event of events) yield event; consumed() } },
  } as unknown as Plugin.Context
  try {
    const cleanup = await plugin.setup(context)
    await done
    const prompts = requests.filter(item => item.path === "/prompts")
    expect(prompts).toHaveLength(1)
    expect(prompts[0].body.session_id).toBe("root")
    expect(prompts[0].body.content).not.toContain("sample secret")
    expect(requests.filter(item => item.path === "/sessions")).toHaveLength(1)
    const event = { sessionID: "root", system: [{ type: "text", text: "Base", cache: "keep" }] }
    await hooks.context(event)
    expect(event.system[0].cache).toBe("keep")
    expect(event.system[0].text.length).toBeGreaterThan(4)
    const compaction = { sessionID: "root", system: [] as any[] }
    await hooks.compaction(compaction)
    expect(compaction.system.some(part => part.text === "test context")).toBe(true)
    const foreign = { sessionID: "foreign", system: [] as any[] }
    const before = requests.length
    await hooks.compaction(foreign)
    expect(foreign.system).toEqual([])
    expect(requests.length).toBe(before)
    await cleanup?.()
  } finally { globalThis.fetch = oldFetch }
})
