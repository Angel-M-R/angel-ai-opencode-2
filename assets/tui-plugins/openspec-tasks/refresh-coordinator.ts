import { watch as watchFileSystem, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ActiveChange,
  ActiveChangeSnapshot,
  PresentationState,
  TaskDocument,
} from "./domain.js";
import type { OpenSpecListGateway } from "./openspec-list.js";
import type { OpenSpecStatusGateway } from "./openspec-status.js";
import { parseTaskDocument } from "./task-parser.js";

export const DEFAULT_REFRESH_DEBOUNCE_MS = 75;
export const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;

export interface RefreshWatcher {
  close(): void;
}

export interface WatchHandlers {
  readonly change: (filename?: string) => void;
  readonly error: (error: unknown) => void;
}

export type WatchFactory = (
  targetPath: string,
  handlers: WatchHandlers,
) => RefreshWatcher;

export interface RefreshCoordinatorOptions {
  readonly projectDirectory: string;
  readonly listGateway: OpenSpecListGateway;
  readonly statusGateway: OpenSpecStatusGateway;
  readonly readTaskFile?: (taskFilePath: string) => Promise<string>;
  readonly parseTasks?: (markdown: string) => TaskDocument;
  readonly watch?: WatchFactory;
  readonly debounceMs?: number;
  readonly reconcileIntervalMs?: number;
}

export interface RefreshCoordinator {
  start(): Promise<void>;
  reconcile(): Promise<void>;
  getState(): PresentationState;
  subscribe(listener: (state: PresentationState) => void): () => void;
  dispose(): void;
}

interface WatchSet {
  readonly change: ActiveChange;
  readonly watchers: readonly RefreshWatcher[];
}

export function createRefreshCoordinator(
  options: RefreshCoordinatorOptions,
): RefreshCoordinator {
  const readTasks = options.readTaskFile ?? readUtf8File;
  const parseTasks = options.parseTasks ?? parseTaskDocument;
  const createWatcher = options.watch ?? createNodeWatcher;
  const debounceMs = options.debounceMs ?? DEFAULT_REFRESH_DEBOUNCE_MS;
  const reconcileIntervalMs =
    options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
  const listeners = new Set<(state: PresentationState) => void>();

  let state: PresentationState = { status: "idle" };
  let watchSet: WatchSet | undefined;
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  let reconcileHandle: ReturnType<typeof setInterval> | undefined;
  let refreshLoop: Promise<void> | undefined;
  let refreshRequested = false;
  let requestVersion = 0;
  let started = false;
  let disposed = false;

  const publish = (next: PresentationState): void => {
    if (disposed || samePresentationState(state, next)) return;
    state = next;
    for (const listener of listeners) listener(state);
  };

  const publishIdle = (): void => {
    replaceWatchSet(undefined);
    publish({ status: "idle" });
  };

  const publishStale = (reason: string): void => {
    if (state.status === "idle") return;
    publish({
      status: "stale",
      snapshot: state.snapshot,
      health: { status: "stale", reason },
    });
  };

  const scheduleDebouncedRefresh = (): void => {
    if (disposed) return;
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      debounceHandle = undefined;
      void requestRefresh();
    }, debounceMs);
  };

  const handleWatchError = (watchSetAtRegistration: WatchSet): void => {
    if (disposed || watchSet !== watchSetAtRegistration) return;
    replaceWatchSet(undefined);
    publishStale("OpenSpec watch unavailable");
    scheduleDebouncedRefresh();
  };

  const buildWatchSet = (change: ActiveChange): WatchSet | undefined => {
    if (watchSet && sameActiveChange(watchSet.change, change)) return watchSet;

    const watchers: RefreshWatcher[] = [];
    let nextWatchSet: WatchSet;
    try {
      nextWatchSet = { change, watchers };
      watchers.push(
        createWatcher(change.changesDirectoryPath, {
          change: scheduleDebouncedRefresh,
          error: () => handleWatchError(nextWatchSet),
        }),
      );

      watchers.push(
        createWatcher(change.taskFilePath, {
          change: scheduleDebouncedRefresh,
          error: () => handleWatchError(nextWatchSet),
        }),
      );

      const taskFileName = path.basename(change.taskFilePath);
      watchers.push(
        createWatcher(path.dirname(change.taskFilePath), {
          change: (filename) => {
            if (filename === undefined || filename === taskFileName) {
              scheduleDebouncedRefresh();
            }
          },
          error: () => handleWatchError(nextWatchSet),
        }),
      );
      return nextWatchSet;
    } catch {
      closeWatchers(watchers);
      return undefined;
    }
  };

  const refreshOnce = async (version: number): Promise<void> => {
    let selection: Awaited<ReturnType<OpenSpecListGateway["resolve"]>>;
    try {
      selection = await options.listGateway.resolve(options.projectDirectory);
    } catch {
      if (!disposed && version === requestVersion) {
        publishStale("OpenSpec list unavailable");
      }
      return;
    }
    if (disposed || version !== requestVersion) return;
    if (selection.status === "no-candidate") {
      publishIdle();
      return;
    }
    if (selection.status === "temporary-failure") {
      publishStale("OpenSpec list unavailable");
      return;
    }

    let resolution: Awaited<ReturnType<OpenSpecStatusGateway["resolve"]>>;
    try {
      resolution = await options.statusGateway.resolve(
        selection.changeName,
        options.projectDirectory,
      );
    } catch {
      if (!disposed && version === requestVersion) {
        publishStale("OpenSpec validation unavailable");
      }
      return;
    }
    if (disposed || version !== requestVersion) return;
    if (resolution.status === "authoritative-failure") {
      publishIdle();
      return;
    }
    if (resolution.status === "temporary-failure") {
      publishStale("OpenSpec validation unavailable");
      return;
    }

    let markdown: string;
    try {
      markdown = await readTasks(resolution.change.taskFilePath);
    } catch {
      if (!disposed && version === requestVersion) {
        publishStale("Task file unreadable");
      }
      return;
    }
    if (disposed || version !== requestVersion) return;

    let document: TaskDocument;
    try {
      document = parseTasks(markdown);
    } catch {
      publishStale("Task file invalid");
      return;
    }
    if (disposed || version !== requestVersion) return;

    const nextWatchSet = buildWatchSet(resolution.change);
    const snapshot: ActiveChangeSnapshot = {
      change: resolution.change,
      sections: document.sections,
      progress: document.progress,
    };

    replaceWatchSet(nextWatchSet);
    if (nextWatchSet) {
      publish({
        status: "ready",
        snapshot,
        health: { status: "fresh" },
      });
    } else {
      publish({
        status: "stale",
        snapshot,
        health: { status: "stale", reason: "OpenSpec watch unavailable" },
      });
    }
  };

  const drainRefreshes = async (): Promise<void> => {
    try {
      while (refreshRequested && !disposed) {
        refreshRequested = false;
        await refreshOnce(requestVersion);
      }
    } finally {
      refreshLoop = undefined;
      if (refreshRequested && !disposed) void requestRefresh(false);
    }
  };

  const requestRefresh = (supersede = true): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (supersede) requestVersion += 1;
    refreshRequested = true;
    refreshLoop ??= drainRefreshes();
    return refreshLoop;
  };

  function replaceWatchSet(next: WatchSet | undefined): void {
    if (watchSet === next) return;
    const previous = watchSet;
    watchSet = next;
    if (previous) closeWatchers(previous.watchers);
  }

  return {
    async start() {
      if (disposed || started) return refreshLoop;
      started = true;
      reconcileHandle = setInterval(() => {
        void requestRefresh();
      }, reconcileIntervalMs);
      await requestRefresh();
    },

    reconcile() {
      return requestRefresh();
    },

    getState() {
      return state;
    },

    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      requestVersion += 1;
      refreshRequested = false;
      listeners.clear();

      replaceWatchSet(undefined);
      if (debounceHandle) clearTimeout(debounceHandle);
      if (reconcileHandle) clearInterval(reconcileHandle);
      debounceHandle = undefined;
      reconcileHandle = undefined;
    },
  };
}

async function readUtf8File(taskFilePath: string): Promise<string> {
  return readFile(taskFilePath, "utf8");
}

function createNodeWatcher(
  targetPath: string,
  handlers: WatchHandlers,
): RefreshWatcher {
  const watcher: FSWatcher = watchFileSystem(targetPath, (_, filename) => {
    handlers.change(filename?.toString());
  });
  watcher.on("error", handlers.error);
  return watcher;
}

function closeWatchers(watchers: readonly RefreshWatcher[]): void {
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // A failed close must not prevent the remaining lifecycle cleanup.
    }
  }
}

function samePresentationState(
  left: PresentationState,
  right: PresentationState,
): boolean {
  if (left.status !== right.status) return false;
  if (left.status === "idle" || right.status === "idle") return true;
  if (
    left.status === "stale" &&
    right.status === "stale" &&
    left.health.reason !== right.health.reason
  ) {
    return false;
  }
  return sameSnapshot(left.snapshot, right.snapshot);
}

function sameSnapshot(
  left: ActiveChangeSnapshot,
  right: ActiveChangeSnapshot,
): boolean {
  if (!sameActiveChange(left.change, right.change)) return false;
  if (
    left.progress.completed !== right.progress.completed ||
    left.progress.total !== right.progress.total ||
    left.sections.length !== right.sections.length
  ) {
    return false;
  }

  return left.sections.every((section, sectionIndex) => {
    const other = right.sections[sectionIndex];
    return (
      other !== undefined &&
      section.id === other.id &&
      section.label === other.label &&
      section.progress.completed === other.progress.completed &&
      section.progress.total === other.progress.total &&
      section.tasks.length === other.tasks.length &&
      section.tasks.every((task, taskIndex) => {
        const otherTask = other.tasks[taskIndex];
        return (
          otherTask !== undefined &&
          task.label === otherTask.label &&
          task.completed === otherTask.completed
        );
      })
    );
  });
}

function sameActiveChange(left: ActiveChange, right: ActiveChange): boolean {
  return (
    left.name === right.name &&
    left.rootPath === right.rootPath &&
    left.taskFilePath === right.taskFilePath &&
    left.changesDirectoryPath === right.changesDirectoryPath
  );
}
