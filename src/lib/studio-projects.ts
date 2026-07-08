/**
 * Server-side project persistence (Fase 4, roadmap - see
 * /memories/repo/zornade-studio-oss-own-project-2026-07-06.md).
 *
 * Thin CRUD layer over the `studio_projects` / `studio_project_collaborators`
 * tables in Studio's OWN dedicated Supabase project (see lib/supabase.ts).
 * Row Level Security does the actual access control (owner/editor/viewer) -
 * this module just shapes requests/responses and never assumes a query
 * succeeded because it "looks right" client-side.
 *
 * Every function is safe to call even when Supabase isn't configured (self-
 * hoster without a project set up): it returns `{ error }` instead of
 * throwing, mirroring the pattern in auth/SupabaseAuthContext.tsx.
 *
 * This is additive: the file-based export/import in lib/project.ts (see
 * PublishPanel's "Salva progetto" / "Apri progetto") is untouched and stays
 * as the offline/portable/backup path.
 */

import { getSupabaseClient } from "./supabase";
import type { SavableProject } from "./project";
import { PROJECT_SCHEMA_VERSION } from "./project";

export type CollaboratorRole = "owner" | "editor" | "viewer";

/** Lightweight row for list views - never carries the (potentially large) state. */
export interface StudioProjectSummary {
  id: string;
  name: string;
  ownerId: string;
  updatedAt: string;
  /** The caller's own relationship to this project. */
  role: CollaboratorRole;
}

/** Full row, including the serialised editor state - only fetched on open. */
export interface StudioProjectRecord extends StudioProjectSummary {
  state: SavableProject;
  schemaVersion: number;
}

export type Result<T> = { data: T; error: null } | { data: null; error: string };

function ok<T>(data: T): Result<T> {
  return { data, error: null };
}

function fail<T>(error: string): Result<T> {
  return { data: null, error };
}

/** Generic Postgres/PostgREST error → a short, user-facing Italian message. */
function describeError(err: { message?: string } | null | undefined): string {
  return err?.message
    ? `Errore del database: ${err.message}`
    : "Errore del database sconosciuto.";
}

const NOT_CONFIGURED = "Supabase non configurato per questo ambiente.";

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  updated_at: string;
  state?: SavableProject;
  schema_version?: number;
}

function toSummary(row: ProjectRow, role: CollaboratorRole): StudioProjectSummary {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    updatedAt: row.updated_at,
    role,
  };
}

/** Projects owned by `userId`, most recently updated first. Excludes soft-deleted rows. */
export async function listMyProjects(
  userId: string,
): Promise<Result<StudioProjectSummary[]>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const { data, error } = await client
    .from("studio_projects")
    .select("id, owner_id, name, updated_at")
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) return fail(describeError(error));
  return ok((data ?? []).map((row) => toSummary(row as ProjectRow, "owner")));
}

/** Projects shared with `userId` as a collaborator (editor or viewer). */
export async function listSharedWithMe(
  userId: string,
): Promise<Result<StudioProjectSummary[]>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const { data: grants, error: grantsError } = await client
    .from("studio_project_collaborators")
    .select("project_id, role")
    .eq("user_id", userId);

  if (grantsError) return fail(describeError(grantsError));
  if (!grants || grants.length === 0) return ok([]);

  const roleByProjectId = new Map<string, CollaboratorRole>(
    grants.map((g) => [g.project_id as string, g.role as CollaboratorRole]),
  );
  const projectIds = [...roleByProjectId.keys()];

  const { data: rows, error: rowsError } = await client
    .from("studio_projects")
    .select("id, owner_id, name, updated_at")
    .in("id", projectIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (rowsError) return fail(describeError(rowsError));
  return ok(
    (rows ?? []).map((row) => {
      const typed = row as ProjectRow;
      return toSummary(typed, roleByProjectId.get(typed.id) ?? "viewer");
    }),
  );
}

/** Fetch a single project's full state, for opening it in the editor. */
export async function getProject(
  id: string,
  userId: string,
): Promise<Result<StudioProjectRecord>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const { data, error } = await client
    .from("studio_projects")
    .select("id, owner_id, name, updated_at, state, schema_version")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error) return fail(describeError(error));
  const row = data as ProjectRow;
  if (row.schema_version !== PROJECT_SCHEMA_VERSION) {
    return fail(
      `Versione del progetto non supportata (${String(row.schema_version)}).`,
    );
  }
  const role: CollaboratorRole = row.owner_id === userId ? "owner" : "editor";
  return ok({
    ...toSummary(row, role),
    state: row.state as SavableProject,
    schemaVersion: row.schema_version as number,
  });
}

/** Create a brand-new server-saved project owned by `userId`. */
export async function createProject(params: {
  userId: string;
  name: string;
  state: SavableProject;
}): Promise<Result<StudioProjectRecord>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const name = params.name.trim();
  if (!name) return fail("Il nome del progetto non può essere vuoto.");

  const { data, error } = await client
    .from("studio_projects")
    .insert({
      owner_id: params.userId,
      name,
      state: params.state,
      schema_version: PROJECT_SCHEMA_VERSION,
    })
    .select("id, owner_id, name, updated_at, state, schema_version")
    .single();

  if (error) return fail(describeError(error));
  const row = data as ProjectRow;
  return ok({
    ...toSummary(row, "owner"),
    state: row.state as SavableProject,
    schemaVersion: row.schema_version as number,
  });
}

/** Save the current editor state into an existing project (overwrite). */
export async function saveProjectState(params: {
  id: string;
  state: SavableProject;
}): Promise<Result<StudioProjectSummary>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const { data, error } = await client
    .from("studio_projects")
    .update({ state: params.state, schema_version: PROJECT_SCHEMA_VERSION })
    .eq("id", params.id)
    .select("id, owner_id, name, updated_at")
    .single();

  if (error) return fail(describeError(error));
  const row = data as ProjectRow;
  return ok(toSummary(row, "owner"));
}

/** Rename a project (owner or editor - see studio_projects_update_editor RLS). */
export async function renameProject(params: {
  id: string;
  name: string;
}): Promise<Result<StudioProjectSummary>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const name = params.name.trim();
  if (!name) return fail("Il nome del progetto non può essere vuoto.");

  const { data, error } = await client
    .from("studio_projects")
    .update({ name })
    .eq("id", params.id)
    .select("id, owner_id, name, updated_at")
    .single();

  if (error) return fail(describeError(error));
  return ok(toSummary(data as ProjectRow, "owner"));
}

/**
 * Duplicate a project the caller can currently see (owner or collaborator)
 * into a brand-new project owned by `userId`. Editors/viewers can therefore
 * "fork" a shared project into their own copy; the original is untouched.
 */
export async function duplicateProject(params: {
  id: string;
  userId: string;
}): Promise<Result<StudioProjectRecord>> {
  const original = await getProject(params.id, params.userId);
  if (original.error !== null) return fail(original.error);

  return createProject({
    userId: params.userId,
    name: `${original.data.name} (copia)`,
    state: original.data.state,
  });
}

/**
 * Soft-delete a project (owner only - enforced both by RLS and, for
 * `deleted_at` specifically, by studio_projects_guard_editor_delete_trg,
 * since a generic UPDATE policy alone can't restrict which columns an
 * editor may touch). Hidden from list views; not yet exposed as a
 * recoverable "trash" UI.
 */
export async function softDeleteProject(id: string): Promise<Result<null>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const { error } = await client
    .from("studio_projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return fail(describeError(error));
  return ok(null);
}
