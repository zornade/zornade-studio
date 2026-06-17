import { describe, it, expect } from "vitest";
import { buildClassVisibilityFilter, classLabel } from "./class-filter";

const fmt = (n: number) => String(n);

describe("buildClassVisibilityFilter", () => {
  it("returns null when nothing is hidden", () => {
    expect(buildClassVisibilityFilter([10, 20], [])).toBeNull();
  });

  it("hides the lowest class with an open lower bound", () => {
    const f = buildClassVisibilityFilter([10, 20], [0]) as unknown[];
    // ["!", ["all", ["has","__value"], ["<", v, 10]]]
    expect(f[0]).toBe("!");
    const all = f[1] as unknown[];
    expect(all[0]).toBe("all");
    expect(all[1]).toEqual(["has", "__value"]);
    expect(all[2]).toEqual(["<", ["to-number", ["get", "__value"]], 10]);
  });

  it("hides the top class with an open upper bound", () => {
    const f = buildClassVisibilityFilter([10, 20], [2]) as unknown[];
    const all = f[1] as unknown[];
    expect(all[2]).toEqual([">=", ["to-number", ["get", "__value"]], 20]);
  });

  it("hides a middle class with a closed range", () => {
    const f = buildClassVisibilityFilter([10, 20], [1]) as unknown[];
    const all = f[1] as unknown[];
    const v = ["to-number", ["get", "__value"]];
    expect(all[2]).toEqual(["all", [">=", v, 10], ["<", v, 20]]);
  });

  it("combines multiple hidden classes under any", () => {
    const f = buildClassVisibilityFilter([10, 20], [0, 2]) as unknown[];
    const all = f[1] as unknown[];
    expect((all[2] as unknown[])[0]).toBe("any");
  });

  it("ignores out-of-range class indices", () => {
    expect(buildClassVisibilityFilter([10, 20], [5, -1])).toBeNull();
  });
});

describe("classLabel", () => {
  it("labels the first, middle and last classes", () => {
    expect(classLabel([10, 20], 0, fmt)).toBe("< 10");
    expect(classLabel([10, 20], 1, fmt)).toBe("10 – 20");
    expect(classLabel([10, 20], 2, fmt)).toBe("≥ 20");
  });
});
