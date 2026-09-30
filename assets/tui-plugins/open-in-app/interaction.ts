export interface ActivationKeyEvent {
  readonly name: string;
  readonly repeated?: boolean;
  readonly eventType?: "press" | "repeat" | "release";
  preventDefault(): void;
  stopPropagation(): void;
}

export interface ActivationMouseEvent {
  readonly button: number;
  readonly target: { focus(): void } | null;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface ActivationRegionHandlers {
  onKeyDown(event: ActivationKeyEvent): void;
  onMouseDown(event: ActivationMouseEvent): void;
  onMouseUp(event: ActivationMouseEvent): void;
}

export function activateFromKey(
  event: ActivationKeyEvent,
  activate: () => void,
): boolean {
  if (event.name !== "return" && event.name !== "space") return false;

  event.preventDefault();
  event.stopPropagation();
  // Holding Return/Space emits key-repeat events; consume them without relaunching.
  if (event.repeated || event.eventType === "repeat") return true;
  activate();
  return true;
}

export function activateFromMouse(
  event: ActivationMouseEvent,
  activate: () => void,
): boolean {
  if (event.button !== 0) return false;

  event.preventDefault();
  event.stopPropagation();
  event.target?.focus();
  activate();
  return true;
}

export function createActivationRegionHandlers(
  activate: () => void,
): ActivationRegionHandlers {
  let primaryPressStarted = false;

  return {
    onKeyDown(event) {
      activateFromKey(event, activate);
    },
    onMouseDown(event) {
      activateFromMouse(event, () => {
        primaryPressStarted = true;
      });
    },
    onMouseUp(event) {
      const shouldActivate = primaryPressStarted && event.button === 0;
      primaryPressStarted = false;
      activateFromMouse(event, () => {
        if (shouldActivate) activate();
      });
    },
  };
}
