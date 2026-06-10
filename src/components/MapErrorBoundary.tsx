import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional custom message shown in the fallback. */
  message?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render/runtime errors from the map subtree (e.g. WebGL unavailable)
 * and shows a graceful fallback instead of crashing the whole app.
 */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep a console trace for debugging; no telemetry here.
    console.error("Map render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-slate-50 p-6">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-600">
              <AlertTriangle size={22} />
            </div>
            <h2 className="font-display text-base font-semibold text-slate-800">
              Mappa non disponibile
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {this.props.message ??
                "Impossibile inizializzare la mappa. Verifica che il browser abbia l'accelerazione grafica (WebGL) attiva, poi ricarica la pagina."}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
