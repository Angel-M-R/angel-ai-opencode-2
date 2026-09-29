import { execFile } from "node:child_process";

export type ProcessFailureKind = "spawn" | "exit" | "timeout" | "output";

export const PROCESS_MAX_BUFFER_BYTES = 1024 * 1024;

export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

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

export const defaultProcessExecutor: ProcessExecutor = (request) =>
  new Promise((resolve) => {
    try {
      execFile(
        request.command,
        [...request.args],
        {
          cwd: request.cwd,
          encoding: "utf8",
          maxBuffer: PROCESS_MAX_BUFFER_BYTES,
          shell: false,
          timeout: request.timeoutMs,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout,
            stderr,
            ...(error ? { failure: classifyProcessFailure(error) } : {}),
          });
        },
      );
    } catch {
      resolve({ stdout: "", stderr: "", failure: { kind: "spawn" } });
    }
  });

function classifyProcessFailure(
  error: Error,
): ProcessExecutionResult["failure"] {
  const details = error as Error & {
    readonly code?: string | number;
    readonly killed?: boolean;
  };

  if (details.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { kind: "output" };
  if (details.code === "ETIMEDOUT" || details.killed) {
    return { kind: "timeout" };
  }
  if (typeof details.code === "number") {
    return { kind: "exit", exitCode: details.code };
  }
  return { kind: "spawn" };
}
