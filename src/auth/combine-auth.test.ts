import { describe, expect, it } from "vitest";
import { combineAuthState, type AuthBranchState } from "./combine-auth";

function branch(
  isAuthed: boolean,
  configured: boolean,
  loading = false,
): AuthBranchState {
  return { isAuthed, configured, loading };
}

describe("combineAuthState - only one method configured (unchanged OR behaviour)", () => {
  it("only legacy configured, legacy authed -> authed", () => {
    expect(
      combineAuthState(branch(true, true), branch(false, false)),
    ).toEqual({ isAuthed: true, loading: false });
  });

  it("only legacy configured, legacy not authed -> not authed", () => {
    expect(
      combineAuthState(branch(false, true), branch(false, false)),
    ).toEqual({ isAuthed: false, loading: false });
  });

  it("only supabase configured, supabase authed -> authed", () => {
    expect(
      combineAuthState(branch(false, false), branch(true, true)),
    ).toEqual({ isAuthed: true, loading: false });
  });

  it("only supabase configured, supabase not authed -> not authed", () => {
    expect(
      combineAuthState(branch(false, false), branch(false, true)),
    ).toEqual({ isAuthed: false, loading: false });
  });

  it("neither configured -> not authed", () => {
    expect(
      combineAuthState(branch(false, false), branch(false, false)),
    ).toEqual({ isAuthed: false, loading: false });
  });
});

describe("combineAuthState - both methods configured (sequential: both required)", () => {
  it("neither step done -> not authed", () => {
    expect(
      combineAuthState(branch(false, true), branch(false, true)),
    ).toEqual({ isAuthed: false, loading: false });
  });

  it("only legacy step done (step 1 of 2) -> still not authed", () => {
    expect(
      combineAuthState(branch(true, true), branch(false, true)),
    ).toEqual({ isAuthed: false, loading: false });
  });

  it("only supabase step done, legacy not done -> still not authed (legacy must come first)", () => {
    expect(
      combineAuthState(branch(false, true), branch(true, true)),
    ).toEqual({ isAuthed: false, loading: false });
  });

  it("both steps done -> authed", () => {
    expect(
      combineAuthState(branch(true, true), branch(true, true)),
    ).toEqual({ isAuthed: true, loading: false });
  });
});

describe("combineAuthState - loading", () => {
  it("loading is the OR of both branches regardless of configured/authed state", () => {
    expect(
      combineAuthState(branch(true, true, true), branch(true, true, false)),
    ).toEqual({ isAuthed: true, loading: true });
  });

  it("both finished loading, neither authed -> not authed, not loading", () => {
    expect(
      combineAuthState(branch(false, true), branch(false, true)),
    ).toEqual({ isAuthed: false, loading: false });
  });
});
