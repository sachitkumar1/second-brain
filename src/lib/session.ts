// Session token helpers shared by proxy.ts and server code (no `server-only` import so the proxy can use it).
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "sb_session";
export const SESSION_TTL_DAYS = 30;

/** Google accounts allowed to sign in. Override with ALLOWED_EMAILS (comma-separated). */
export const DEFAULT_ALLOWED_EMAILS = ["sachitkumar2025@gmail.com", "sachitk@berkeley.edu"];

export function allowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS?.trim();
  return (raw ? raw.split(",") : DEFAULT_ALLOWED_EMAILS).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && allowedEmails().includes(email.trim().toLowerCase());
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters).");
  return new TextEncoder().encode(s);
}

export async function signSession(email: string): Promise<string> {
  return new SignJWT({ sub: email.toLowerCase(), typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secretKey());
}

/**
 * Returns the signed-in email, or null. The allowlist is re-checked on every request, so removing
 * an address from ALLOWED_EMAILS signs that account out immediately.
 */
export async function sessionEmail(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.typ === "session" && typeof payload.sub === "string" && isAllowedEmail(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  return (await sessionEmail(token)) !== null;
}

export type ActionClaims = { a: string; id: string };

/** Signed, expiring tokens for one-click links in emails (mark done, stop carrying over...). */
export async function signAction(claims: ActionClaims, ttl = "10d"): Promise<string> {
  return new SignJWT({ ...claims, typ: "action" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secretKey());
}

export async function verifyAction(token: string): Promise<ActionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.typ !== "action" || typeof payload.a !== "string" || typeof payload.id !== "string") return null;
    return { a: payload.a, id: payload.id };
  } catch {
    return null;
  }
}
