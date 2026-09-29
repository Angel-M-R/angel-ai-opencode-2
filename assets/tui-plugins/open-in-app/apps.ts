import {
  defaultProcessExecutor,
  type ProcessExecutor,
  type ProcessFailureKind,
} from "./process.js";

export type AppId = "vscode" | "cursor" | "explorer";

export interface App {
  readonly id: AppId;
  readonly name: string;
  readonly command: string;
  readonly fixedArgs: readonly string[];
}

export interface AppCatalog {
  getDetectedApps(): Promise<readonly App[]>;
}

export interface AppCatalogDependencies {
  readonly executor?: ProcessExecutor;
  readonly platform?: NodeJS.Platform;
  readonly timeoutMs: number;
}

export interface LaunchDependencies {
  readonly executor?: ProcessExecutor;
  readonly timeoutMs: number;
}

export type LaunchResult =
  | { readonly success: true }
  | { readonly success: false; readonly failure: ProcessFailureKind };

interface AvailabilityProbe {
  readonly command: string;
  readonly args: readonly string[];
}

const EDITOR_APPS: readonly App[] = [
  { id: "vscode", name: "VS Code", command: "code", fixedArgs: ["--"] },
  { id: "cursor", name: "Cursor", command: "cursor", fixedArgs: ["--"] },
];

export function resolveExplorerCommand(
  platform: NodeJS.Platform,
): string | undefined {
  switch (platform) {
    case "darwin":
      return "open";
    case "linux":
      return "xdg-open";
    case "win32":
      return "explorer";
    default:
      return undefined;
  }
}

export function createAppCatalog({
  executor = defaultProcessExecutor,
  platform = process.platform,
  timeoutMs,
}: AppCatalogDependencies): AppCatalog {
  const apps = canonicalApps(platform);
  let detectedApps: Promise<readonly App[]> | undefined;

  return {
    getDetectedApps() {
      detectedApps ??= detectApps(apps, platform, executor, timeoutMs);
      return detectedApps;
    },
  };
}

export async function launchApp(
  app: App,
  directory: string,
  {
    executor = defaultProcessExecutor,
    timeoutMs,
  }: LaunchDependencies,
): Promise<LaunchResult> {
  try {
    const result = await executor({
      command: app.command,
      args: [...app.fixedArgs, directory],
      cwd: directory,
      timeoutMs,
    });

    if (!result.failure || isSuccessfulWindowsExplorerExit(app, result.failure)) {
      return { success: true };
    }

    return { success: false, failure: result.failure.kind };
  } catch {
    return { success: false, failure: "spawn" };
  }
}

function canonicalApps(platform: NodeJS.Platform): readonly App[] {
  const explorerCommand = resolveExplorerCommand(platform);
  return explorerCommand
    ? [
        ...EDITOR_APPS,
        {
          id: "explorer",
          name: "File Explorer",
          command: explorerCommand,
          fixedArgs:
            platform === "darwin" ? ["-a", "Finder", "--"] : [],
        },
      ]
    : EDITOR_APPS;
}

async function detectApps(
  apps: readonly App[],
  platform: NodeJS.Platform,
  executor: ProcessExecutor,
  timeoutMs: number,
): Promise<readonly App[]> {
  const detected = await Promise.all(
    apps.map(async (app) => {
      try {
        const probe = availabilityProbe(app, platform);
        if (!probe) return undefined;

        const result = await executor({
          command: probe.command,
          args: probe.args,
          cwd: process.cwd(),
          timeoutMs,
        });
        return result.failure ? undefined : app;
      } catch {
        return undefined;
      }
    }),
  );

  return detected.filter((app): app is App => app !== undefined);
}

function availabilityProbe(
  app: App,
  platform: NodeJS.Platform,
): AvailabilityProbe | undefined {
  if (app.id !== "explorer") {
    return { command: app.command, args: ["--version"] };
  }

  switch (platform) {
    case "darwin":
    case "linux":
      return { command: "which", args: [app.command] };
    case "win32":
      return { command: "where.exe", args: [app.command] };
    default:
      return undefined;
  }
}

function isSuccessfulWindowsExplorerExit(
  app: App,
  failure: NonNullable<
    Awaited<ReturnType<ProcessExecutor>>["failure"]
  >,
): boolean {
  return (
    app.id === "explorer" &&
    app.command === "explorer" &&
    failure.kind === "exit" && failure.exitCode === 1
  );
}
