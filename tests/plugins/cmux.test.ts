import { expect, test } from "bun:test"
import { createServer } from "node:net"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Plugin } from "@opencode/plugin"

const until = async (check: () => boolean) => {
  const deadline = Date.now() + 2000
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  expect(check()).toBe(true)
}

test("cmux bridges native permission contracts, plan rules, labels and cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "angel-cmux-")), socket = join(root, "socket")
  const previous = { socket: process.env.CMUX_SOCKET_PATH, surface: process.env.CMUX_SURFACE_ID }
  process.env.CMUX_SOCKET_PATH = socket
  process.env.CMUX_SURFACE_ID = "test"
  const frames: any[] = [], permissionReplies: any[] = [], formReplies: any[] = [], updates: any[] = []
  const server = createServer(connection => {
    let buffer = ""
    connection.on("data", chunk => {
      buffer += chunk.toString()
      for (;;) {
        const offset = buffer.indexOf("\n"); if (offset < 0) break
        const frame = JSON.parse(buffer.slice(0, offset)); buffer = buffer.slice(offset + 1)
        frames.push(frame)
        if (frame.id === "opencode-permission") connection.write(JSON.stringify({ id: frame.id, result: { status: "resolved", decision: { kind: "permission", mode: "once" } } }) + "\n")
        if (frame.id === "opencode-plan") connection.write(JSON.stringify({ id: frame.id, result: { status: "resolved", decision: { kind: "exit_plan", mode: "manual" } } }) + "\n")
      }
    })
  })
  await new Promise<void>(resolve => server.listen(socket, resolve))
  let wake: (() => void) | undefined
  const queue: any[] = []
  const emit = (type: string, data: any) => { queue.push({ type, data, location: { directory: root } }); wake?.() }
  const context = {
    location: { directory: root },
    permission: { reply: async (input: Parameters<Plugin.Context["permission"]["reply"]>[0]) => { permissionReplies.push(input) } },
    session: {
      update: async (input: Parameters<Plugin.Context["session"]["update"]>[0]) => { updates.push(input) },
      form: { reply: async (input: any) => { formReplies.push(input) }, cancel: async () => {} },
    },
    event: { subscribe: async function* ({ signal }: { signal: AbortSignal }) {
      signal.addEventListener("abort", () => wake?.())
      while (!signal.aborted) {
        if (queue.length) yield queue.shift()
        else await new Promise<void>(resolve => { wake = resolve })
      }
    } },
  } as unknown as Plugin.Context
  let cleanup: any
  try {
    const file = "../../assets/integrations/cmux/cmux-feed.js"
    const { default: plugin } = await import(file)
    cleanup = await plugin.setup(context)
    emit("permission.asked", { id: "permission", sessionID: "session", action: "bash", resources: ["git status"], save: ["git *"] })
    await until(() => permissionReplies.length === 1)
    expect(permissionReplies[0]).toEqual({ sessionID: "session", requestID: "permission", decision: "once", message: undefined })
    const permission = frames.find(frame => frame.id === "opencode-permission").params.event
    expect(permission.tool_name).toBe("bash")
    expect(permission.tool_input.patterns).toEqual(["git status"])
    expect(permission.tool_input.always).toEqual(["git *"])
    emit("form.created", { form: { id: "plan", sessionID: "session", title: "Plan", fields: [{ key: "choice", type: "string", title: "Build Agent", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }] } })
    await until(() => formReplies.length === 1)
    expect(updates[0].sessionID).toBe("session")
    expect(updates[0].permissions).toEqual([{ action: "edit", resource: "*", effect: "ask" }, { action: "bash", resource: "*", effect: "ask" }, { action: "external_directory", resource: "*", effect: "ask" }])
    expect(formReplies[0].answer).toEqual({ choice: "yes" })
    emit("form.created", { form: { id: "cancel", sessionID: "session", title: "Pick", fields: [{ key: "choice", type: "string", title: "Pick", options: [{ value: "raw", label: "Readable label" }] }] } })
    await until(() => frames.some(frame => frame.id === "opencode-cancel"))
    const question = frames.find(frame => frame.id === "opencode-cancel").params.event
    expect(question.tool_input.questions[0].options[0]).toMatchObject({ id: "raw", label: "Readable label" })
    emit("form.cancelled", { id: "cancel", sessionID: "session" })
    emit("session.status", { sessionID: "session", status: { type: "idle" } })
    await until(() => frames.some(frame => frame.params.event.hook_event_name === "Stop"))
    expect(formReplies).toHaveLength(1)
  } finally {
    cleanup?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (previous.socket === undefined) delete process.env.CMUX_SOCKET_PATH; else process.env.CMUX_SOCKET_PATH = previous.socket
    if (previous.surface === undefined) delete process.env.CMUX_SURFACE_ID; else process.env.CMUX_SURFACE_ID = previous.surface
    rmSync(root, { recursive: true, force: true })
  }
})
