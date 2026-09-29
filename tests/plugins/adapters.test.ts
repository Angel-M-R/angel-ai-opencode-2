import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeGlobalConfigFile } from "../../assets/tui-plugins/sdd-engram/config-write"
import { parseTaskDocument } from "../../assets/tui-plugins/openspec-tasks/task-parser"
import { deriveStatus, maxCandidates, type V2Session } from "../../assets/tui-plugins/subagent-statusline/reconcile"

test("SDD profile persistence backs up exact config and rejects invalid/native configs", () => {
  const dir = mkdtempSync(join(tmpdir(), "angel-sdd-"))
  const file = join(dir, "opencode.json")
  const original = JSON.stringify({ agent: { worker: { model: "provider/old", prompt: "{file:worker.md}" } }, mcp: { custom: { enabled: false } } })
  try {
    writeFileSync(file, original)
    const next = JSON.parse(original)
    next.agent.worker.model = "provider/new"
    writeGlobalConfigFile(file, next)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(next)
    expect(readFileSync(join(dir, readdirSync(dir).find(name => name.includes(".bak-"))!), "utf8")).toBe(original)
    for (const invalid of ["{broken", JSON.stringify({ agents: [] })]) {
      writeFileSync(file, invalid)
      expect(() => writeGlobalConfigFile(file, next)).toThrow()
      expect(readFileSync(file, "utf8")).toBe(invalid)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("OpenSpec progress ignores examples and counts completed heading tasks", () => {
  const doc = parseTaskDocument("# Build\n- [x] Installed\n- [ ] Pending\n```md\n- [ ] Example\n```\n### [X] Verified\n")
  expect(doc.progress).toEqual({ completed: 2, total: 3 })
  expect(doc.sections[0].tasks.map(task => task.completed)).toEqual([true, false, true])
})

test("native subagent outcomes distinguish running, failed, interrupted and finished", () => {
  const sessions: V2Session[] = [
    { id: "running", time: { updated: Date.now() } },
    { id: "failed", outcome: "failed" },
    { id: "interrupted", outcome: "interrupted" },
    { id: "done", outcome: "succeeded" },
  ]
  expect(sessions.map(session => deriveStatus(session))).toEqual(["running", "error", "error", "done"])
  expect(maxCandidates(sessions, false, 0).map(session => session.id)).toEqual(["running", "failed", "interrupted"])
})
