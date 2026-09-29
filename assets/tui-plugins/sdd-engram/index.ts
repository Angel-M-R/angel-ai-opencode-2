/** @jsxImportSource @opentui/solid */

/**
 * SRC Module Barrel Exports
 *
 * Consolidates and re-exports core functionality for easier access across the plugin.
 */

export * from "./config";
export {
	registerDialogCallbacks,
	showCreateProfile,
	showProfileDetail,
	showProfileList,
	showProfilesMenu,
	showProjectMemoriesMenu,
} from "./dialogs";
export * from "./memories";
export * from "./orchestrator";
export * from "./profiles";
export * from "./state.tsx";
export * from "./types";
export * from "./utils";
