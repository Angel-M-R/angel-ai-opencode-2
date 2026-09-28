import type { Plugin } from "@opencode/plugin/tui"
export interface PreferenceStore {
  get<T = unknown>(key: string, fallback?: T): T
  set(key: string, value: unknown): void
}
export function createPreferenceStore(context: Plugin.Context): PreferenceStore {
  const [state, update] = context.storage.store<{ values: Record<string, unknown> }>("accordion", { initial: { values: {} } })
  return {
    get: <T>(key: string, fallback?: T): T => (state.values[key] ?? fallback) as T,
    set: (key, value) => { void update(draft => { draft.values[key] = value }).catch(() => {
      context.ui.toast.show({ variant: "warning", message: "Could not save OpenSpec preferences" })
    }) },
  }
}
