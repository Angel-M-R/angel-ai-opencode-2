import { isValidChangeName } from "./change-name.js";

const PREFERENCE_KEY_NAMESPACE = "openspec-task-tui:accordion:v1";

export interface PreferenceKeyValueStore {
  get<Value = unknown>(key: string, fallback?: Value): Value;
  set(key: string, value: unknown): void;
}

export interface AccordionPreferenceAdapter {
  collapsedSectionIds(): readonly string[];
  isCollapsed(sectionId: string): boolean;
  setCollapsed(sectionId: string, collapsed: boolean): void;
  reconcileAfterSuccessfulRefresh(
    sectionIds: readonly string[],
  ): readonly string[];
}

export function accordionPreferenceKey(
  projectIdentity: string,
  changeName: string,
): string {
  if (projectIdentity.trim().length === 0) {
    throw new Error("Project identity must not be empty");
  }
  if (!isValidChangeName(changeName)) {
    throw new Error("Accordion preferences require a validated change name");
  }

  return `${PREFERENCE_KEY_NAMESPACE}:${encodeURIComponent(projectIdentity)}:${encodeURIComponent(changeName)}`;
}

export function createAccordionPreferenceAdapter(
  store: PreferenceKeyValueStore,
  projectIdentity: string,
  changeName: string,
): AccordionPreferenceAdapter {
  const key = accordionPreferenceKey(projectIdentity, changeName);
  const stored = store.get<unknown>(key, undefined);
  const validStoredValue = isCollapsedSectionValue(stored);
  let collapsed = new Set(validStoredValue ? stored : []);
  let needsRepair =
    stored !== undefined &&
    (!validStoredValue || collapsed.size !== stored.length);

  const persist = (): void => {
    store.set(key, [...collapsed].sort());
    needsRepair = false;
  };

  return {
    collapsedSectionIds: () => [...collapsed],

    isCollapsed: (sectionId) => collapsed.has(sectionId),

    setCollapsed(sectionId, shouldCollapse) {
      assertSectionId(sectionId);
      const changed = shouldCollapse
        ? !collapsed.has(sectionId)
        : collapsed.has(sectionId);

      if (shouldCollapse) collapsed.add(sectionId);
      else collapsed.delete(sectionId);

      if (changed || needsRepair) persist();
    },

    reconcileAfterSuccessfulRefresh(sectionIds) {
      const currentSectionIds = new Set(sectionIds);
      const restored = new Set(
        [...collapsed].filter((sectionId) => currentSectionIds.has(sectionId)),
      );
      const removed = restored.size !== collapsed.size;
      collapsed = restored;

      if (removed || needsRepair) persist();
      return [...collapsed];
    },
  };
}

function isCollapsedSectionValue(
  value: unknown,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((sectionId) =>
      typeof sectionId === "string" && sectionId.length > 0
    )
  );
}

function assertSectionId(sectionId: string): void {
  if (sectionId.length === 0) {
    throw new Error("Section identity must not be empty");
  }
}
