import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "./supabase";
import {
  listCollaborators,
  inviteCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
} from "./studio-collaborators";

/** A chainable fake mimicking the subset of the supabase-js query builder we use. */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "in", "insert", "update", "delete"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (
    resolve: (v: typeof result) => void,
    reject?: (e: unknown) => void,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeClient(params: {
  byTable?: Record<string, { data: unknown; error: unknown }>;
  rpcResult?: { data: unknown; error: unknown };
  invokeResult?: { data: unknown; error: unknown };
}) {
  const from = vi.fn((table: string) => makeBuilder(params.byTable?.[table] ?? { data: null, error: null }));
  const rpc = vi.fn(() => Promise.resolve(params.rpcResult ?? { data: [], error: null }));
  const invoke = vi.fn(() => Promise.resolve(params.invokeResult ?? { data: null, error: null }));
  return { from, rpc, functions: { invoke } } as unknown as SupabaseClient;
}

const mockedGetClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  mockedGetClient.mockReset();
});

describe("listCollaborators", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await listCollaborators("p1");
    expect(res.error).toMatch(/not configured/);
  });

  it("maps rows and joins usernames for resolved user_ids", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        byTable: {
          studio_project_collaborators: {
            data: [
              {
                id: "c1",
                project_id: "p1",
                user_id: "u2",
                invited_email: null,
                role: "editor",
                created_at: "2026-07-01",
                accepted_at: "2026-07-02",
              },
              {
                id: "c2",
                project_id: "p1",
                user_id: null,
                invited_email: "pending@example.invalid",
                role: "viewer",
                created_at: "2026-07-03",
                accepted_at: null,
              },
            ],
            error: null,
          },
          profiles: { data: [{ id: "u2", username: "mario" }], error: null },
        },
      }),
    );
    const res = await listCollaborators("p1");
    expect(res.error).toBeNull();
    expect(res.data).toEqual([
      {
        id: "c1",
        projectId: "p1",
        userId: "u2",
        invitedEmail: null,
        role: "editor",
        createdAt: "2026-07-01",
        acceptedAt: "2026-07-02",
        username: "mario",
      },
      {
        id: "c2",
        projectId: "p1",
        userId: null,
        invitedEmail: "pending@example.invalid",
        role: "viewer",
        createdAt: "2026-07-03",
        acceptedAt: null,
        username: null,
      },
    ]);
  });

  it("propagates a database error", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        byTable: {
          studio_project_collaborators: { data: null, error: { message: "denied" } },
        },
      }),
    );
    const res = await listCollaborators("p1");
    expect(res.error).toMatch(/denied/);
  });
});

describe("inviteCollaborator", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await inviteCollaborator({
      projectId: "p1",
      email: "a@example.invalid",
      role: "viewer",
      invitedBy: "u1",
    });
    expect(res.error).toMatch(/not configured/);
  });

  it("rejects an empty email without hitting the network", async () => {
    const client = makeClient({});
    mockedGetClient.mockReturnValue(client);
    const res = await inviteCollaborator({
      projectId: "p1",
      email: "  ",
      role: "viewer",
      invitedBy: "u1",
    });
    expect(res.error).toMatch(/Enter an email/);
    expect((client.rpc as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("rejects role 'owner'", async () => {
    mockedGetClient.mockReturnValue(makeClient({}));
    const res = await inviteCollaborator({
      projectId: "p1",
      email: "a@example.invalid",
      role: "owner" as never,
      invitedBy: "u1",
    });
    expect(res.error).toMatch(/owner/);
  });

  it("resolves an existing candidate (sets user_id, not invited_email)", async () => {
    let insertedPayload: Record<string, unknown> | null = null;
    const client = makeClient({
      rpcResult: { data: [{ user_id: "u2", username: "mario" }], error: null },
      invokeResult: { data: { ok: true }, error: null },
    });
    (client.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        insert: vi.fn((payload: Record<string, unknown>) => {
          insertedPayload = payload;
          return builder;
        }),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "c1",
              project_id: "p1",
              user_id: "u2",
              invited_email: null,
              role: "viewer",
              created_at: "2026-07-01",
              accepted_at: null,
            },
            error: null,
          }),
        ),
      };
      if (table !== "studio_project_collaborators") throw new Error(`unexpected table ${table}`);
      return builder;
    });
    mockedGetClient.mockReturnValue(client);

    const res = await inviteCollaborator({
      projectId: "p1",
      email: "mario@example.invalid",
      role: "viewer",
      invitedBy: "u1",
    });
    expect(res.error).toBeNull();
    expect(res.data?.username).toBe("mario");
    expect((insertedPayload as unknown as { user_id: string; invited_email: string | null }).user_id).toBe("u2");
    expect((insertedPayload as unknown as { invited_email: string | null }).invited_email).toBeNull();
  });

  it("falls back to a pending invited_email when no candidate is found", async () => {
    let insertedPayload: Record<string, unknown> | null = null;
    const client = makeClient({
      rpcResult: { data: [], error: null },
      invokeResult: { data: { ok: true }, error: null },
    });
    (client.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        insert: vi.fn((payload: Record<string, unknown>) => {
          insertedPayload = payload;
          return builder;
        }),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "c1",
              project_id: "p1",
              user_id: null,
              invited_email: "nobody@example.invalid",
              role: "editor",
              created_at: "2026-07-01",
              accepted_at: null,
            },
            error: null,
          }),
        ),
      };
      if (table !== "studio_project_collaborators") throw new Error(`unexpected table ${table}`);
      return builder;
    });
    mockedGetClient.mockReturnValue(client);

    const res = await inviteCollaborator({
      projectId: "p1",
      email: "nobody@example.invalid",
      role: "editor",
      invitedBy: "u1",
    });
    expect(res.error).toBeNull();
    expect((insertedPayload as unknown as { user_id: string | null }).user_id).toBeNull();
    expect((insertedPayload as unknown as { invited_email: string }).invited_email).toBe(
      "nobody@example.invalid",
    );
  });

  it("still succeeds even when the notification email fails to send", async () => {
    const client = makeClient({
      rpcResult: { data: [], error: null },
      invokeResult: { data: null, error: { message: "RESEND_API_KEY non configurata" } },
    });
    (client.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        insert: vi.fn(() => builder),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: "c1",
              project_id: "p1",
              user_id: null,
              invited_email: "x@example.invalid",
              role: "viewer",
              created_at: "2026-07-01",
              accepted_at: null,
            },
            error: null,
          }),
        ),
      };
      if (table !== "studio_project_collaborators") throw new Error(`unexpected table ${table}`);
      return builder;
    });
    mockedGetClient.mockReturnValue(client);

    const res = await inviteCollaborator({
      projectId: "p1",
      email: "x@example.invalid",
      role: "viewer",
      invitedBy: "u1",
    });
    expect(res.error).toBeNull();
    expect(res.data?.id).toBe("c1");
  });

  it("propagates an error inserting the collaborator row", async () => {
    const client = makeClient({
      rpcResult: { data: [], error: null },
      byTable: {
        studio_project_collaborators: { data: null, error: { message: "duplicate" } },
      },
    });
    mockedGetClient.mockReturnValue(client);
    const res = await inviteCollaborator({
      projectId: "p1",
      email: "x@example.invalid",
      role: "viewer",
      invitedBy: "u1",
    });
    expect(res.error).toMatch(/duplicate/);
  });
});

describe("updateCollaboratorRole", () => {
  it("rejects role 'owner'", async () => {
    mockedGetClient.mockReturnValue(makeClient({}));
    const res = await updateCollaboratorRole({ id: "c1", role: "owner" as never });
    expect(res.error).toMatch(/owner/);
  });

  it("updates and returns the record", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        byTable: {
          studio_project_collaborators: {
            data: {
              id: "c1",
              project_id: "p1",
              user_id: "u2",
              invited_email: null,
              role: "editor",
              created_at: "2026-07-01",
              accepted_at: "2026-07-02",
            },
            error: null,
          },
        },
      }),
    );
    const res = await updateCollaboratorRole({ id: "c1", role: "editor" });
    expect(res.error).toBeNull();
    expect(res.data?.role).toBe("editor");
  });
});

describe("removeCollaborator", () => {
  it("returns an error when Supabase isn't configured", async () => {
    mockedGetClient.mockReturnValue(null);
    const res = await removeCollaborator("c1");
    expect(res.error).toMatch(/not configured/);
  });

  it("succeeds with a null payload", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({ byTable: { studio_project_collaborators: { data: null, error: null } } }),
    );
    const res = await removeCollaborator("c1");
    expect(res.error).toBeNull();
    expect(res.data).toBeNull();
  });

  it("propagates a database error", async () => {
    mockedGetClient.mockReturnValue(
      makeClient({
        byTable: { studio_project_collaborators: { data: null, error: { message: "denied" } } },
      }),
    );
    const res = await removeCollaborator("c1");
    expect(res.error).toMatch(/denied/);
  });
});
