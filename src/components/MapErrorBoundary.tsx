import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { it } from "../i18n/dictionaries/it";
import { en } from "../i18n/dictionaries/en";

const STORAGE_KEY = "zornade-studio-lang";

/**
 * Class components can't use hooks (useI18n), and this boundary must keep
 * working even if something above it in the tree threw before the
 * LanguageProvider could render - so it reads the persisted language
 * preference directly instead of relying on context.
 */
function currentDict() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? en : it;
  } catch {
    return it;
  }
}

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
      const dict = currentDict();
      return (
        <div className="flex h-full w-full items-center justify-center bg-slate-50 p-6">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-600">
              <AlertTriangle size={22} />
            </div>
            <h2 className="font-display text-base font-semibold text-slate-800">
              {dict.mapErrorBoundary.title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {this.props.message ?? dict.mapErrorBoundary.body}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
