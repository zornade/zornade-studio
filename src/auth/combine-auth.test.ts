import { describe, expect, it } from "vitest";
import { combineAuthState, type AuthBranchState } from "./combine-auth";

const notAuthed: AuthBranchState = { isAuthed: false, loading: false };
const authed: AuthBranchState = { isAuthed: true, loading: false };
const loadingNotAuthed: AuthBranchState = { isAuthed: false, loading: true };
const loadingAuthed: AuthBranchState = { isAuthed: true, loading: true };

describe("combineAuthState", () => {
  it("neither authed, neither loading -> not authed", () => {
    expect(combineAuthState(notAuthed, notAuthed)).toEqual({
      isAuthed: false,
      loading: false,
    });
  });

  it("legacy authed alone -> authed", () => {
    expect(combineAuthState(authed, notAuthed)).toEqual({
      isAuthed: true,
      loading: false,
    });
  });

  it("supabase authed alone -> authed", () => {
    expect(combineAuthState(notAuthed, authed)).toEqual({
      isAuthed: true,
      loading: false,
    });
  });

  it("both authed -> authed (no conflict)", () => {
    expect(combineAuthState(authed, authed)).toEqual({
      isAuthed: true,
      loading: false,
    });
  });

  it("legacy still loading, supabase already authed -> loading true, isAuthed already true (OR is not gated by loading)", () => {
    expect(combineAuthState(loadingNotAuthed, authed)).toEqual({
      isAuthed: true,
      loading: true,
    });
  });

  it("supabase still loading, legacy already authed -> loading true, isAuthed already true (OR is not gated by loading)", () => {
    expect(combineAuthState(authed, loadingNotAuthed)).toEqual({
      isAuthed: true,
      loading: true,
    });
  });

  it("both loading and both already authed -> reports isAuthed true (OR is not gated by loading), but loading stays true so callers should ignore isAuthed until loading resolves", () => {
    expect(combineAuthState(loadingAuthed, loadingAuthed)).toEqual({
      isAuthed: true,
      loading: true,
    });
  });

  it("both finished, neither authed -> not authed, not loading", () => {
    expect(combineAuthState(notAuthed, notAuthed)).toEqual({
      isAuthed: false,
      loading: false,
    });
  });
});
