import { useEffect, useRef, useState } from "react";
import { Field } from "../primitives";
import { MARKER_SHAPES, markerSvgTemplate, MARKER_COLOR_TOKEN } from "../../lib/markers";
import { loadFaIcons, filterFaIcons, type FaIcon } from "../../lib/fa-icons";
import type { DesignSettings } from "../../studio/types";

interface Props {
  design: DesignSettings;
  updateDesign: (patch: Partial<DesignSettings>) => void;
}

/** Render a marker shape preview as an inline data-URI <img> in the brand colour. */
function shapePreview(shapeId: string, color: string, iconPath: string, iconW: number, iconH: number): string {
  const svg = markerSvgTemplate(shapeId, iconPath, iconW, iconH).split(MARKER_COLOR_TOKEN).join(color);
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/**
 * Marker style controls (locator/points): shape selector + FontAwesome icon
 * picker. The chosen icon's raw SVG path/dimensions are baked into the design
 * (`pointIconPath`/`pointIconW`/`pointIconH`) so rendering never imports
 * FontAwesome; the heavy icon set is dynamically imported only when the picker
 * opens.
 */
export function MarkerStyleControls({ design, updateDesign }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [icons, setIcons] = useState<FaIcon[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const loadStarted = useRef(false);

  useEffect(() => {
    if (!pickerOpen || loadStarted.current) return;
    loadStarted.current = true;
    setLoading(true);
    loadFaIcons()
      .then((list) => setIcons(list))
      .finally(() => setLoading(false));
  }, [pickerOpen]);

  const shape = design.pointShape || "circle";
  const color = design.pointColor || "#01646f";
  const filtered = icons ? filterFaIcons(icons, query).slice(0, 120) : [];

  const chooseIcon = (icon: FaIcon | null) => {
    if (icon) {
      updateDesign({
        pointIcon: icon.id,
        pointIconPath: icon.path,
        pointIconW: icon.width,
        pointIconH: icon.height,
      });
    } else {
      updateDesign({ pointIcon: "", pointIconPath: "", pointIconW: 0, pointIconH: 0 });
    }
    setPickerOpen(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label="Forma">
        <div className="grid grid-cols-8 gap-1.5">
          {MARKER_SHAPES.map((s) => {
            const active = shape === s.id;
            return (
              <button
                key={s.id}
                type="button"
                title={s.label}
                onClick={() => updateDesign({ pointShape: s.id })}
                className={`flex aspect-square items-center justify-center rounded border p-1 ${
                  active
                    ? "border-zornade ring-1 ring-zornade"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <img
                  src={shapePreview(
                    s.id,
                    color,
                    design.pointIconPath || "",
                    design.pointIconW || 0,
                    design.pointIconH || 0,
                  )}
                  alt={s.label}
                  className="h-full w-full object-contain"
                />
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Icona">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="flex flex-1 items-center gap-2 rounded border border-slate-200 px-2 py-1.5 text-sm hover:border-slate-300"
          >
            {design.pointIconPath ? (
              <svg viewBox={`0 0 ${design.pointIconW || 512} ${design.pointIconH || 512}`} className="h-4 w-4 fill-slate-700">
                <path d={design.pointIconPath} />
              </svg>
            ) : (
              <span className="text-slate-400">Nessuna icona</span>
            )}
            <span className="ml-auto text-slate-500">
              {design.pointIcon || (pickerOpen ? "chiudi" : "scegli")}
            </span>
          </button>
          {design.pointIconPath && (
            <button
              type="button"
              onClick={() => chooseIcon(null)}
              className="rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:border-slate-300"
            >
              Rimuovi
            </button>
          )}
        </div>
      </Field>

      {pickerOpen && (
        <div className="rounded border border-slate-200 p-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca icona (es. anchor, plane, hospital)…"
            className="mb-2 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
          {loading && <p className="py-4 text-center text-xs text-slate-400">Caricamento icone…</p>}
          {!loading && icons && (
            <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
              {filtered.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  title={icon.label}
                  onClick={() => chooseIcon(icon)}
                  className={`flex aspect-square items-center justify-center rounded border p-1.5 hover:border-slate-300 ${
                    design.pointIcon === icon.id ? "border-zornade ring-1 ring-zornade" : "border-slate-200"
                  }`}
                >
                  <svg viewBox={`0 0 ${icon.width} ${icon.height}`} className="h-full w-full fill-slate-700">
                    <path d={icon.path} />
                  </svg>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="col-span-8 py-4 text-center text-xs text-slate-400">
                  Nessuna icona trovata.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
