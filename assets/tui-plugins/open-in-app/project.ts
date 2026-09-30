import { statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

interface ProjectPathApi {
  readonly state: {
    readonly path: {
      readonly directory?: unknown;
      readonly worktree?: unknown;
    };
  };
}

export function resolveProjectRoot(api: ProjectPathApi): string | undefined {
  const directory = validateDirectory(readHostPath(api, "directory"));
  if (directory) return directory;

  const worktree = validateDirectory(readHostPath(api, "worktree"));
  if (worktree) return worktree;

  return validateDirectory(readCwd());
}

function readHostPath(
  api: ProjectPathApi,
  key: "directory" | "worktree",
): unknown {
  try {
    return api.state.path[key];
  } catch {
    return undefined;
  }
}

function readCwd(): unknown {
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

function validateDirectory(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;

  try {
    if (!isAbsolute(value)) return undefined;
    const normalized = normalize(value);
    return statSync(normalized).isDirectory() ? normalized : undefined;
  } catch {
    return undefined;
  }
}
