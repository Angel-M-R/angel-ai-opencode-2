import type { App, AppCatalog, LaunchResult } from "./apps.js";
import type { FavouriteAppStore } from "./favourite.js";

export type { FavouriteAppStore } from "./favourite.js";

export interface ApplicationPickerOption {
  readonly title: string;
  readonly value: App;
}

export interface ApplicationPickerDialogSurface {
  show(input: {
    readonly title: string;
    readonly options: readonly ApplicationPickerOption[];
    readonly onSelect: (app: App) => void;
  }): void;
}

export interface ApplicationPicker {
  launch(app: App, projectRoot: string): Promise<void>;
  open(projectRoot: string): Promise<void>;
}

export interface ApplicationPickerDependencies {
  readonly catalog: AppCatalog;
  readonly store: FavouriteAppStore;
  readonly dialog: ApplicationPickerDialogSurface;
  readonly toast: (message: string) => void;
  readonly launch: (app: App, projectRoot: string) => Promise<LaunchResult>;
  readonly onFavouriteChanged: (app: App) => void;
}

export function createApplicationPicker({
  catalog,
  store,
  dialog,
  toast,
  launch,
  onFavouriteChanged,
}: ApplicationPickerDependencies): ApplicationPicker {
  return {
    async launch(app, projectRoot) {
      await launchAndReport(app, projectRoot, launch, toast);
    },

    async open(projectRoot) {
      const detectedApps = await getDetectedApps(catalog);
      if (detectedApps.length === 0) {
        showToast(toast, "No supported applications were detected.");
        return;
      }

      try {
        dialog.show({
          title: "Open project in",
          options: detectedApps.map((app) => ({
            title: app.name,
            value: app,
          })),
          onSelect(app) {
            let persisted = false;
            try {
              store.set(app.id);
              persisted = true;
            } catch {
              // Host persistence failures must not escape through the dialog.
            }
            if (persisted) {
              try {
                onFavouriteChanged(app);
              } catch {
                // A broken display callback must not prevent launching.
              }
            }
            void launchAndReport(app, projectRoot, launch, toast);
          },
        });
      } catch {
        // Host dialog failures must not escape through the activation handler.
      }
    },
  };
}

async function getDetectedApps(catalog: AppCatalog): Promise<readonly App[]> {
  try {
    return await catalog.getDetectedApps();
  } catch {
    return [];
  }
}

async function launchAndReport(
  app: App,
  projectRoot: string,
  launch: ApplicationPickerDependencies["launch"],
  toast: ApplicationPickerDependencies["toast"],
): Promise<void> {
  let result: LaunchResult;
  try {
    result = await launch(app, projectRoot);
  } catch {
    result = { success: false, failure: "spawn" };
  }

  if (!result.success) {
    showToast(toast, `Failed to launch ${app.name}: ${result.failure}.`);
  }
}

function showToast(
  toast: ApplicationPickerDependencies["toast"],
  message: string,
): void {
  try {
    toast(message);
  } catch {
    // A broken host notification surface must not crash the host.
  }
}
