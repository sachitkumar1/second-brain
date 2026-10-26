// Session token helpers shared by proxy.ts and server code (no `server-only` import so the proxy can use it).
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "sb_session";
export const SESSION_TTL_DAYS = 30;

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters).");
  return new TextEncoder().encode(s);
}

export async function signSession(): Promise<string> {
  return new SignJWT({ sub: "owner", typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.typ === "session" && payload.sub === "owner";
  } catch {
    return false;
  }
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
