import type { Plugin } from "@opencode/plugin/tui";
export const OPEN_FAVOURITE_COMMAND_ID = "opencode-open-in-app.open-project-root-with-favourite";
export const OPEN_FAVOURITE_KEYBINDING = "alt+o";

// Native keymap layers are owned and removed by the rendering Solid scope.
export function registerOpenFavouriteKeymap(
  context: Pick<Plugin.Context, "keymap">,
  activate: () => void,
  choose: () => void,
): void {
  context.keymap.layer(() => ({ mode: "global", commands: [
    { id: OPEN_FAVOURITE_COMMAND_ID, title: "Open project in favourite app", palette: true,
      bind: OPEN_FAVOURITE_KEYBINDING, slash: { name: "open-in-app" }, run: activate },
    { id: "opencode-open-in-app.choose", title: "Choose application for project", palette: true,
      slash: { name: "open-in-app-choose" }, run: choose },
  ] }));
}
