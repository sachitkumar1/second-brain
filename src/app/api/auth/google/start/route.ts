import { NextResponse } from "next/server";
import { randomToken } from "@/lib/crypto";
import { LOGIN_COOKIE, LOGIN_COOKIE_PATH, loginAuthUrl } from "@/lib/googleLogin";

export const dynamic = "force-dynamic";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export async function GET(req: Request) {
  const flow = { state: randomToken(18), nonce: randomToken(18), verifier: randomToken(48), next: safeNext(new URL(req.url).searchParams.get("next")) };
  let url: string;
  try {
    url = loginAuthUrl(flow);
  } catch {
    return NextResponse.redirect(new URL("/login?error=config", req.url));
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(LOGIN_COOKIE, Buffer.from(JSON.stringify(flow)).toString("base64url"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: LOGIN_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
