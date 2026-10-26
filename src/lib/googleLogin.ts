import "server-only";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { appUrl, env } from "./env";
import { fetchJson } from "./http";

// "Sign in with Google" for the dashboard itself (separate from connecting Gmail/Calendar/Drive).
// Asks only for your identity (openid email profile), protected by state, nonce and PKCE.

const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const LOGIN_COOKIE = "sb_login";
export const LOGIN_COOKIE_PATH = "/api/auth/google";

export function loginRedirectUri(): string {
  return `${appUrl()}/api/auth/google/callback`;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function loginAuthUrl(p: { state: string; nonce: string; verifier: string }): string {
  const clientId = env.googleClientId();
  if (!clientId) throw new Error("Google sign-in isn't configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: loginRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state: p.state,
    nonce: p.nonce,
    code_challenge: pkceChallenge(p.verifier),
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeLoginCode(code: string, verifier: string): Promise<string> {
  const tok = await fetchJson<{ id_token?: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: env.googleClientId() ?? "",
      client_secret: env.googleClientSecret() ?? "",
      redirect_uri: loginRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tok.id_token) throw new Error("Google didn't return an ID token.");
  return tok.id_token;
}

export type GoogleIdentity = { email: string; name: string | null };

/** Verifies Google's signature, issuer, audience, expiry and nonce, and that the email is verified. */
export async function verifyGoogleIdToken(
  idToken: string,
  opts: { clientId: string; nonce: string; keys?: JWTVerifyGetKey },
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, opts.keys ?? GOOGLE_KEYS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: opts.clientId,
  });
  if (payload.nonce !== opts.nonce) throw new Error("Sign-in response didn't match this request (nonce).");
  if (typeof payload.email !== "string" || payload.email_verified !== true) throw new Error("Google account email isn't verified.");
  return { email: payload.email.toLowerCase(), name: typeof payload.name === "string" ? payload.name : null };
}
