/**
 * Shared session-token helpers for the Zornade Studio auth functions.
 *
 * The token is a signed, expiring stateless cookie value:
 *   base64url(payloadJson) + "." + base64url(hmacSHA256(payloadJson, secret))
 *
 * No database is needed: the HMAC signature (keyed by STUDIO_SESSION_SECRET,
 * which never leaves the server) guarantees the cookie was issued by us and was
 * not tampered with. The cookie is set HttpOnly so client JS cannot read it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "studio_session";
/** Session lifetime in seconds (12 hours). */
const TTL_SECONDS = 12 * 60 * 60;

interface Payload {
  /** Subject (username). */
  sub: string;
  /** Expiry (unix seconds). */
  exp: number;
}

function b64urlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadB64: string, secret: string): string {
  return b64urlEncode(createHmac("sha256", secret).update(payloadB64).digest());
}

/** Create a signed session token for the given user. */
export function createToken(sub: string, secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payloadB64 = b64urlEncode(JSON.stringify({ sub, exp } satisfies Payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verify a token; returns the payload if valid and unexpired, else null. */
export function verifyToken(token: string, secret: string): Payload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString()) as Payload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Build a Set-Cookie header value for the session token. */
export function sessionCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${TTL_SECONDS}`,
  ].join("; ");
}

/** Build a Set-Cookie header value that clears the session. */
export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Read the session token from a Cookie header, or null. */
export function readCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE_NAME) return v.join("=");
  }
  return null;
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
