/**
 * Scrollytelling story model (O4.1) — pure, tested.
 *
 * A *story* is an ordered list of **steps** layered over a published map. Each
 * step carries narrative text (title + body) and a **camera** (centre, zoom,
 * pitch, bearing). Scrolling a step into view flies the map to that camera.
 *
 * This module is the dependency-free data model + sanitiser: the editor builds
 * steps by capturing the live map camera; the published embed replays them with
 * Scrollama. `sanitizeStorySteps` validates untrusted input (a hand-edited
 * spec) so the embed never trusts arbitrary numbers/HTML.
 */

export interface StoryCamera {
  /** [lng, lat] map centre. */
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface StoryStep {
  id: string;
  title: string;
  body: string;
  camera: StoryCamera;
}

/** Generate a short unique step id. */
export function newStoryStepId(): string {
  return `s_${Math.random().toString(36).slice(2, 9)}`;
}

/** Build a story step from a captured camera (+ optional text). */
export function makeStoryStep(
  id: string,
  camera: StoryCamera,
  title = "",
  body = "",
): StoryStep {
  return { id, title, body, camera };
}

/** Clamp a number into [min, max], falling back to `fallback` when not finite. */
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Validate/normalise a single untrusted camera. Returns null when unusable. */
export function sanitizeCamera(value: unknown): StoryCamera | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const c = v.center;
  if (!Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return {
    center: [lng, lat],
    zoom: clampNum(v.zoom, 0, 24, 5),
    pitch: clampNum(v.pitch, 0, 85, 0),
    bearing: clampNum(v.bearing, -360, 360, 0),
  };
}

/**
 * Validate untrusted story steps (e.g. from a published spec). Drops entries
 * with an invalid camera; coerces title/body to strings (escaping happens at
 * render time). Returns a clean array, possibly empty.
 */
export function sanitizeStorySteps(value: unknown): StoryStep[] {
  if (!Array.isArray(value)) return [];
  const out: StoryStep[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const camera = sanitizeCamera(r.camera);
    if (!camera) continue;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : newStoryStepId(),
      title: typeof r.title === "string" ? r.title : "",
      body: typeof r.body === "string" ? r.body : "",
      camera,
    });
  }
  return out;
}

/** Round camera numbers for a compact, stable spec (no jitter in the hash). */
export function roundCamera(c: StoryCamera): StoryCamera {
  return {
    center: [Number(c.center[0].toFixed(5)), Number(c.center[1].toFixed(5))],
    zoom: Number(c.zoom.toFixed(2)),
    pitch: Number(c.pitch.toFixed(1)),
    bearing: Number(c.bearing.toFixed(1)),
  };
}
