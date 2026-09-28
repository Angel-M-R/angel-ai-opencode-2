import type { Progress, Task, TaskDocument, TaskSection } from "./domain.js";

const FALLBACK_SECTION_LABEL = "Tasks";
const LIST_TASK_PATTERN = /^ {0,3}-\s+\[([ xX])\]\s+(.+?)\s*$/;
const HEADING_TASK_PATTERN = /^ {0,3}###\s+\[([ xX])\]\s+(.+?)\s*$/;
const HEADING_PATTERN = /^ {0,3}#{1,6}\s+(.+?)\s*$/;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

interface MutableSection {
  readonly id: string;
  readonly label: string;
  readonly tasks: Task[];
}

interface SectionReference {
  readonly id: string;
  readonly label: string;
  section?: MutableSection;
}

interface Fence {
  readonly marker: "`" | "~";
  readonly length: number;
}

export function normalizeSectionLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseTaskDocument(markdown: string): TaskDocument {
  const sections: MutableSection[] = [];
  const occurrenceByLabel = new Map<string, number>();
  let currentSection: SectionReference | undefined;
  let fallbackSection: SectionReference | undefined;
  let fence: Fence | undefined;

  const createSectionReference = (label: string): SectionReference => {
    const normalizedLabel = normalizeSectionLabel(label);
    const occurrence = (occurrenceByLabel.get(normalizedLabel) ?? 0) + 1;
    occurrenceByLabel.set(normalizedLabel, occurrence);
    return {
      id: `${normalizedLabel}:${occurrence}`,
      label,
    };
  };

  const addTask = (task: Task): void => {
    if (!currentSection) {
      fallbackSection ??= createSectionReference(FALLBACK_SECTION_LABEL);
      currentSection = fallbackSection;
    }

    if (!currentSection.section) {
      currentSection.section = {
        id: currentSection.id,
        label: currentSection.label,
        tasks: [],
      };
      sections.push(currentSection.section);
    }

    currentSection.section.tasks.push(task);
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
      continue;
    }

    const fenceMatch = line.match(FENCE_PATTERN);
    if (fenceMatch) {
      const delimiter = fenceMatch[1];
      fence = {
        marker: delimiter[0] as Fence["marker"],
        length: delimiter.length,
      };
      continue;
    }

    const headingTaskMatch = line.match(HEADING_TASK_PATTERN);
    if (headingTaskMatch) {
      addTask(toTask(headingTaskMatch[1], stripClosingHashes(headingTaskMatch[2])));
      continue;
    }

    const listTaskMatch = line.match(LIST_TASK_PATTERN);
    if (listTaskMatch) {
      addTask(toTask(listTaskMatch[1], listTaskMatch[2].trim()));
      continue;
    }

    const headingMatch = line.match(HEADING_PATTERN);
    if (headingMatch) {
      const label = stripClosingHashes(headingMatch[1]);
      if (label.length > 0) currentSection = createSectionReference(label);
    }
  }

  const finalizedSections = sections.map(finalizeSection);
  return {
    sections: finalizedSections,
    progress: sumProgress(finalizedSections.map((section) => section.progress)),
  };
}

function toTask(marker: string, label: string): Task {
  return {
    label,
    completed: marker.toLowerCase() === "x",
  };
}

function stripClosingHashes(label: string): string {
  return label.replace(/\s+#+\s*$/, "").trim();
}

function closesFence(line: string, fence: Fence): boolean {
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return (
    match?.[1]?.[0] === fence.marker && match[1].length >= fence.length
  );
}

function finalizeSection(section: MutableSection): TaskSection {
  return {
    id: section.id,
    label: section.label,
    tasks: section.tasks,
    progress: taskProgress(section.tasks),
  };
}

function taskProgress(tasks: readonly Task[]): Progress {
  return {
    completed: tasks.reduce(
      (count, task) => count + (task.completed ? 1 : 0),
      0,
    ),
    total: tasks.length,
  };
}

function sumProgress(progress: readonly Progress[]): Progress {
  return progress.reduce<Progress>(
    (total, current) => ({
      completed: total.completed + current.completed,
      total: total.total + current.total,
    }),
    { completed: 0, total: 0 },
  );
}
