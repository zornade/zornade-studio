/**
 * GET /api/session
 *
 * Returns { authed: boolean, user?: string } based on the signed session
 * cookie. Used by the client on load to decide whether to show the app or the
 * login screen. Never trusts client state - the signature is verified here.
 */

import { readCookie, verifyToken } from "./_session.mts";

export default async (req: Request): Promise<Response> => {
  const secret = process.env.STUDIO_SESSION_SECRET;
  if (!secret) {
    return json({ authed: false, error: "not-configured" }, 200);
  }

  const token = readCookie(req.headers.get("cookie"));
  const payload = token ? verifyToken(token, secret) : null;
  if (!payload) return json({ authed: false }, 200);

  return json({ authed: true, user: payload.sub }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const config = { path: "/api/session" };
