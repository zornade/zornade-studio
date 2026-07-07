/**
 * "I miei progetti" (Fase 4, roadmap): browse/open/rename/duplicate/delete
 * server-saved projects (Studio's own Supabase project), additive to the
 * file-based export/import in PublishPanel's "Progetto" section (which
 * remains the offline/portable/backup path - see
 * /memories/repo/zornade-studio-oss-own-project-2026-07-06.md).
 *
 * Only rendered when Supabase is configured AND the operator is signed in
 * via the per-user magic-link auth (SupabaseAuthContext) - saving to the
 * cloud is tied to a real auth.users id (owner_id), unlike the legacy
 * shared-password gate which has no per-user identity.
 */

import { useCallback, useEffect, useState } from "react";
import { X, FolderOpen, Copy, Pencil, Trash2, Plus, Check, Loader2, Share2 } from "lucide-react";
import { useStudio } from "../studio/StudioContext";
import { useSupabaseAuth } from "../auth/SupabaseAuthContext";
import { Button } from "./primitives";
import { ShareProjectModal } from "./ShareProjectModal";
import {
  listMyProjects,
  listSharedWithMe,
  getProject,
  createProject,
  saveProjectState,
  renameProject,
  duplicateProject,
  softDeleteProject,
  type StudioProjectSummary,
} from "../lib/studio-projects";
import type { SavableProject } from "../lib/project";

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ProjectsModal({ onClose }: { onClose: () => void }) {
  const studio = useStudio();
  const { userId } = useSupabaseAuth();

  const [mine, setMine] = useState<StudioProjectSummary[]>([]);
  const [shared, setShared] = useState<StudioProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [shareTarget, setShareTarget] = useState<StudioProjectSummary | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const [mineRes, sharedRes] = await Promise.all([
      listMyProjects(userId),
      listSharedWithMe(userId),
    ]);
    if (mineRes.error) setError(mineRes.error);
    else if (sharedRes.error) setError(sharedRes.error);
    setMine(mineRes.data ?? []);
    setShared(sharedRes.data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentState = (): SavableProject => ({
    step: studio.step,
    project: studio.project,
    dataSource: studio.dataSource,
    vizType: studio.vizType,
    preset: studio.preset,
    brand: studio.brand,
    design: studio.design,
    data: studio.data,
    annotations: studio.annotations,
    storySteps: studio.storySteps,
  });

  const handleOpen = async (row: StudioProjectSummary) => {
    if (!userId) return;
    setBusyId(row.id);
    setError(null);
    const res = await getProject(row.id, userId);
    setBusyId(null);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    studio.loadProject(res.data.state);
    studio.setCurrentProjectId(res.data.id);
    onClose();
  };

  const handleSaveCurrent = async () => {
    if (!userId) return;
    if (studio.currentProjectId) {
      setBusyId(studio.currentProjectId);
      const res = await saveProjectState({
        id: studio.currentProjectId,
        state: currentState(),
      });
      setBusyId(null);
      if (res.error) {
        setError(res.error);
        return;
      }
      await refresh();
    } else {
      setShowNewForm(true);
      setNewName(studio.project.title || "Mappa senza titolo");
    }
  };

  const handleCreateNew = async () => {
    if (!userId) return;
    setBusyId("__new__");
    const res = await createProject({
      userId,
      name: newName,
      state: currentState(),
    });
    setBusyId(null);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    studio.setCurrentProjectId(res.data.id);
    setShowNewForm(false);
    setNewName("");
    await refresh();
  };

  const handleRenameSubmit = async (id: string) => {
    setBusyId(id);
    const res = await renameProject({ id, name: renameValue });
    setBusyId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setRenamingId(null);
    await refresh();
  };

  const handleDuplicate = async (row: StudioProjectSummary) => {
    if (!userId) return;
    setBusyId(row.id);
    const res = await duplicateProject({ id: row.id, userId });
    setBusyId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    await refresh();
  };

  const handleDelete = async (row: StudioProjectSummary) => {
    setBusyId(row.id);
    const res = await softDeleteProject(row.id);
    setBusyId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setConfirmDeleteId(null);
    if (studio.currentProjectId === row.id) studio.setCurrentProjectId(null);
    await refresh();
  };

  const renderRow = (row: StudioProjectSummary) => {
    const busy = busyId === row.id;
    const isCurrent = studio.currentProjectId === row.id;
    return (
      <li
        key={row.id}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 ${
          isCurrent ? "border-zornade bg-zornade-50/50" : "border-slate-200"
        }`}
      >
        <div className="min-w-0 flex-1">
          {renamingId === row.id ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRenameSubmit(row.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-zornade focus:outline-none"
              />
              <button
                onClick={() => void handleRenameSubmit(row.id)}
                className="rounded-md p-1 text-zornade-700 hover:bg-zornade-50"
                aria-label="Conferma rinomina"
              >
                <Check size={15} />
              </button>
              <button
                onClick={() => setRenamingId(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Annulla rinomina"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <>
              <p className="truncate text-sm font-medium text-slate-800">
                {row.name}
                {isCurrent && (
                  <span className="ml-2 rounded-full bg-zornade-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zornade-700">
                    aperto
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-400">
                {row.role !== "owner" && (
                  <span className="mr-1.5 capitalize">{row.role} ·</span>
                )}
                Modificato il {formatUpdatedAt(row.updatedAt)}
              </p>
            </>
          )}
        </div>

        {confirmDeleteId === row.id ? (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <span className="text-xs text-slate-500">Eliminare?</span>
            <Button
              variant="primary"
              className="!px-2 !py-1 !text-xs"
              disabled={busy}
              onClick={() => void handleDelete(row)}
            >
              Sì
            </Button>
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={() => setConfirmDeleteId(null)}
            >
              No
            </Button>
          </div>
        ) : (
          <div className="flex flex-shrink-0 items-center gap-1">
            {busy ? (
              <Loader2 size={15} className="animate-spin text-slate-400" />
            ) : (
              <>
                <button
                  onClick={() => void handleOpen(row)}
                  title="Apri"
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-zornade-700"
                >
                  <FolderOpen size={15} />
                </button>
                <button
                  onClick={() => {
                    setRenamingId(row.id);
                    setRenameValue(row.name);
                  }}
                  title="Rinomina"
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-zornade-700"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => void handleDuplicate(row)}
                  title="Duplica"
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-zornade-700"
                >
                  <Copy size={15} />
                </button>
                {row.role === "owner" && (
                  <button
                    onClick={() => setShareTarget(row)}
                    title="Condividi"
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-zornade-700"
                  >
                    <Share2 size={15} />
                  </button>
                )}
                {row.role === "owner" && (
                  <button
                    onClick={() => setConfirmDeleteId(row.id)}
                    title="Elimina"
                    className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-slate-900">
            I tuoi progetti
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Chiudi"
          >
            <X size={16} />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            {showNewForm ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome del progetto"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateNew();
                    if (e.key === "Escape") setShowNewForm(false);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-zornade focus:outline-none"
                />
                <Button
                  variant="primary"
                  disabled={busyId === "__new__"}
                  onClick={() => void handleCreateNew()}
                >
                  Salva
                </Button>
                <Button variant="ghost" onClick={() => setShowNewForm(false)}>
                  Annulla
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  {studio.currentProjectId
                    ? "Salva le modifiche nel progetto attualmente aperto, oppure creane uno nuovo."
                    : "Il progetto corrente non è ancora salvato nel cloud."}
                </p>
                <div className="flex flex-shrink-0 gap-1.5">
                  {studio.currentProjectId && (
                    <Button
                      variant="secondary"
                      disabled={busyId === studio.currentProjectId}
                      onClick={() => void handleSaveCurrent()}
                    >
                      Aggiorna
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (studio.currentProjectId) {
                        setShowNewForm(true);
                        setNewName(`${studio.project.title} (copia)`);
                      } else {
                        void handleSaveCurrent();
                      }
                    }}
                  >
                    <Plus size={15} />
                    {studio.currentProjectId ? "Salva come nuovo" : "Salva nel cloud"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {error}
            </p>
          )}

          {loading ? (
            <p className="py-6 text-center text-sm text-slate-400">Caricamento…</p>
          ) : (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                I miei progetti
              </p>
              {mine.length === 0 ? (
                <p className="mb-4 text-sm text-slate-400">Nessun progetto salvato ancora.</p>
              ) : (
                <ul className="mb-4 space-y-1.5">{mine.map(renderRow)}</ul>
              )}

              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Condivisi con me
              </p>
              {shared.length === 0 ? (
                <p className="text-sm text-slate-400">Nessun progetto condiviso.</p>
              ) : (
                <ul className="space-y-1.5">{shared.map(renderRow)}</ul>
              )}
            </>
          )}
        </div>
      </div>

      {shareTarget && (
        <ShareProjectModal
          projectId={shareTarget.id}
          projectName={shareTarget.name}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
