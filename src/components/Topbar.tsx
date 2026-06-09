import { Eye, Share2 } from "lucide-react";
import { useStudio } from "../studio/StudioContext";
import { Button } from "./primitives";

export function Topbar() {
  const { project, updateProject, setStep } = useStudio();

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
      </div>
    </header>
  );
}
