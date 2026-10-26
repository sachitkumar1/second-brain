import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.SESSION_SECRET = "test-session-secret-0123456789";
process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret";
process.env.APP_URL = "https://apollo.example.com";

const verifyMock = vi.fn();
vi.mock("@/lib/googleLogin", async (orig) => ({
  ...(await orig<typeof import("@/lib/googleLogin")>()),
  exchangeLoginCode: vi.fn(async () => "id-token"),
  verifyGoogleIdToken: (...a: unknown[]) => verifyMock(...a),
}));

import { allowedEmails, isAllowedEmail, sessionEmail, signSession, verifySession, SESSION_COOKIE } from "@/lib/session";

describe("allowlist", () => {
  it("allows exactly the two default accounts, case-insensitively", () => {
    expect(allowedEmails()).toEqual(["sachitkumar2025@gmail.com", "sachitk@berkeley.edu"]);
    expect(isAllowedEmail("SachitKumar2025@gmail.com")).toBe(true);
    expect(isAllowedEmail("sachitk@berkeley.edu")).toBe(true);
    expect(isAllowedEmail("someone@gmail.com")).toBe(false);
    expect(isAllowedEmail("sachitk@berkeley.edu.evil.com")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
  });
  it("can be overridden with ALLOWED_EMAILS", () => {
    process.env.ALLOWED_EMAILS = " a@x.com , B@y.com ";
    expect(allowedEmails()).toEqual(["a@x.com", "b@y.com"]);
    delete process.env.ALLOWED_EMAILS;
  });
});

describe("sessions", () => {
  it("accept allowed accounts and reject everything else", async () => {
    const token = await signSession("SachitK@berkeley.edu");
    expect(await sessionEmail(token)).toBe("sachitk@berkeley.edu");
    expect(await verifySession(await signSession("intruder@gmail.com"))).toBe(false);
    expect(await verifySession(token + "x")).toBe(false);
    expect(await verifySession(undefined)).toBe(false);
  });
  it("sign out an account as soon as it's removed from the allowlist", async () => {
    const token = await signSession("sachitkumar2025@gmail.com");
    process.env.ALLOWED_EMAILS = "sachitk@berkeley.edu";
    expect(await verifySession(token)).toBe(false);
    delete process.env.ALLOWED_EMAILS;
    expect(await verifySession(token)).toBe(true);
  });
  it("reject old password-era sessions", async () => {
    const legacy = await new SignJWT({ sub: "owner", typ: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1d")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    expect(await verifySession(legacy)).toBe(false);
  });
});

describe("Google ID token verification", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let keys: any, sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;
  let verify: typeof import("@/lib/googleLogin").verifyGoogleIdToken;
  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
    sign = (claims, o = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(o.iss ?? "https://accounts.google.com")
        .setAudience(o.aud ?? process.env.GOOGLE_CLIENT_ID!)
        .setIssuedAt()
        .setExpirationTime(o.exp ?? "5m")
        .sign(privateKey);
    verify = (await vi.importActual<typeof import("@/lib/googleLogin")>("@/lib/googleLogin")).verifyGoogleIdToken;
  });
  const opts = () => ({ clientId: process.env.GOOGLE_CLIENT_ID!, nonce: "n1", keys });

  it("accepts a valid token", async () => {
    const t = await sign({ email: "SachitK@berkeley.edu", email_verified: true, nonce: "n1", name: "Sachit" });
    expect(await verify(t, opts())).toEqual({ email: "sachitk@berkeley.edu", name: "Sachit" });
  });
  it("rejects a wrong nonce, audience, issuer, unverified email or expired token", async () => {
    await expect(verify(await sign({ email: "a@b.com", email_verified: true, nonce: "other" }), opts())).rejects.toThrow(/nonce/);
    await expect(verify(await sign({ email: "a@b.com", email_verified: true, nonce: "n1" }, { aud: "someone-else" }), opts())).rejects.toThrow();
    await expect(verify(await sign({ email: "a@b.com", email_verified: true, nonce: "n1" }, { iss: "https://evil.com" }), opts())).rejects.toThrow();
    await expect(verify(await sign({ email: "a@b.com", email_verified: false, nonce: "n1" }), opts())).rejects.toThrow(/verified/);
    await expect(verify(await sign({ email: "a@b.com", email_verified: true, nonce: "n1" }, { exp: "-1m" }), opts())).rejects.toThrow();
  });
});

describe("sign-in callback", () => {
  const flow = { state: "s1", nonce: "n1", verifier: "v1", next: "/classes" };
  const req = (state: string) =>
    new NextRequest(`https://apollo.example.com/api/auth/google/callback?code=c&state=${state}`, {
      headers: { cookie: `sb_login=${Buffer.from(JSON.stringify(flow)).toString("base64url")}` },
    });

  it("signs in an allowed account and returns to the page you asked for", async () => {
    const { GET } = await import("@/app/api/auth/google/callback/route");
    verifyMock.mockResolvedValueOnce({ email: "sachitkumar2025@gmail.com", name: null });
    const res = await GET(req("s1"));
    expect(res.headers.get("location")).toBe("https://apollo.example.com/classes");
    const session = res.cookies.get(SESSION_COOKIE)?.value;
    expect(await sessionEmail(session)).toBe("sachitkumar2025@gmail.com");
  });
  it("turns away any other Google account", async () => {
    const { GET } = await import("@/app/api/auth/google/callback/route");
    verifyMock.mockResolvedValueOnce({ email: "friend@gmail.com", name: null });
    const res = await GET(req("s1"));
    expect(res.headers.get("location")).toContain("/login?error=not_allowed");
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
  it("rejects a forged state", async () => {
    const { GET } = await import("@/app/api/auth/google/callback/route");
    verifyMock.mockClear();
    const res = await GET(req("forged"));
    expect(res.headers.get("location")).toContain("/login?error=expired");
    expect(verifyMock).not.toHaveBeenCalled();
  });
});
