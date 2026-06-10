/**
 * POST /api/logout
 *
 * Clears the session cookie. Stateless: there is no server session to destroy,
 * so simply expiring the cookie is sufficient.
 */

import { clearCookie } from "./_session.mts";

export default async (): Promise<Response> => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": clearCookie(),
      "cache-control": "no-store",
    },
  });
};

export const config = { path: "/api/logout" };
