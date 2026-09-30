import { expect, test } from "bun:test"
import { deriveStatus, maxCandidates, type V2Session } from "../../assets/tui-plugins/subagent-statusline/reconcile"

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
