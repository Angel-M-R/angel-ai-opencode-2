/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { createAppCatalog, launchApp, type App, type AppCatalog } from "./apps"

export function createOpenInAppPlugin(catalogFactory: () => AppCatalog = () => createAppCatalog({ timeoutMs: 1500 })) {
return Plugin.define({
  id: "opencode-open-in-app",
  setup(context) {
    const catalog = catalogFactory()
    const [saved, save] = context.storage.store<{ favourite?: string }>("favourite", { initial: {} })
    const [favourite, setFavourite] = createSignal<App>()
    let disposed = false
    void catalog.getDetectedApps().then(apps => {
      if (!disposed) setFavourite(apps.find(app => app.id === saved.favourite))
    }).catch(() => {})
    const project = () => {
      const route = context.ui.router.current()
      return (route.type === "session" ? context.data.session.get(route.sessionID)?.location : context.location)?.directory
        ?? context.data.location.default().directory
    }
    const launch = async (app: App) => {
      const result = await launchApp(app, project(), { timeoutMs: 1500 })
      if (!result.success) context.ui.toast.show({ variant: "error", message: `Could not open ${app.name}: ${result.failure}` })
    }
    const pick = async () => {
      const apps = await catalog.getDetectedApps()
      const chosen = await context.ui.dialog.select({
        title: "Open project in", options: apps.map(app => ({ title: app.name, value: app })),
      })
      if (!chosen || disposed) return
      await save(draft => { draft.favourite = chosen.id })
      setFavourite(chosen)
      await launch(chosen)
    }
    const activate = async () => {
      try {
        const app = favourite()
        if (app) await launch(app)
        else await pick()
      } catch (error) {
        context.ui.toast.show({ variant: "error", message: error instanceof Error ? error.message : "Could not open application" })
      }
    }
    const Commands = () => {
      context.keymap.layer(() => ({ mode: "global", commands: [{
        id: "opencode-open-in-app.open-project-root-with-favourite",
        title: "Open project in favourite app", bind: "alt+o", palette: true,
        slash: { name: "open-in-app" }, run: activate,
      }, {
        id: "opencode-open-in-app.choose", title: "Choose application for project",
        palette: true, slash: { name: "open-in-app-choose" },
        run: () => pick().catch(error => context.ui.toast.show({ variant: "error", message: String(error) })),
      }] }))
      return null
    }
    const releaseFooter = context.ui.slot({ append: "home.footer.status", render: Commands })
    const releaseSidebar = context.ui.slot({ prepend: "sidebar.content", render: () => (
      <box flexDirection="row" height={1}>
        <Commands />
        <text fg={context.theme.text.muted} onMouseUp={() => void activate()}>Open in {favourite()?.name ?? "app"} </text>
        <text fg={context.theme.text.accent} onMouseUp={() => void pick().catch(error => context.ui.toast.show({ variant: "error", message: String(error) }))}>↓</text>
      </box>
    ) })
    return () => { disposed = true; releaseFooter?.(); releaseSidebar?.() }
  },
})

}

export default createOpenInAppPlugin()
