import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { canonicalizeAgentConfig, getOrchestratorPolicy } from "../../assets/tui-plugins/sdd-engram/orchestrator"
import { writeGlobalConfigFile } from "../../assets/tui-plugins/sdd-engram/config-write"
import { applyProfileDataToConfig, detectActiveProfileFile } from "../../assets/tui-plugins/sdd-engram/profiles"
import { parseTaskDocument } from "../../assets/tui-plugins/openspec-tasks/task-parser"
import { createOpenSpecStatusGateway } from "../../assets/tui-plugins/openspec-tasks/openspec-status"
import { readContainedTaskFile } from "../../assets/tui-plugins/openspec-tasks/refresh-coordinator"
import { processCommand } from "../../assets/tui-plugins/openspec-tasks/openspec-process"
import { isValidChangeName } from "../../assets/tui-plugins/openspec-tasks/change-name"
import { selectOpenSpecCandidate } from "../../assets/tui-plugins/openspec-tasks/openspec-list"

test("canonicalization preserves agent fields and normalizes the chosen model", () => {
 const policy = getOrchestratorPolicy(["gentle-orchestrator"])
 const prompt = { model: " provider/model ", prompt: "{file:custom.md}", permission: { bash: "ask" }, options: { temperature: 0 } }
 const result = canonicalizeAgentConfig({ "gentle-orchestrator": prompt, "sdd-orchestrator": { model: "old/model" } }, policy)
 expect(result).toEqual({ "gentle-orchestrator": { ...prompt, model: "provider/model" } })
})

test("profile writes preserve dotfile symlinks and accept BOM input", () => {
 const root = mkdtempSync(join(tmpdir(), "angel-profile-"))
 try {
  const target = join(root, "managed.json"), link = join(root, "opencode.json")
  writeFileSync(target, '\uFEFF{"agent":{}}')
  symlinkSync(target, link)
  writeGlobalConfigFile(link, { agent: { worker: { model: "new/model" } } })
  expect(lstatSync(link).isSymbolicLink()).toBe(true)
  expect(JSON.parse(readFileSync(target, "utf8")).agent.worker.model).toBe("new/model")
  writeGlobalConfigFile(link, { agent: {} })
  expect(readdirSync(root).filter(name => name.startsWith("managed.json.bak-"))).toHaveLength(2)
 } finally { rmSync(root, { recursive: true, force: true }) }
})

test("profile detection checks fallback-only and mismatched fallback assignments", () => {
 const root = mkdtempSync(join(tmpdir(), "angel-fallback-")), old = process.env.OPENCODE_CONFIG_DIR
 process.env.OPENCODE_CONFIG_DIR = root
 try {
  mkdirSync(join(root, "profiles"))
  writeFileSync(join(root, "profiles", "fallback.json"), JSON.stringify({ models: {}, fallback: { "sdd-apply": "provider/fallback" } }))
  const api = { state: { config: { agent: { "sdd-apply": { model: "provider/main" }, "sdd-apply-fallback": { model: "provider/fallback" } } } } }
  expect(detectActiveProfileFile(["fallback.json"], api)).toBe("fallback.json")
  writeFileSync(join(root, "profiles", "primary.json"), JSON.stringify({ models: { "sdd-apply": "provider/main" } }))
  expect(detectActiveProfileFile(["primary.json", "fallback.json"], api)).toBe("fallback.json")
  api.state.config.agent["sdd-apply-fallback"].model = "provider/other"
  expect(detectActiveProfileFile(["fallback.json"], api)).toBeUndefined()
 } finally { if (old === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = old; rmSync(root, { recursive: true, force: true }) }
})

test("task discovery handles early changes and ignores hidden checkboxes", () => {
 expect(isValidChangeName("2fa-login")).toBe(true)
 expect(isValidChangeName("Plan_V2")).toBe(true)
 expect(isValidChangeName("../outside")).toBe(false)
 expect(selectOpenSpecCandidate({ changes: [{ name: "2fa-login", status: "no-tasks", lastModified: "2026-01-01T00:00:00Z" }] })).toEqual({ status: "selected", changeName: "2fa-login" })
 expect(parseTaskDocument("- [ ] document `<!--` and ``a`<!--``\n- [x] next").progress).toEqual({ total: 2, completed: 1 })
 expect(parseTaskDocument("<!--\n- [ ] hidden\n-->\n- [x] visible").progress).toEqual({ total: 1, completed: 1 })
})

test("status gateway rejects a task symlink outside the planning root", async () => {
 const root = mkdtempSync(join(tmpdir(), "angel-status-"))
 try {
  const planning = join(root, "planning"), changes = join(planning, "changes"), change = join(changes, "demo"), task = join(change, "tasks.md")
  mkdirSync(change, { recursive: true }); writeFileSync(join(root, "private.md"), "private"); symlinkSync(join(root, "private.md"), task)
  const status = { changeName: "demo", changeRoot: change, planningHome: { root: planning, changesDir: changes }, artifactPaths: { tasks: { resolvedOutputPath: task } } }
  const gateway = createOpenSpecStatusGateway(async () => ({ stdout: JSON.stringify(status), stderr: "" }))
  expect(await gateway.resolve("demo", root)).toEqual({ status: "temporary-failure", reason: "unsafe-path" })
 } finally { rmSync(root, { recursive: true, force: true }) }
})

test("Windows OpenSpec launcher invokes the npm shim without accepting shell syntax", () => {
 const request = { command: "openspec", args: ["status", "--change", "2fa-login", "--json"], cwd: ".", timeoutMs: 100, maxOutputBytes: 100 }
 expect(processCommand(request, "win32", () => "C:\\Trusted Tools\\openspec.cmd").args).toEqual(["/d", "/s", "/c", '""C:\\Trusted Tools\\openspec.cmd" status --change 2fa-login --json"'])
 expect(() => processCommand({ ...request, args: ["status", "x&calc"] }, "win32")).toThrow()
})

test("profile reasoning clearing reaches reconciled fallback agents", () => {
 const config = { agent: { "sdd-apply": { model: "provider/old", reasoningEffort: "high", options: { reasoningEffort: "high" } }, "sdd-apply-fallback": { model: "provider/fallback", reasoningEffort: "high", options: { reasoningEffort: "high" } } } }
 const updated = applyProfileDataToConfig(config, { models: { "sdd-apply": "provider/new" }, fallback: { "sdd-apply": "provider/fallback" } })
 expect(updated.agent["sdd-apply"].reasoningEffort).toBeUndefined()
 expect(updated.agent["sdd-apply-fallback"].reasoningEffort).toBeUndefined()
 expect(updated.agent["sdd-apply-fallback"].options.reasoningEffort).toBeUndefined()
})

 test("task reads revalidate paths that were missing during status resolution", async () => {
  const root = mkdtempSync(join(tmpdir(), "angel-task-read-"))
  try {
   const change = join(root, "change"), task = join(change, "tasks.md")
   mkdirSync(change); writeFileSync(join(root, "private.md"), "private")
   symlinkSync(join(root, "private.md"), task)
   await expect(readContainedTaskFile(task, change)).rejects.toThrow()
   rmSync(task); writeFileSync(task, "- [ ] safe")
   expect(await readContainedTaskFile(task, change)).toBe("- [ ] safe")
  } finally { rmSync(root, { recursive: true, force: true }) }
 })
