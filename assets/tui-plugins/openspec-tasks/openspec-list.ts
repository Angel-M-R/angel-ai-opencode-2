import { isValidChangeName } from "./change-name.js";
import {
  runOpenSpecProcess,
  type ProcessExecutionResult,
  type ProcessExecutor,
} from "./openspec-process.js";

export type OpenSpecCandidateSelection =
  | { readonly status: "selected"; readonly changeName: string }
  | { readonly status: "no-candidate" }
  | { readonly status: "invalid-list" };

export type OpenSpecListResult =
  | Exclude<OpenSpecCandidateSelection, { readonly status: "invalid-list" }>
  | {
      readonly status: "temporary-failure";
      readonly reason:
        | "command"
        | "timeout"
        | "output"
        | "malformed-json"
        | "invalid-list";
    };

export interface OpenSpecListGateway {
  resolve(projectDirectory: string): Promise<OpenSpecListResult>;
}

interface EligibleCandidate {
  readonly name: string;
  readonly status: "in-progress" | "complete";
  readonly lastModified: number;
}

export function selectOpenSpecCandidate(
  value: unknown,
): OpenSpecCandidateSelection {
  if (!isRecord(value) || !Array.isArray(value.changes)) {
    return { status: "invalid-list" };
  }

  let selected: EligibleCandidate | undefined;
  for (const entry of value.changes) {
    const candidate = readEligibleCandidate(entry);
    if (!candidate || (selected && !precedes(candidate, selected))) continue;
    selected = candidate;
  }

  return selected
    ? { status: "selected", changeName: selected.name }
    : { status: "no-candidate" };
}

export function createOpenSpecListGateway(
  executor?: ProcessExecutor,
): OpenSpecListGateway {
  return {
    async resolve(projectDirectory) {
      const command = await runOpenSpecProcess(
        ["list", "--json"],
        projectDirectory,
        executor,
      );
      if (command.failure) return processFailure(command.failure);

      let value: unknown;
      try {
        value = JSON.parse(command.stdout) as unknown;
      } catch {
        return temporaryFailure("malformed-json");
      }

      const selection = selectOpenSpecCandidate(value);
      return selection.status === "invalid-list"
        ? temporaryFailure("invalid-list")
        : selection;
    },
  };
}

function readEligibleCandidate(value: unknown): EligibleCandidate | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !isValidChangeName(value.name) ||
    (value.status !== "in-progress" && value.status !== "complete") ||
    typeof value.lastModified !== "string"
  ) {
    return undefined;
  }

  const lastModified = Date.parse(value.lastModified);
  if (!Number.isFinite(lastModified)) return undefined;

  return { name: value.name, status: value.status, lastModified };
}

function precedes(
  candidate: EligibleCandidate,
  selected: EligibleCandidate,
): boolean {
  if (candidate.status !== selected.status) {
    return candidate.status === "in-progress";
  }
  return candidate.lastModified > selected.lastModified;
}

function processFailure(
  failure: NonNullable<ProcessExecutionResult["failure"]>,
): Extract<OpenSpecListResult, { status: "temporary-failure" }> {
  if (failure.kind === "timeout") return temporaryFailure("timeout");
  if (failure.kind === "output") return temporaryFailure("output");
  return temporaryFailure("command");
}

function temporaryFailure(
  reason: Extract<
    OpenSpecListResult,
    { status: "temporary-failure" }
  >["reason"],
): Extract<OpenSpecListResult, { status: "temporary-failure" }> {
  return { status: "temporary-failure", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
