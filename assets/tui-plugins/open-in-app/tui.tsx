import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import { createAppCatalog, launchApp, type App, type AppCatalog, type LaunchResult } from "./apps.js";
import { createActivationRegionHandlers } from "./interaction.js";
import { createApplicationPicker, type FavouriteAppStore } from "./picker.js";
import { FavouriteAppPreference } from "./favourite.js";
import { registerOpenFavouriteKeymap } from "./keymap.js";
import { resolveProjectRoot } from "./project.js";

export const DEFAULT_PROCESS_TIMEOUT_MS = 1_500;
export interface OpenInAppTuiDependencies {
  readonly catalog?: AppCatalog;
  readonly launch?: (app: App, projectRoot: string) => Promise<LaunchResult>;
  readonly favouriteStore?: FavouriteAppStore;
}

export function createOpenInAppTui(dependencies: OpenInAppTuiDependencies = {}) {
  return Plugin.define({
    id: "opencode-open-in-app",
    setup(context) {
      const catalog = dependencies.catalog ?? createAppCatalog({ timeoutMs: DEFAULT_PROCESS_TIMEOUT_MS });
      const [saved, save] = context.storage.store<{ favourite?: string }>("favourite", { initial: {} });
      const warn = (message: string) => context.ui.toast.show({ variant: "warning", message });
      const store = dependencies.favouriteStore ?? new FavouriteAppPreference({
        get: <Value,>(_key: string, fallback?: Value) => (saved.favourite ?? fallback) as Value,
        set: (_key, value) => { void save(draft => { draft.favourite = value as string }).catch(error => warn(String(error))); },
      });
      const [favourite, setFavourite] = createSignal<App>();
      let disposed = false;
      const project = () => {
        const route = context.ui.router.current();
        const location = route.type === "session" ? context.data.session.get(route.sessionID)?.location : context.location;
        return resolveProjectRoot({ state: { path: {
          directory: location?.directory,
          worktree: context.location?.directory ?? context.data.location.default().directory,
        } } });
      };
      const picker = createApplicationPicker({
        catalog, store, toast: warn,
        onFavouriteChanged: app => { if (!disposed) setFavourite(app); },
        launch: dependencies.launch ?? ((app, root) => launchApp(app, root, { timeoutMs: DEFAULT_PROCESS_TIMEOUT_MS })),
        dialog: { show(input) {
          void context.ui.dialog.select({ title: input.title, options: [...input.options] })
            .then(app => { if (app && !disposed) input.onSelect(app); }).catch(error => warn(String(error)));
        } },
      });
      void resolvePersistedFavourite(catalog, store).then(app => { if (!disposed) setFavourite(app); });
      const pick = () => { const root = project(); if (root && !disposed) void picker.open(root); };
      const activate = () => {
        const root = project(); if (!root || disposed) return;
        const app = favourite(); if (app) void picker.launch(app, root); else void picker.open(root);
      };
      const Commands = () => { registerOpenFavouriteKeymap(context, activate, pick); return null; };
      const releaseFooter = context.ui.slot({ append: "home.footer.status", render: Commands });
      const releaseSidebar = context.ui.slot({ prepend: "sidebar.content", render: () => <>
        <Commands />
        <OpenInAppControl favourite={favourite()} theme={context.theme} activateLabel={activate} activateChevron={pick} />
      </> });
      return () => { if (disposed) return; disposed = true; releaseSidebar(); releaseFooter(); };
    },
  });
}

function OpenInAppControl(props: {
  readonly favourite: App | undefined;
  readonly theme: Plugin.Context["theme"];
  readonly activateLabel: () => void;
  readonly activateChevron: () => void;
}) {
  const label = createActivationRegionHandlers(props.activateLabel);
  const chevron = createActivationRegionHandlers(props.activateChevron);

  return (
    <box height={1} flexDirection="row">
      <box
        height={1}
        focusable
        onMouseDown={label.onMouseDown}
        onMouseUp={label.onMouseUp}
        onKeyDown={label.onKeyDown}
      >
        <text
          height={1}
          wrapMode="none"
          truncate
          selectable={false}
          fg={props.theme.text.muted}
        >
          {`Open in${props.favourite ? ` ${props.favourite.name}` : ""} `}
        </text>
      </box>
      <box
        height={1}
        focusable
        onMouseDown={chevron.onMouseDown}
        onMouseUp={chevron.onMouseUp}
        onKeyDown={chevron.onKeyDown}
      >
        <text
          height={1}
          wrapMode="none"
          truncate
          selectable={false}
          fg={props.theme.text.muted}
        >
          ↓
        </text>
      </box>
    </box>
  );
}

async function resolvePersistedFavourite(
  catalog: AppCatalog,
  store: FavouriteAppStore,
): Promise<App | undefined> {
  let detectedApps: readonly App[];
  try {
    detectedApps = await catalog.getDetectedApps();
  } catch {
    return undefined;
  }

  try {
    return store.get(detectedApps);
  } catch {
    return undefined;
  }
}


export default createOpenInAppTui();
