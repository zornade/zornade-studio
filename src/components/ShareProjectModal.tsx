/**
 * Sharing dialog for a single Studio project (Fase 5, roadmap - see
 * /memories/repo/zornade-studio-oss-own-project-2026-07-06.md). Opened from
 * ProjectsModal's "Condividi" action on an owned project row.
 */

import { useCallback, useEffect, useState } from "react";
import { X, UserPlus, Trash2, Loader2 } from "lucide-react";
import { useSupabaseAuth } from "../auth/SupabaseAuthContext";
import { Button } from "./primitives";
import {
  listCollaborators,
  inviteCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
  type CollaboratorRecord,
} from "../lib/studio-collaborators";
import type { CollaboratorRole } from "../lib/studio-projects";

function displayName(c: CollaboratorRecord): string {
  return c.invitedEmail ?? c.username ?? "Zornade user";
}

export function ShareProjectModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const { userId } = useSupabaseAuth();
  const [collaborators, setCollaborators] = useState<CollaboratorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CollaboratorRole>("viewer");
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listCollaborators(projectId);
    if (res.error !== null) setError(res.error);
    setCollaborators(res.data ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleInvite = async () => {
    if (!userId) return;
    setInviting(true);
    setError(null);
    const res = await inviteCollaborator({ projectId, email, role, invitedBy: userId });
    setInviting(false);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    setEmail("");
    await refresh();
  };

  const handleRoleChange = async (c: CollaboratorRecord, newRole: CollaboratorRole) => {
    setBusyId(c.id);
    const res = await updateCollaboratorRole({ id: c.id, role: newRole });
    setBusyId(null);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    await refresh();
  };

  const handleRemove = async (c: CollaboratorRecord) => {
    setBusyId(c.id);
    const res = await removeCollaborator(c.id);
    setBusyId(null);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    await refresh();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">Share</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">{projectName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center gap-1.5">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              type="email"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleInvite();
              }}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-zornade focus:outline-none"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as CollaboratorRole)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-zornade focus:outline-none"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <Button variant="primary" disabled={inviting || !email.trim()} onClick={() => void handleInvite()}>
              {inviting ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              Invite
            </Button>
          </div>

          {error && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{error}</p>
          )}

          {loading ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
          ) : collaborators.length === 0 ? (
            <p className="text-sm text-slate-400">No collaborators yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {collaborators.map((c) => {
                const busy = busyId === c.id;
                const pending = c.userId === null;
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {displayName(c)}
                        {pending && (
                          <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                            pending
                          </span>
                        )}
                      </p>
                    </div>
                    {busy ? (
                      <Loader2 size={15} className="animate-spin text-slate-400" />
                    ) : (
                      <>
                        <select
                          value={c.role}
                          onChange={(e) => void handleRoleChange(c, e.target.value as CollaboratorRole)}
                          className="rounded-md border border-slate-200 px-1.5 py-1 text-xs focus:border-zornade focus:outline-none"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                        <button
                          onClick={() => void handleRemove(c)}
                          title="Remove"
                          className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
