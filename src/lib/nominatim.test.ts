import { describe, it, expect } from "vitest";
import { pickArea, geocodeArea } from "./nominatim";

describe("pickArea", () => {
  it("converts a relation boundary to an Overpass area id", () => {
    const area = pickArea([
      {
        osm_type: "relation",
        osm_id: 179296,
        display_name: "Friuli-Venezia Giulia, Italia",
        class: "boundary",
        type: "administrative",
      },
    ]);
    expect(area).not.toBeNull();
    expect(area!.areaId).toBe(3600179296);
    expect(area!.displayName).toContain("Friuli-Venezia Giulia");
  });

  it("converts a way boundary to an Overpass area id", () => {
    const area = pickArea([
      { osm_type: "way", osm_id: 1234, class: "boundary", type: "administrative" },
    ]);
    expect(area!.areaId).toBe(2400001234);
  });

  it("prefers an administrative boundary over an unrelated first result", () => {
    const area = pickArea([
      { osm_type: "node", osm_id: 999, class: "office", type: "research" },
      {
        osm_type: "relation",
        osm_id: 179296,
        class: "boundary",
        type: "administrative",
      },
    ]);
    // The node can't be an area; the relation boundary wins.
    expect(area!.areaId).toBe(3600179296);
  });

  it("skips nodes (which have no area)", () => {
    const area = pickArea([
      { osm_type: "node", osm_id: 6241742985, class: "office", type: "research" },
    ]);
    expect(area).toBeNull();
  });

  it("returns null for an empty result set", () => {
    expect(pickArea([])).toBeNull();
  });
});

describe("geocodeArea (network contract via injected fetch)", () => {
  it("returns null for an empty query without calling the network", async () => {
    const out = await geocodeArea("   ", "regione");
    expect(out).toBeNull();
  });
});
