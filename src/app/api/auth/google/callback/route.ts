import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { exchangeLoginCode, LOGIN_COOKIE, LOGIN_COOKIE_PATH, verifyGoogleIdToken } from "@/lib/googleLogin";
import { isAllowedEmail, SESSION_COOKIE, SESSION_TTL_DAYS, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Flow = { state: string; nonce: string; verifier: string; next: string };

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fail = (error: string, email?: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}${email ? `&email=${encodeURIComponent(email)}` : ""}`, req.url));
    res.cookies.delete({ name: LOGIN_COOKIE, path: LOGIN_COOKIE_PATH });
    return res;
  };

  if (url.searchParams.get("error")) return fail("cancelled");
  let flow: Flow;
  try {
    flow = JSON.parse(Buffer.from(req.cookies.get(LOGIN_COOKIE)?.value ?? "", "base64url").toString("utf8")) as Flow;
  } catch {
    return fail("expired");
  }
  const state = url.searchParams.get("state") ?? "";
  if (!flow?.state || !state || !safeEqual(state, flow.state)) return fail("expired");

  let email: string;
  try {
    const idToken = await exchangeLoginCode(url.searchParams.get("code") ?? "", flow.verifier);
    ({ email } = await verifyGoogleIdToken(idToken, { clientId: env.googleClientId() ?? "", nonce: flow.nonce }));
  } catch (err) {
    console.error("[auth] Google sign-in failed:", err);
    return fail("failed");
  }
  if (!isAllowedEmail(email)) {
    console.warn("[auth] rejected sign-in from", email);
    return fail("not_allowed", email);
  }

  const res = NextResponse.redirect(new URL(flow.next || "/", req.url));
  res.cookies.delete({ name: LOGIN_COOKIE, path: LOGIN_COOKIE_PATH });
  res.cookies.set(SESSION_COOKIE, await signSession(email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
  return res;
}
