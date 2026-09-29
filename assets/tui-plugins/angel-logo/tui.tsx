/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup, Show, For } from "solid-js"
import { resolveMcpFooterState } from "./mcp-footer-state"

// Added by the pinned Angel OpenCode patch. Stock hosts use the footer fallback.
declare module "@opencode/plugin/tui/context" {
  interface SlotMap { readonly "home.logo": Readonly<Record<string, never>> }
  interface App { readonly angelHomeLogo?: true }
}

const brandColor = "#4aa8ff"
const angelArt = [
  "    _                     _       _     _",
  "    / \\   _ __   __ _  ___| |     / \\   | |",
  "   / _ \\ | '_ \\ / _` |/ _ \\ |    / _ \\  | |",
  "  / ___ \\| | | | (_| |  __/ |   / ___ \\ | |",
  "  /_/   \\_\\_| |_|\\__, |\\___|_|  /_/   \\_\\|_| ",
  "                  |___/                         ",
]

const compactArt = [
  "   _   _     _ ",
  "  / \\ / \\   | |",
  "  / _ \\ _ \\  | | ",
  " / ___ \\__ \\ | | ",
  "/_/   \\_\\ \\_\\|_|",
]

const styles = {
  connected: { icon: "●", label: "connected", tone: "success" },
  pending: { icon: "◌", label: "connecting", tone: "warning" },
  disabled: { icon: "○", label: "disabled", tone: "muted" },
  failed: { icon: "✕", label: "error", tone: "error" },
  needs_auth: { icon: "◆", label: "authentication required", tone: "warning" },
} as const

export function AngelHome(props: { context: Plugin.Context; classic?: boolean }) {
  const dimensions = useTerminalDimensions()
  const [timedOut, setTimedOut] = createSignal(false)
  void props.context.data.location.mcp.server.sync(props.context.location).catch(() => setTimedOut(true))
  const timer = setTimeout(() => setTimedOut(true), 10_000)
  onCleanup(() => clearTimeout(timer))
  const state = createMemo(() => resolveMcpFooterState(
    props.context.data.location.mcp.server.list(props.context.location), timedOut(),
  ))
  const entries = createMemo(() => {
    const value = state()
    return value.status === "resolved" ? value.servers : []
  })
  const expanded = () => dimensions().height >= entries().length + (props.classic ? 20 : 28) && dimensions().width >= 60
  const lines = () => dimensions().width >= 150 ? angelArt : compactArt
  const color = (tone: string) => tone === "muted"
    ? props.context.theme.text.muted
    : props.context.theme.text.feedback[tone as "success" | "warning" | "error"].base
  const nameWidth = () => Math.max(3, ...entries().map(item => item.name.length)) + 4
  const statusWidth = () => Math.max(3, ...entries().map(item => styles[item.status.status].label.length)) + 2

  return (
    <box alignItems="center" flexDirection="column" paddingTop={props.classic ? 0 : 1}>
      <Show when={expanded()} fallback={<text fg={brandColor}>Angel AI · /angel-mcps</text>}>
        <For each={lines()}>{line => <text fg={brandColor}>{line}</text>}</For>
      </Show>
      <Show when={expanded()}>
        <box marginTop={1}><text fg={props.context.theme.text.muted}>MCP</text></box>
        <Show when={state().status === "loading"}><text fg={props.context.theme.text.muted}>checking connections...</text></Show>
        <Show when={state().status === "unavailable"}><text fg={props.context.theme.text.feedback.error.base}>✕ status unavailable</text></Show>
        <Show when={state().status === "empty"}><text fg={props.context.theme.text.muted}>○ none configured</text></Show>
        <For each={entries()}>{item => {
          const style = () => styles[item.status.status]
          return <box flexDirection="row">
            <text width={nameWidth()} fg={color(style().tone)}>{style().icon} {item.name}</text>
            <text width={statusWidth()} fg={color(style().tone)}>· {style().label}</text>
          </box>
        }}</For>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "angel-logo",
  setup(context) {
    const releases: Array<(() => void) | undefined> = []
    if (context.app?.angelHomeLogo) {
      releases.push(context.ui.slot({ replace: "home.logo", render: () => <AngelHome context={context} classic /> }))
    } else {
      releases.push(context.ui.slot({ before: "home.footer", render: () => <AngelHome context={context} /> }))
    }
    const Commands = () => {
      context.keymap.layer(() => ({ mode: "global", commands: [{
        id: "angel.mcp.list", title: "Angel AI MCP connections", palette: true,
        slash: { name: "angel-mcps" },
        run: () => context.keymap.dispatch("mcp.list"),
      }] }))
      return null
    }
    releases.push(context.ui.slot({ append: "home.footer.status", render: Commands }))
    releases.push(context.ui.slot({ append: "sidebar.footer", render: Commands }))
    return () => releases.forEach(release => release?.())
  },
})
