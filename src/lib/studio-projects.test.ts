import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudioState } from "../studio/types";

vi.mock("./supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "./supabase";
import {
  listMyProjects,
  listSharedWithMe,
  getProject,
  createProject,
  saveProjectState,
  renameProject,
  duplicateProject,
  softDeleteProject,
} from "./studio-projects";

/** A chainable fake mimicking the subset of the supabase-js query builder we use. */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "in", "insert", "update"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  // Makes `await client.from(...).select(...).eq(...)` resolve without `.single()`.
  builder.then = (
    resolve: (v: typeof result) => void,
    reject?: (e: unknown) => void,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

/** Builds a fake client whose `.from(table)` returns a per-table builder. */
function makeClient(byTable: Record<string, { data: unknown; error: unknown }>) {
  const from = vi.fn((table: string) => makeBuilder(byTable[table]));
  return { from } as unknown as SupabaseClient;
}

function sampleState(): StudioState {
  return {
    step: "design",
    project: { title: "Mappa", subtitle: "", source: "ISTAT" },
    dataSource: "upload",
    vizType: "choropleth",
    preset: "zornade",
    brand: {} as StudioState["brand"],
    design: {} as StudioState["design"],
    data: null,
    annotations: [],
    storySteps: [],
  };
}

const mockedGetClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  mockedGetClient.mockReset();
});

describe("listMyProjects", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await listMyProjects("u1");
    expect(res.error).toMatch(/non configurato/);
  });

  it("maps rows with role 'owner'", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: {
          data: [
            { id: "p1", owner_id: "u1", name: "Mappa A", updated_at: "2026-07-01" },
          ],
          error: null,
        },
      }),
    );
    const res = await listMyProjects("u1");
    expect(res.error).toBeNull();
    expect(res.data).toEqual([
      { id: "p1", ownerId: "u1", name: "Mappa A", updatedAt: "2026-07-01", role: "owner" },
    ]);
  });

  it("propagates a database error", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({ studio_projects: { data: null, error: { message: "boom" } } }),
    );
    const res = await listMyProjects("u1");
    expect(res.data).toBeNull();
    expect(res.error).toMatch(/boom/);
  });
});

describe("listSharedWithMe", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await listSharedWithMe("u2");
    expect(res.error).toMatch(/non configurato/);
  });

  it("returns an empty list when there are no collaborator grants", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_project_collaborators: { data: [], error: null },
      }),
    );
    const res = await listSharedWithMe("u2");
    expect(res.error).toBeNull();
    expect(res.data).toEqual([]);
  });

  it("joins the caller's role from the collaborator grant", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_project_collaborators: {
          data: [{ project_id: "p1", role: "editor" }],
          error: null,
        },
        studio_projects: {
          data: [{ id: "p1", owner_id: "u1", name: "Mappa condivisa", updated_at: "2026-07-02" }],
          error: null,
        },
      }),
    );
    const res = await listSharedWithMe("u2");
    expect(res.error).toBeNull();
    expect(res.data).toEqual([
      { id: "p1", ownerId: "u1", name: "Mappa condivisa", updatedAt: "2026-07-02", role: "editor" },
    ]);
  });

  it("propagates an error from the collaborators query", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_project_collaborators: { data: null, error: { message: "no grants" } },
      }),
    );
    const res = await listSharedWithMe("u2");
    expect(res.error).toMatch(/no grants/);
  });

  it("propagates an error from the projects query", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_project_collaborators: {
          data: [{ project_id: "p1", role: "viewer" }],
          error: null,
        },
        studio_projects: { data: null, error: { message: "denied" } },
      }),
    );
    const res = await listSharedWithMe("u2");
    expect(res.error).toMatch(/denied/);
  });
});

describe("getProject", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await getProject("p1", "u1");
    expect(res.error).toMatch(/non configurato/);
  });

  it("returns role 'owner' when owner_id matches the caller", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: {
          data: {
            id: "p1",
            owner_id: "u1",
            name: "Mappa",
            updated_at: "2026-07-01",
            state: sampleState(),
            schema_version: 1,
          },
          error: null,
        },
      }),
    );
    const res = await getProject("p1", "u1");
    expect(res.error).toBeNull();
    expect(res.data?.role).toBe("owner");
    expect(res.data?.state.project.title).toBe("Mappa");
  });

  it("returns role 'editor' when owner_id differs from the caller", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: {
          data: {
            id: "p1",
            owner_id: "u1",
            name: "Mappa",
            updated_at: "2026-07-01",
            state: sampleState(),
            schema_version: 1,
          },
          error: null,
        },
      }),
    );
    const res = await getProject("p1", "u2");
    expect(res.data?.role).toBe("editor");
  });

  it("rejects an unsupported schema_version", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: {
          data: {
            id: "p1",
            owner_id: "u1",
            name: "Mappa",
            updated_at: "2026-07-01",
            state: sampleState(),
            schema_version: 99,
          },
          error: null,
        },
      }),
    );
    const res = await getProject("p1", "u1");
    expect(res.data).toBeNull();
    expect(res.error).toMatch(/non supportata/);
  });

  it("propagates a not-found/RLS-denied error", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: { data: null, error: { message: "No rows found" } },
      }),
    );
    const res = await getProject("missing", "u1");
    expect(res.error).toMatch(/No rows found/);
  });
});

describe("createProject", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await createProject({ userId: "u1", name: "X", state: sampleState() });
    expect(res.error).toMatch(/non configurato/);
  });

  it("rejects an empty/whitespace name without hitting the network", async () => {
    const client = makeClient({});
    mockedGetClient.mockReturnValue(client);
    const res = await createProject({ userId: "u1", name: "   ", state: sampleState() });
    expect(res.error).toMatch(/non può essere vuoto/);
    expect((client.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("creates and returns the full record with role 'owner'", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: {
          data: {
            id: "new-id",
            owner_id: "u1",
            name: "Nuova mappa",
            updated_at: "2026-07-07",
            state: sampleState(),
            schema_version: 1,
          },
          error: null,
        },
      }),
    );
    const res = await createProject({ userId: "u1", name: "Nuova mappa", state: sampleState() });
    expect(res.error).toBeNull();
    expect(res.data?.id).toBe("new-id");
    expect(res.data?.role).toBe("owner");
  });
});

describe("saveProjectState", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await saveProjectState({ id: "p1", state: sampleState() });
    expect(res.error).toMatch(/non configurato/);
  });

  it("saves and returns the updated summary", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: {
          data: { id: "p1", owner_id: "u1", name: "Mappa", updated_at: "2026-07-07" },
          error: null,
        },
      }),
    );
    const res = await saveProjectState({ id: "p1", state: sampleState() });
    expect(res.error).toBeNull();
    expect(res.data?.updatedAt).toBe("2026-07-07");
  });

  it("propagates a database error (e.g. an editor is blocked from a disallowed change)", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: { data: null, error: { message: "permission denied" } },
      }),
    );
    const res = await saveProjectState({ id: "p1", state: sampleState() });
    expect(res.error).toMatch(/permission denied/);
  });
});

describe("renameProject", () => {
  it("rejects an empty name without hitting the network", async () => {
    const client = makeClient({});
    mockedGetClient.mockReturnValue(client);
    const res = await renameProject({ id: "p1", name: "  " });
    expect(res.error).toMatch(/non può essere vuoto/);
    expect((client.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("renames and returns the updated summary", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: {
          data: { id: "p1", owner_id: "u1", name: "Rinominata", updated_at: "2026-07-07" },
          error: null,
        },
      }),
    );
    const res = await renameProject({ id: "p1", name: "Rinominata" });
    expect(res.error).toBeNull();
    expect(res.data?.name).toBe("Rinominata");
  });
});

describe("duplicateProject", () => {
  it("propagates a getProject error without calling createProject", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: { data: null, error: { message: "not found" } },
      }),
    );
    const res = await duplicateProject({ id: "missing", userId: "u1" });
    expect(res.error).toMatch(/not found/);
  });

  it("creates a copy named '<original> (copia)' with the same state", async () => {
    const original = {
      id: "p1",
      owner_id: "u1",
      name: "Originale",
      updated_at: "2026-07-01",
      state: sampleState(),
      schema_version: 1,
    };
    let insertedPayload: Record<string, unknown> | null = null;
    const from = vi.fn((table: string) => {
      if (table !== "studio_projects") throw new Error(`unexpected table ${table}`);
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        is: vi.fn(() => builder),
        insert: vi.fn((payload: Record<string, unknown>) => {
          insertedPayload = payload;
          return builder;
        }),
        single: vi.fn(() =>
          Promise.resolve(
            insertedPayload
              ? {
                  data: {
                    id: "copy-id",
                    owner_id: "u1",
                    name: insertedPayload.name,
                    updated_at: "2026-07-07",
                    state: insertedPayload.state,
                    schema_version: insertedPayload.schema_version,
                  },
                  error: null,
                }
              : { data: original, error: null },
          ),
        ),
      };
      return builder;
    });
    mockedGetClient.mockReturnValue({ from } as unknown as SupabaseClient);

    const res = await duplicateProject({ id: "p1", userId: "u1" });
    expect(res.error).toBeNull();
    expect(res.data?.name).toBe("Originale (copia)");
    expect(res.data?.id).toBe("copy-id");
    expect(insertedPayload).not.toBeNull();
    expect((insertedPayload as unknown as { owner_id: string }).owner_id).toBe("u1");
  });
});

describe("softDeleteProject", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await softDeleteProject("p1");
    expect(res.error).toMatch(/non configurato/);
  });

  it("succeeds with a null payload", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({ studio_projects: { data: null, error: null } }),
    );
    const res = await softDeleteProject("p1");
    expect(res.error).toBeNull();
    expect(res.data).toBeNull();
  });

  it("propagates a database error (e.g. a non-owner blocked by the guard trigger)", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        studio_projects: {
          data: null,
          error: { message: "Only the project owner can delete/restore this project" },
        },
      }),
    );
    const res = await softDeleteProject("p1");
    expect(res.error).toMatch(/owner can delete/);
  });
});
