import {
  type BoxRenderable,
  type KeyEvent,
  type MouseEvent,
  TextBuffer,
  TextBufferView,
  type TextRenderable,
  type WidthMethod,
} from "@opentui/core";
import { Portal, useRenderer } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createPreferenceStore, type PreferenceStore } from "./preferences";
type TuiThemeCurrent = { text: string; textMuted: string; primary: string; success: string; warning: string; error: string; background: string; backgroundPanel: string; backgroundMenu: string; border: string };
type SidebarApi = { kv: PreferenceStore };
import { For, Show, batch, createRoot, createSignal, onCleanup, onMount } from "solid-js";

import {
  createAccordionPreferenceAdapter,
  type AccordionPreferenceAdapter,
} from "./accordion-preferences.js";
import type { PresentationState } from "./domain.js";
import {
  createOpenSpecListGateway,
  type OpenSpecListGateway,
} from "./openspec-list.js";
import {
  createOpenSpecStatusGateway,
  type OpenSpecStatusGateway,
} from "./openspec-status.js";
import {
  createRefreshCoordinator,
  type RefreshCoordinatorOptions,
  type WatchFactory,
} from "./refresh-coordinator.js";

export const TUI_PLUGIN_ID = "openspec-task-progress";
export const SIDEBAR_SLOT_ORDER = 350;

export interface OpenSpecTaskTuiDependencies {
  readonly listGateway?: OpenSpecListGateway;
  readonly statusGateway?: OpenSpecStatusGateway;
  readonly readTaskFile?: RefreshCoordinatorOptions["readTaskFile"];
  readonly watch?: WatchFactory;
  readonly debounceMs?: number;
  readonly reconcileIntervalMs?: number;
}

export interface ProjectContext {
  readonly directory: string;
  readonly identity: string;
}

interface SidebarProps {
  readonly api: SidebarApi;
  readonly project: ProjectContext;
  readonly theme: TuiThemeCurrent;
  readonly dependencies: Required<
    Pick<OpenSpecTaskTuiDependencies, "listGateway" | "statusGateway">
  > &
    Omit<OpenSpecTaskTuiDependencies, "listGateway" | "statusGateway">;
  readonly registerCleanup: (cleanup: () => void) => () => void;
}

interface SectionProps {
  readonly section: SidebarSectionView;
  readonly sectionIndex: number;
  readonly collapsed: boolean;
  readonly theme: TuiThemeCurrent;
  readonly onToggle: () => void;
  readonly onTooltipPointerMove: (
    description: string,
    rowLeft: number,
    rowTop: number,
    rowWidth: number,
    textWidth: number,
  ) => void;
  readonly onTooltipPointerOut: () => void;
}

interface TaskRowProps {
  readonly task: SidebarTaskRowView;
  readonly theme: TuiThemeCurrent;
  readonly onPointerMove: SectionProps["onTooltipPointerMove"];
  readonly onPointerOut: () => void;
}

export interface SidebarTaskRowView {
  readonly text: string;
  readonly description: string;
  readonly completed: boolean;
}

export interface TaskTooltipLayout {
  readonly description: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SidebarSectionView {
  readonly id: string;
  readonly title: string;
  readonly header: string;
  readonly collapsed: boolean;
  readonly tasks: readonly SidebarTaskRowView[];
}

export type SidebarView =
  | { readonly status: "idle"; readonly emptyText: string }
  | {
      readonly status: "ready" | "stale";
      readonly title: string;
      readonly staleWarning?: string;
      readonly sections: readonly SidebarSectionView[];
    };

export interface SidebarRuntime {
  start(): Promise<void>;
  getView(): SidebarView;
  subscribe(listener: (view: SidebarView) => void): () => void;
  toggleSection(sectionID: string): void;
  dispose(): void;
}

export function activateSectionFromKey(
  event: KeyEvent,
  activate: () => void,
): boolean {
  if (event.name !== "return" && event.name !== "space") return false;
  event.preventDefault();
  event.stopPropagation();
  activate();
  return true;
}

export function activateSectionFromMouse(
  event: MouseEvent,
  activate: () => void,
): boolean {
  if (event.button !== 0) return false;
  event.preventDefault();
  event.stopPropagation();
  event.target?.focus();
  activate();
  return true;
}

export function resolveTaskTooltip(input: {
  readonly description: string;
  readonly descriptionHeight: number;
  readonly textWidth: number;
  readonly rowLeft: number;
  readonly rowTop: number;
  readonly rowWidth: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): TaskTooltipLayout | undefined {
  if (
    input.rowWidth < 1 ||
    input.textWidth <= input.rowWidth ||
    input.viewportWidth < 1 ||
    input.viewportHeight < 1
  ) {
    return undefined;
  }

  const globalLeft = Math.min(
    Math.max(0, input.rowLeft),
    input.viewportWidth - 1,
  );
  const width = Math.min(input.rowWidth, input.viewportWidth - globalLeft);
  const height = Math.min(
    input.viewportHeight,
    Math.max(1, input.descriptionHeight),
  );
  const preferredTop = input.rowTop + 1;
  const globalTop =
    preferredTop + height <= input.viewportHeight
      ? preferredTop
      : Math.max(0, input.rowTop - height);

  return {
    description: input.description,
    left: globalLeft,
    top: globalTop,
    width,
    height,
  };
}

export function measureTaskTooltipHeight(
  description: string,
  width: number,
  widthMethod: WidthMethod,
): number {
  if (width < 1) return 1;

  const buffer = TextBuffer.create(widthMethod);
  const view = TextBufferView.create(buffer);
  try {
    buffer.setText(description);
    view.setWrapMode("word");
    view.setWrapWidth(width);
    return Math.max(
      1,
      view.measureForDimensions(
        width,
        Math.max(1, description.length),
      )?.lineCount ?? 1,
    );
  } finally {
    view.destroy();
    buffer.destroy();
  }
}

export function createOpenSpecTaskTui(
  dependencies: OpenSpecTaskTuiDependencies = {},
): Plugin.Definition {
  return Plugin.define({
    id: TUI_PLUGIN_ID,
    setup(context) {
      const api = { kv: createPreferenceStore(context) };
      const resolvedDependencies = {
        ...dependencies,
        listGateway: dependencies.listGateway ?? createOpenSpecListGateway(),
        statusGateway: dependencies.statusGateway ?? createOpenSpecStatusGateway(),
      };
      return context.ui.slot({
        append: "sidebar.content",
        render: ({ sessionID }) => {
          const directory = () => context.data.session.get(sessionID)?.location.directory
            ?? context.location?.directory ?? context.data.location.default().directory;
          const theme = context.theme;
          return <Show when={directory()} keyed>{(directory) => <OpenSpecSidebar
            api={api}
            project={{ directory, identity: directory }}
            theme={{ text: theme.text.base, textMuted: theme.text.muted,
              primary: theme.text.accent, success: theme.text.feedback.success.base,
              warning: theme.text.feedback.warning.base, error: theme.text.feedback.error.base,
              background: theme.background.base, backgroundPanel: theme.background.raised, backgroundMenu: theme.background.raised,
              border: theme.border.base }}
            dependencies={resolvedDependencies}
            registerCleanup={() => () => {}}
          />}</Show>;
        },
      });
    },
  });
}

export function createSidebarRuntime(input: {
  readonly api: SidebarApi;
  readonly project: ProjectContext;
  readonly dependencies?: OpenSpecTaskTuiDependencies;
}): SidebarRuntime {
  const project = input.project;
  const dependencies = input.dependencies ?? {};
  const listGateway = dependencies.listGateway ?? createOpenSpecListGateway();
  const statusGateway =
    dependencies.statusGateway ?? createOpenSpecStatusGateway();
  const listeners = new Set<(view: SidebarView) => void>();
  let state: PresentationState = { status: "idle" };
  let view: SidebarView = { status: "idle", emptyText: "No active OpenSpec change" };
  let preferenceChangeName: string | undefined;
  let preferences: AccordionPreferenceAdapter | undefined;
  let collapsedSectionIds = new Set<string>();
  let disposed = false;

  const coordinator = createRefreshCoordinator({
    projectDirectory: project.directory,
    listGateway,
    statusGateway,
    readTaskFile: dependencies.readTaskFile,
    watch: dependencies.watch,
    debounceMs: dependencies.debounceMs,
    reconcileIntervalMs: dependencies.reconcileIntervalMs,
  });

  const publishView = (): void => {
    view = toSidebarView(state, collapsedSectionIds);
    for (const listener of listeners) listener(view);
  };

  const applyState = (next: PresentationState): void => {
    state = next;
    if (next.status === "idle") {
      publishView();
      return;
    }

    const changeName = next.snapshot.change.name;
    if (!preferences || preferenceChangeName !== changeName) {
      preferences = createAccordionPreferenceAdapter(
        input.api.kv,
        project.identity,
        changeName,
      );
      preferenceChangeName = changeName;
    }

    if (next.status === "ready") {
      preferences.reconcileAfterSuccessfulRefresh(
        next.snapshot.sections.map((section) => section.id),
      );
    }
    collapsedSectionIds = new Set(preferences.collapsedSectionIds());
    publishView();
  };

  const unsubscribeCoordinator = coordinator.subscribe(applyState);

  return {
    start: () => coordinator.start(),

    getView: () => view,

    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    toggleSection(sectionID) {
      if (disposed || !preferences) return;
      preferences.setCollapsed(sectionID, !preferences.isCollapsed(sectionID));
      collapsedSectionIds = new Set(preferences.collapsedSectionIds());
      publishView();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      unsubscribeCoordinator();
      coordinator.dispose();
    },
  };
}

function OpenSpecSidebar(props: SidebarProps) {
  const renderer = useRenderer();
  let titleRow: BoxRenderable | undefined;
  let titleText: TextRenderable | undefined;
  const runtime = createSidebarRuntime({
    api: props.api,
    project: props.project,
    dependencies: props.dependencies,
  });
  const [view, setView] = createSignal(runtime.getView());
  const [tooltip, setTooltip] = createSignal<TaskTooltipLayout>();
  const tooltipHeightCache = new Map<string, number>();
  const clearTooltip = (): void => setTooltip(undefined);
  const showTooltip = (
    description: string,
    rowLeft: number,
    rowTop: number,
    rowWidth: number,
    textWidth: number,
  ): void => {
    const heightCacheKey = `${renderer.widthMethod}:${rowWidth}:${description}`;
    let descriptionHeight = tooltipHeightCache.get(heightCacheKey);
    if (descriptionHeight === undefined) {
      descriptionHeight = measureTaskTooltipHeight(
        description,
        rowWidth,
        renderer.widthMethod,
      );
      tooltipHeightCache.set(heightCacheKey, descriptionHeight);
    }
    setTooltip(
      resolveTaskTooltip({
        description,
        descriptionHeight,
        textWidth,
        rowLeft,
        rowTop,
        rowWidth,
        viewportWidth: renderer.width,
        viewportHeight: renderer.height,
      }),
    );
  };
  const unsubscribe = runtime.subscribe((next) =>
    batch(() => {
      clearTooltip();
      setView(next);
    }),
  );
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTooltip();
    unsubscribe();
    runtime.dispose();
  };
  const unregisterCleanup = props.registerCleanup(cleanup);
  onMount(() => {
    void runtime.start();
  });
  onCleanup(() => {
    unregisterCleanup();
    cleanup();
  });

  return (
    <box flexDirection="column" width="100%">
      <Show when={view().status !== "idle"} fallback={<EmptyState theme={props.theme} />}>
        {(() => {
          const current = view();
          if (current.status === "idle") return null;
          return (
            <>
              <box
                ref={titleRow}
                id="openspec-title"
                width="100%"
                height={1}
                onMouseMove={() => {
                  if (!titleRow) return;
                  if (titleText) titleText.scrollX = 0;
                  showTooltip(
                    current.title,
                    titleRow.screenX,
                    titleRow.screenY,
                    titleRow.width,
                    titleText?.scrollWidth ?? titleRow.width,
                  );
                }}
                onMouseOut={clearTooltip}
              >
                <text
                  ref={titleText}
                  width="100%"
                  height={1}
                  wrapMode="none"
                  truncate
                  selectable={false}
                  fg={props.theme.text}
                >
                  {current.title}
                </text>
              </box>
              <Show when={current.status === "stale"}>
                <CompactText fg={props.theme.warning} opacity={0.75}>
                  {current.staleWarning ?? ""}
                </CompactText>
              </Show>
              <For each={current.sections}>
                {(section, sectionIndex) => (
                  <TaskSectionView
                    section={section}
                    sectionIndex={sectionIndex()}
                    collapsed={section.collapsed}
                    theme={props.theme}
                    onToggle={() => {
                      clearTooltip();
                      runtime.toggleSection(section.id);
                    }}
                    onTooltipPointerMove={showTooltip}
                    onTooltipPointerOut={clearTooltip}
                  />
                )}
              </For>
            </>
          );
        })()}
      </Show>
      <Portal
        ref={(container) => {
          // Portal's wrapper otherwise enters the full-screen root flow below the viewport.
          const overlayRoot = container as BoxRenderable;
          overlayRoot.position = "absolute";
          overlayRoot.left = 0;
          overlayRoot.top = 0;
          overlayRoot.width = 0;
          overlayRoot.height = 0;
          overlayRoot.zIndex = 1000;
        }}
      >
        <Show when={tooltip()}>
          {(current: () => TaskTooltipLayout) => (
            <box
              id="openspec-task-tooltip"
              position="absolute"
              left={current().left}
              top={current().top}
              width={current().width}
              height={current().height}
              zIndex={1000}
              overflow="hidden"
              backgroundColor={props.theme.backgroundMenu}
              onMouse={clearTooltip}
            >
              <text
                width="100%"
                height="100%"
                wrapMode="word"
                selectable={false}
                fg={props.theme.text}
              >
                {current().description}
              </text>
            </box>
          )}
        </Show>
      </Portal>
    </box>
  );
}

function TaskSectionView(props: SectionProps) {
  let row: BoxRenderable | undefined;
  let text: TextRenderable | undefined;
  const activate = (): void => props.onToggle();
  const handleKeyDown = (event: KeyEvent): void => {
    activateSectionFromKey(event, activate);
  };
  const handleMouseDown = (event: MouseEvent): void => {
    activateSectionFromMouse(event, activate);
  };

  onCleanup(props.onTooltipPointerOut);

  return (
    <box flexDirection="column" width="100%">
      <box
        ref={row}
        id={`openspec-section-${props.sectionIndex}`}
        width="100%"
        height={1}
        focusable
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        onMouseMove={() => {
          if (!row) return;
          if (text) text.scrollX = 0;
          props.onTooltipPointerMove(
            props.section.title,
            row.screenX,
            row.screenY,
            row.width,
            text?.scrollWidth ?? row.width,
          );
        }}
        onMouseOut={props.onTooltipPointerOut}
      >
        <text
          ref={text}
          width="100%"
          height={1}
          wrapMode="none"
          truncate
          selectable={false}
          fg={props.theme.text}
        >
          {props.section.header}
        </text>
      </box>
      <Show when={!props.collapsed}>
        <For each={props.section.tasks}>
          {(task) => (
            <TaskRow
              task={task}
              theme={props.theme}
              onPointerMove={props.onTooltipPointerMove}
              onPointerOut={props.onTooltipPointerOut}
            />
          )}
        </For>
      </Show>
    </box>
  );
}

function TaskRow(props: TaskRowProps) {
  let row: BoxRenderable | undefined;
  let text: TextRenderable | undefined;

  onCleanup(props.onPointerOut);

  return (
    <box
      ref={row}
      width="100%"
      maxWidth="100%"
      minWidth={0}
      height={1}
      overflow="hidden"
      onMouseMove={() => {
        if (!row) return;
        if (text) text.scrollX = 0;
        props.onPointerMove(
          props.task.description,
          row.screenX,
          row.screenY,
          row.width,
          text?.scrollWidth ?? row.width,
        );
      }}
      onMouseOut={props.onPointerOut}
      onMouseScroll={(event) => {
        if (text) text.scrollX = 0;
        if (
          event.modifiers.shift ||
          event.scroll?.direction === "left" ||
          event.scroll?.direction === "right"
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <text
        ref={text}
        width="100%"
        maxWidth="100%"
        minWidth={0}
        height={1}
        flexShrink={1}
        overflow="hidden"
        wrapMode="none"
        truncate
        selectable={false}
        fg={props.task.completed ? props.theme.success : props.theme.textMuted}
      >
        {props.task.text}
      </text>
    </box>
  );
}

function EmptyState(props: { readonly theme: TuiThemeCurrent }) {
  return (
    <CompactText fg={props.theme.textMuted} opacity={0.7}>
      No active OpenSpec change
    </CompactText>
  );
}

function CompactText(props: {
  readonly children: string;
  readonly fg: TuiThemeCurrent["text"];
  readonly opacity?: number;
}) {
  return (
    <text
      width="100%"
      height={1}
      wrapMode="none"
      truncate
      selectable={false}
      fg={props.fg}
      opacity={props.opacity}
    >
      {props.children}
    </text>
  );
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function toSidebarView(
  state: PresentationState,
  collapsedSectionIds: ReadonlySet<string>,
): SidebarView {
  if (state.status === "idle") {
    return { status: "idle", emptyText: "No active OpenSpec change" };
  }

  return {
    status: state.status,
    title: `OpenSpec: ${state.snapshot.change.name} ${state.snapshot.progress.completed}/${state.snapshot.progress.total}`,
    staleWarning:
      state.status === "stale" ? `Stale · ${state.health.reason}` : undefined,
    sections: state.snapshot.sections.map((section) => {
      const collapsed = collapsedSectionIds.has(section.id);
      return {
        id: section.id,
        title: section.label,
        header: `${collapsed ? "▶" : "▼"} ${section.label} ${section.progress.completed}/${section.progress.total}`,
        collapsed,
        tasks: collapsed
          ? []
          : section.tasks.map((task) => ({
              text: `  ${task.completed ? "✓" : "☐"} ${task.label}`,
              description: task.label,
              completed: task.completed,
            })),
      };
    }),
  };
}

export default createOpenSpecTaskTui();
