import type { McpServer } from "@opencode/client"

export type McpFooterState =
  | { status: "loading" | "unavailable" | "empty" }
  | { status: "resolved"; servers: readonly McpServer[] }

// V2 returns pending and disabled entries itself; undefined means not loaded.
export function resolveMcpFooterState(
  servers: readonly McpServer[] | undefined,
  timedOut = false,
): McpFooterState {
  if (!servers) return { status: timedOut ? "unavailable" : "loading" }
  if (servers.length === 0) return { status: "empty" }
  return { status: "resolved", servers }
}
