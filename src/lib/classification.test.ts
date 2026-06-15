import { describe, it, expect } from "vitest";
import {
  quantileBreaks,
  equalBreaks,
  jenksBreaks,
  manualBreaks,
} from "./choropleth";

describe("equalBreaks", () => {
  it("splits the range into equal intervals", () => {
    const r = equalBreaks([0, 10], 2);
    expect(r.min).toBe(0);
    expect(r.max).toBe(10);
    expect(r.breaks).toEqual([5]);
  });
});

describe("quantileBreaks", () => {
  it("puts equal counts per class", () => {
    const r = quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8], 2);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]).toBeGreaterThan(4);
    expect(r.breaks[0]).toBeLessThan(5.5);
  });
});

describe("jenksBreaks", () => {
  it("finds the natural gap in a clustered distribution", () => {
    // Two clear clusters: 1..5 and 100..104. The natural break sits in the gap.
    const values = [1, 2, 3, 4, 5, 100, 101, 102, 103, 104];
    const r = jenksBreaks(values, 2);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]).toBeGreaterThan(5);
    expect(r.breaks[0]).toBeLessThanOrEqual(100);
  });

  it("separates three clusters into three classes", () => {
    const values = [1, 2, 3, 50, 51, 52, 200, 201, 202];
    const r = jenksBreaks(values, 3);
    expect(r.breaks).toHaveLength(2);
    expect(r.breaks[0]).toBeGreaterThan(3);
    expect(r.breaks[0]).toBeLessThanOrEqual(50);
    expect(r.breaks[1]).toBeGreaterThan(52);
    expect(r.breaks[1]).toBeLessThanOrEqual(200);
    expect(r.min).toBe(1);
    expect(r.max).toBe(202);
  });

  it("stays strictly ascending and handles large inputs (down-sampling)", () => {
    const values = Array.from({ length: 5000 }, (_, i) => i * 1.0);
    const r = jenksBreaks(values, 5);
    expect(r.breaks).toHaveLength(4);
    for (let i = 1; i < r.breaks.length; i++) {
      expect(r.breaks[i]).toBeGreaterThan(r.breaks[i - 1]);
    }
    expect(r.min).toBe(0);
    expect(r.max).toBe(4999);
  });

  it("does not crash on tiny inputs", () => {
    expect(jenksBreaks([5], 5).breaks).toEqual([]);
    expect(jenksBreaks([], 5).breaks).toEqual([]);
  });
});

describe("manualBreaks", () => {
  it("uses the supplied thresholds, sorted and deduped", () => {
    const r = manualBreaks([0, 100], [30, 10, 30, 20]);
    expect(r.breaks).toEqual([10, 20, 30]);
    expect(r.min).toBe(0);
    expect(r.max).toBe(100);
  });
  it("drops invalid entries and tolerates empty", () => {
    expect(manualBreaks([1, 2, 3], [NaN, Infinity]).breaks).toEqual([]);
    expect(manualBreaks([1, 2, 3], []).breaks).toEqual([]);
  });
});
