import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { win32 } from "node:path";
import { Buffer } from "node:buffer";

export const PROCESS_TIMEOUT_MS = 5_000;
export const PROCESS_MAX_OUTPUT_BYTES = 256 * 1024;

export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export type ProcessFailureKind = "timeout" | "output" | "exit" | "spawn";

export interface ProcessExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly failure?: {
    readonly kind: ProcessFailureKind;
    readonly exitCode?: number;
  };
}

export type ProcessExecutor = (
  request: ProcessRequest,
) => Promise<ProcessExecutionResult>;

export async function runOpenSpecProcess(
  args: readonly string[],
  cwd: string,
  executor: ProcessExecutor = executeOpenSpecProcess,
): Promise<ProcessExecutionResult> {
  let result: ProcessExecutionResult;
  try {
    result = await executor({
      command: "openspec",
      args,
      cwd,
      timeoutMs: PROCESS_TIMEOUT_MS,
      maxOutputBytes: PROCESS_MAX_OUTPUT_BYTES,
    });
  } catch {
    return { stdout: "", stderr: "", failure: { kind: "spawn" } };
  }

  if (
    Buffer.byteLength(result.stdout, "utf8") > PROCESS_MAX_OUTPUT_BYTES ||
    Buffer.byteLength(result.stderr, "utf8") > PROCESS_MAX_OUTPUT_BYTES
  ) {
    return { stdout: "", stderr: "", failure: { kind: "output" } };
  }

  return result;
}

export function processCommand(request: ProcessRequest, platform = process.platform, resolveShim = resolveWindowsShim): { command: string; args: string[] } {
  if (platform !== "win32") return { command: request.command, args: [...request.args] };
  // Only the fixed CLI and shell-neutral list/status arguments reach cmd.exe.
  if (request.command !== "openspec" || request.args.some(arg => !/^[A-Za-z0-9_-]+$/.test(arg))) {
    throw new Error("Unsafe OpenSpec Windows arguments");
  }
  const shim = resolveShim(request.cwd);
  if (!win32.isAbsolute(shim) || /["%!&|<>^\r\n]/.test(shim)) throw new Error("Unsafe OpenSpec shim path");
  return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `""${shim}" ${request.args.join(" ")}"`] };
}

function resolveWindowsShim(cwd: string): string {
  const project = realpathSync(cwd);
  for (const directory of (process.env.PATH ?? "").split(";")) {
    if (!win32.isAbsolute(directory)) continue;
    try {
      const shim = realpathSync(win32.join(directory, "openspec.cmd"));
      const relative = win32.relative(project, shim);
      if (!win32.isAbsolute(relative) && relative !== ".." && !relative.startsWith("..\\")) continue;
      if (statSync(shim).isFile()) return shim;
    } catch { /* Try the next absolute PATH directory. */ }
  }
  throw new Error("No OpenSpec shim outside the project was found on PATH");
}

const executeOpenSpecProcess: ProcessExecutor = (request) =>
  new Promise((resolve) => {
    const launch = processCommand(request);
    execFile(
      launch.command,
      launch.args,
      {
        cwd: request.cwd,
        encoding: "utf8",
        maxBuffer: request.maxOutputBytes,
        timeout: request.timeoutMs,
        windowsHide: true,
        windowsVerbatimArguments: process.platform === "win32",
      },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          ...(error ? { failure: processFailure(error) } : {}),
        });
      },
    );
  });

function processFailure(error: Error): ProcessExecutionResult["failure"] {
  const details = error as Error & {
    readonly code?: string | number;
    readonly killed?: boolean;
  };

  if (details.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return { kind: "output" };
  }
  if (details.code === "ETIMEDOUT" || details.killed) {
    return { kind: "timeout" };
  }
  if (typeof details.code === "number") {
    return { kind: "exit", exitCode: details.code };
  }
  return { kind: "spawn" };
}
