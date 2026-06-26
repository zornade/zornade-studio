import { Eye, Share2, LogOut, Bug } from "lucide-react";
import { useStudio } from "../studio/StudioContext";
import { useAuth } from "../auth/AuthContext";
import { Button } from "./primitives";

const REPO = "zornade/zornade-studio";

function buildIssueUrl(projectTitle: string, step: string): string {
  const body = [
    "## Descrizione del problema",
    "",
    "<!-- Descrivi brevemente cosa è successo e cosa ti aspettavi -->",
    "",
    "## Contesto",
    `- **Pagina/step**: ${step}`,
    `- **Titolo progetto**: ${projectTitle}`,
    `- **URL**: ${window.location.href}`,
    `- **Browser**: ${navigator.userAgent}`,
  ].join("\n");

  const params = new URLSearchParams({
    template: "bug_report.md",
    labels: "bug,studio",
    title: `[Studio] Bug in step "${step}"`,
    body,
  });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

export function Topbar() {
  const { project, updateProject, setStep, step } = useStudio();
  const { logout } = useAuth();

  return (
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
          onClick={() => window.open(buildIssueUrl(project.title, step), "_blank", "noopener,noreferrer")}
        >
          <Bug size={16} />
        </Button>
        <Button variant="ghost" onClick={logout} title="Esci">
          <LogOut size={16} />
        </Button>
      </div>
    </header>
  );
}
