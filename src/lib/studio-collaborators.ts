/**
 * Collaborator management for a Studio project (Fase 5, roadmap - see
 * /memories/repo/zornade-studio-oss-own-project-2026-07-06.md).
 *
 * Thin CRUD layer over `studio_project_collaborators`, mirroring the style
 * of lib/studio-projects.ts (Result<T>, never throws, RLS does the actual
 * access control). Inviting also best-effort notifies the invitee by email
 * via the `send-project-invite-email` Edge Function - a failure to notify
 * is surfaced but the collaborator row itself is already saved by then, so
 * the share isn't lost even if the email fails to send.
 */

import { getSupabaseClient } from "./supabase";
import type { CollaboratorRole, Result } from "./studio-projects";

export interface CollaboratorRecord {
  id: string;
  projectId: string;
  userId: string | null;
  invitedEmail: string | null;
  role: CollaboratorRole;
  createdAt: string;
  acceptedAt: string | null;
  /** Username of the resolved account, when userId is set (joined from profiles). */
  username: string | null;
}

function ok<T>(data: T): Result<T> {
  return { data, error: null };
}

function fail<T>(error: string): Result<T> {
  return { data: null, error };
}

function describeError(err: { message?: string } | null | undefined): string {
  return err?.message
    ? `Errore del database: ${err.message}`
    : "Errore del database sconosciuto.";
}

const NOT_CONFIGURED = "Supabase is not configured for this environment.";

interface CollabRow {
  id: string;
  project_id: string;
  user_id: string | null;
  invited_email: string | null;
  role: CollaboratorRole;
  created_at: string;
  accepted_at: string | null;
}

function toRecord(row: CollabRow, username: string | null): CollaboratorRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    invitedEmail: row.invited_email,
    role: row.role,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    username,
  };
}

/** List all collaborators of a project (owner-only, per RLS). */
export async function listCollaborators(
  projectId: string,
): Promise<Result<CollaboratorRecord[]>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const { data: rows, error } = await client
    .from("studio_project_collaborators")
    .select("id, project_id, user_id, invited_email, role, created_at, accepted_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) return fail(describeError(error));
  const typed = (rows ?? []) as CollabRow[];

  const userIds = typed.map((r) => r.user_id).filter((id): id is string => id !== null);
  const usernameByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, username")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      usernameByUserId.set(p.id as string, p.username as string);
    }
  }

  return ok(typed.map((r) => toRecord(r, r.user_id ? usernameByUserId.get(r.user_id) ?? null : null)));
}

/**
 * Invite a collaborator by email: resolves an existing confirmed account via
 * `studio_find_collaborator_candidate` (sets user_id directly) or falls back
 * to a pending `invited_email` grant, then best-effort sends a notification
 * email. The notification failing does NOT roll back the grant - it is
 * already valid and will show up next time the invitee opens Studio.
 */
export async function inviteCollaborator(params: {
  projectId: string;
  email: string;
  role: CollaboratorRole;
  invitedBy: string;
}): Promise<Result<CollaboratorRecord>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const email = params.email.trim();
  if (!email) return fail("Enter an email address.");
  if (params.role === "owner") return fail("Cannot invite as owner.");

  const { data: candidates, error: candidateError } = await client.rpc(
    "studio_find_collaborator_candidate",
    { p_email: email },
  );
  if (candidateError) return fail(describeError(candidateError));
  const candidate = (candidates ?? [])[0] as
    | { user_id: string; username: string | null }
    | undefined;

  const { data, error } = await client
    .from("studio_project_collaborators")
    .insert({
      project_id: params.projectId,
      user_id: candidate?.user_id ?? null,
      invited_email: candidate ? null : email,
      role: params.role,
      invited_by: params.invitedBy,
    })
    .select("id, project_id, user_id, invited_email, role, created_at, accepted_at")
    .single();

  if (error) return fail(describeError(error));

  // Best-effort email notification - never blocks the share itself.
  try {
    const { error: fnError } = await client.functions.invoke("send-project-invite-email", {
      body: { projectId: params.projectId, inviteeEmail: email, role: params.role },
    });
    if (fnError) console.warn("Notifica invito non inviata:", fnError.message);
  } catch (err) {
    console.warn("Notifica invito non inviata:", err);
  }

  return ok(toRecord(data as CollabRow, candidate?.username ?? null));
}

/** Change a collaborator's role (owner only, per RLS). */
export async function updateCollaboratorRole(params: {
  id: string;
  role: CollaboratorRole;
}): Promise<Result<CollaboratorRecord>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);
  if (params.role === "owner") return fail("Cannot assign the owner role.");

  const { data, error } = await client
    .from("studio_project_collaborators")
    .update({ role: params.role })
    .eq("id", params.id)
    .select("id, project_id, user_id, invited_email, role, created_at, accepted_at")
    .single();

  if (error) return fail(describeError(error));
  return ok(toRecord(data as CollabRow, null));
}

/** Remove a collaborator (owner removes anyone; a collaborator may remove themselves). */
export async function removeCollaborator(id: string): Promise<Result<null>> {
  const client = getSupabaseClient();
  if (!client) return fail(NOT_CONFIGURED);

  const { error } = await client.from("studio_project_collaborators").delete().eq("id", id);
  if (error) return fail(describeError(error));
  return ok(null);
}
