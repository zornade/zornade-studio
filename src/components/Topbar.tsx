import { Eye, Share2, LogOut, Bug, Mail, X } from "lucide-react";
import { useState } from "react";
import { useStudio } from "../studio/StudioContext";
import { useAuth } from "../auth/AuthContext";
import { Button } from "./primitives";

const REPO = "zornade/zornade-studio";
const SUPPORT_EMAIL = "studio@zornade.com";

function buildContext(projectTitle: string, step: string): string {
  return [
    `Step: ${step}`,
    `Progetto: ${projectTitle}`,
    `URL: ${window.location.href}`,
    `Browser: ${navigator.userAgent}`,
  ].join("\n");
}

function buildIssueUrl(projectTitle: string, step: string): string {
  const body = [
    "## Descrizione del problema",
    "",
    "<!-- Descrivi brevemente cosa è successo e cosa ti aspettavi -->",
    "",
    "## Contesto",
    "```",
    buildContext(projectTitle, step),
    "```",
  ].join("\n");

  const params = new URLSearchParams({
    template: "bug_report.md",
    labels: "bug,studio",
    title: `[Studio] Bug in step "${step}"`,
    body,
  });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

function buildMailtoUrl(projectTitle: string, step: string): string {
  const subject = encodeURIComponent(`[Studio] Bug in step "${step}"`);
  const body = encodeURIComponent(
    `Descrizione del problema:\n\n\n\nContesto:\n${buildContext(projectTitle, step)}`
  );
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

function BugReportModal({
  projectTitle,
  step,
  onClose,
}: {
  projectTitle: string;
  step: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Segnala un problema
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Scegli come inviarci la segnalazione.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Chiudi"
          >
            <X size={16} />
          </button>
        </div>

        {/* Context preview */}
        <pre className="mb-5 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
          {buildContext(projectTitle, step)}
        </pre>

        <div className="flex flex-col gap-2">
          <a
            href={buildIssueUrl(projectTitle, step)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12" />
            </svg>
            Apri issue su GitHub
          </a>
          <a
            href={buildMailtoUrl(projectTitle, step)}
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <Mail size={16} />
            Invia via email
          </a>
        </div>
      </div>
    </div>
  );
}

export function Topbar() {
  const { project, updateProject, setStep, step } = useStudio();
  const { logout } = useAuth();
  const [showBugModal, setShowBugModal] = useState(false);

  return (
    <>
      <header className="flex h-14 flex-shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
        {/* Wordmark */}
        <div className="flex items-center gap-2">
          <img
            src="/zornade-icon.svg"
            alt="Zornade"
            className="h-7 w-7 rounded-lg"
          />
          <span className="font-display text-base font-semibold tracking-tight text-slate-900">
            Zornade <span className="text-zornade">Studio</span>
          </span>
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* Editable project title */}
        <input
          value={project.title}
          onChange={(e) => updateProject({ title: e.target.value })}
          aria-label="Titolo del progetto"
          className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-200 focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
        />

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setStep("design")}>
            <Eye size={16} />
            Anteprima
          </Button>
          <Button variant="primary" onClick={() => setStep("publish")}>
            <Share2 size={16} />
            Pubblica
          </Button>
          <div className="h-6 w-px bg-slate-200" />
          <Button
            variant="ghost"
            title="Segnala un problema"
            onClick={() => setShowBugModal(true)}
          >
            <Bug size={16} />
          </Button>
          <Button variant="ghost" onClick={logout} title="Esci">
            <LogOut size={16} />
          </Button>
        </div>
      </header>

      {showBugModal && (
        <BugReportModal
          projectTitle={project.title}
          step={step}
          onClose={() => setShowBugModal(false)}
        />
      )}
    </>
  );
}
