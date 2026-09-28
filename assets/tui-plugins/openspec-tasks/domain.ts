export interface ActiveChange {
  readonly name: string;
  readonly rootPath: string;
  readonly taskFilePath: string;
  readonly changesDirectoryPath: string;
}

export interface Task {
  readonly label: string;
  readonly completed: boolean;
}

export interface Progress {
  readonly completed: number;
  readonly total: number;
}

export interface TaskSection {
  readonly id: string;
  readonly label: string;
  readonly tasks: readonly Task[];
  readonly progress: Progress;
}

export interface TaskDocument {
  readonly sections: readonly TaskSection[];
  readonly progress: Progress;
}

export interface ActiveChangeSnapshot extends TaskDocument {
  readonly change: ActiveChange;
}

export type SnapshotHealth =
  | { readonly status: "fresh" }
  | { readonly status: "stale"; readonly reason: string };

export type PresentationState =
  | { readonly status: "idle" }
  | {
      readonly status: "ready";
      readonly snapshot: ActiveChangeSnapshot;
      readonly health: Extract<SnapshotHealth, { status: "fresh" }>;
    }
  | {
      readonly status: "stale";
      readonly snapshot: ActiveChangeSnapshot;
      readonly health: Extract<SnapshotHealth, { status: "stale" }>;
    };
