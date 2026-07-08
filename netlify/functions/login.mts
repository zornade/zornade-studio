/**
 * POST /api/login  { user, password }
 *
 * Validates credentials server-side against environment variables and, on
 * success, sets an HttpOnly session cookie. The password is compared by its
 * SHA-256 hash; the plaintext never appears in code or env.
 *
 * Required environment variables (set in Netlify → Site settings → Environment):
 *   STUDIO_USER            the username
 *   STUDIO_PASS_SHA256     hex SHA-256 of the password
 *   STUDIO_SESSION_SECRET  a long random string used to sign session cookies
 */

import { createHash } from "node:crypto";
import { createToken, sessionCookie, safeEqual } from "./_session.mts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = process.env.STUDIO_USER;
  const passHash = process.env.STUDIO_PASS_SHA256?.toLowerCase();
  const secret = process.env.STUDIO_SESSION_SECRET;
  if (!user || !passHash || !secret) {
    const missing = [
      !user && "STUDIO_USER",
      !passHash && "STUDIO_PASS_SHA256",
      !secret && "STUDIO_SESSION_SECRET",
    ].filter(Boolean);
    return json(
      {
        error: `Auth not configured on the server. Missing variables: ${missing.join(", ")}.`,
      },
      500,
    );
  }

  let body: { user?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const userOk = safeEqual((body.user ?? "").trim(), user.trim());
  const incomingHash = createHash("sha256")
    .update(body.password ?? "")
    .digest("hex");
  const passOk = safeEqual(incomingHash, passHash);

  if (!userOk || !passOk) {
    return json({ error: "Incorrect username or password." }, 401);
  }

  const token = createToken(user.trim(), secret);
  return new Response(JSON.stringify({ ok: true, user: user.trim() }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": sessionCookie(token),
      "cache-control": "no-store",
    },
  });
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const config = { path: "/api/login" };
