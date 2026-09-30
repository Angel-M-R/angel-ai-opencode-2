import type { App, AppId } from "./apps.js";

export const FAVOURITE_APP_KEY = "opencode-open-in-app:favourite:v1";

export interface FavouriteAppKeyValueStore {
  get<Value = unknown>(key: string, fallback?: Value): Value;
  set(key: string, value: unknown): void;
}

export interface FavouriteAppStore {
  get(detectedApps: readonly App[]): App | undefined;
  set(appId: AppId): void;
}

export class FavouriteAppPreference implements FavouriteAppStore {
  constructor(private readonly store: FavouriteAppKeyValueStore) {}

  get(detectedApps: readonly App[]): App | undefined {
    let stored: unknown;

    try {
      stored = this.store.get<unknown>(FAVOURITE_APP_KEY, undefined);
    } catch {
      return undefined;
    }

    return detectedApps.find((app) => app.id === stored);
  }

  set(appId: AppId): void {
    this.store.set(FAVOURITE_APP_KEY, appId);
  }
}
