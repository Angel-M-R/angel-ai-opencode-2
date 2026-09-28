import { execFile } from "node:child_process";
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

const executeOpenSpecProcess: ProcessExecutor = (request) =>
  new Promise((resolve) => {
    execFile(
      request.command,
      [...request.args],
      {
        cwd: request.cwd,
        encoding: "utf8",
        maxBuffer: request.maxOutputBytes,
        timeout: request.timeoutMs,
        windowsHide: true,
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
