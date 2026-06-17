/**
 * Project save / load (ROADMAP O2.9).
 *
 * A "project" is the **full editable** Studio state — unlike the published spec
 * (lib/spec.ts), which is a minimal, immutable snapshot for embedding. Saving a
 * project lets the operator close the editor and reopen the exact same map
 * (data, columns, viz type, design, brand) to keep working on it.
 *
 * `StudioState` is already a plain, serialisable object (no functions/refs), so
 * the project file is just a versioned wrapper around it. We keep this module
 * pure and validated so a hand-edited or out-of-date file fails with a clear
 * message instead of corrupting the editor.
 */

import type { StudioState } from "../studio/types";

/** Bump when the saved shape changes incompatibly. */
export const PROJECT_SCHEMA_VERSION = 1 as const;

/** The persisted subset of the editor state (the whole StudioState today). */
export type SavableProject = StudioState;

export interface ProjectFile {
  kind: "zornade-studio-project";
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  /** ISO timestamp of when the file was written. */
  savedAt: string;
  state: SavableProject;
}

/** Serialise the editor state to a pretty-printed project JSON string. */
export function serialiseProject(state: SavableProject): string {
  const file: ProjectFile = {
    kind: "zornade-studio-project",
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    state,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parse + validate a project file. Returns the editor state to load, or a
 * human-readable error. Validation is intentionally shallow but covers the
 * shape the editor relies on, so a wrong/old file can't silently break it.
 */
export function parseProject(
  json: string,
): { state: SavableProject } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { error: "Il file non è un JSON valido." };
  }
  if (!isObject(data) || data.kind !== "zornade-studio-project") {
    return { error: "Non è un progetto Zornade Studio." };
  }
  if (data.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    return {
      error: `Versione del progetto non supportata (${String(
        (data as { schemaVersion?: unknown }).schemaVersion,
      )}).`,
    };
  }
  const state = (data as { state?: unknown }).state;
  if (!isValidState(state)) {
    return { error: "Il progetto è incompleto o danneggiato." };
  }
  return { state };
}

/** Shallow structural check of the persisted state. */
function isValidState(v: unknown): v is SavableProject {
  if (!isObject(v)) return false;
  const s = v as Record<string, unknown>;
  if (!isObject(s.project) || !isObject(s.design) || !isObject(s.brand)) {
    return false;
  }
  if (typeof s.vizType !== "string" || typeof s.preset !== "string") {
    return false;
  }
  // `data` may be null (no dataset yet) or a dataset object with rows.
  if (s.data !== null) {
    if (!isObject(s.data) || !Array.isArray((s.data as { rows?: unknown }).rows)) {
      return false;
    }
  }
  return true;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
