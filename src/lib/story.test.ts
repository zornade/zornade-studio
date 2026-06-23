import { describe, it, expect } from "vitest";
import {
  makeStoryStep,
  sanitizeCamera,
  sanitizeStorySteps,
  roundCamera,
  newStoryStepId,
} from "./story";

const cam = { center: [12.5, 42] as [number, number], zoom: 6, pitch: 0, bearing: 0 };

describe("makeStoryStep / newStoryStepId", () => {
  it("builds a step with text and camera", () => {
    const s = makeStoryStep("a", cam, "Titolo", "Corpo");
    expect(s).toEqual({ id: "a", title: "Titolo", body: "Corpo", camera: cam });
  });
  it("generates distinct ids", () => {
    expect(newStoryStepId()).not.toBe(newStoryStepId());
  });
});

describe("sanitizeCamera", () => {
  it("accepts a valid camera and clamps the ranges", () => {
    const c = sanitizeCamera({ center: [12.5, 42], zoom: 99, pitch: 200, bearing: 30 });
    expect(c).toEqual({ center: [12.5, 42], zoom: 24, pitch: 85, bearing: 30 });
  });
  it("rejects out-of-range or missing centre", () => {
    expect(sanitizeCamera({ center: [999, 0], zoom: 5 })).toBeNull();
    expect(sanitizeCamera({ zoom: 5 })).toBeNull();
    expect(sanitizeCamera(null)).toBeNull();
  });
  it("defaults zoom/pitch/bearing when absent", () => {
    const c = sanitizeCamera({ center: [0, 0] })!;
    expect(c.zoom).toBe(5);
    expect(c.pitch).toBe(0);
    expect(c.bearing).toBe(0);
  });
});

describe("sanitizeStorySteps", () => {
  it("keeps valid steps and drops invalid cameras", () => {
    const steps = sanitizeStorySteps([
      { id: "1", title: "A", body: "x", camera: cam },
      { id: "2", title: "B", body: "y", camera: { center: [999, 0] } }, // invalid
      "nope",
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe("1");
  });
  it("coerces missing text to empty strings and fills missing ids", () => {
    const steps = sanitizeStorySteps([{ camera: cam }]);
    expect(steps[0].title).toBe("");
    expect(steps[0].body).toBe("");
    expect(steps[0].id).toMatch(/^s_/);
  });
  it("returns [] for non-arrays", () => {
    expect(sanitizeStorySteps(null)).toEqual([]);
    expect(sanitizeStorySteps({})).toEqual([]);
  });
});

describe("roundCamera", () => {
  it("rounds for a stable spec", () => {
    const r = roundCamera({ center: [12.5000019, 42.0000098], zoom: 6.123456, pitch: 30.27, bearing: 10.55 });
    expect(r.center[0]).toBe(12.5);
    expect(r.zoom).toBe(6.12);
    expect(r.pitch).toBe(30.3);
  });
});
