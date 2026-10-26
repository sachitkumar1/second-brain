import { NextResponse } from "next/server";
import { randomToken } from "@/lib/crypto";
import { googleAuthUrl } from "@/lib/sources/google";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const state = randomToken(18);
  const hint = new URL(req.url).searchParams.get("hint") ?? undefined;
  let url: string;
  try {
    url = googleAuthUrl(state, hint);
  } catch (err) {
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent((err as Error).message)}#connections`, req.url));
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/oauth/google", maxAge: 600 });
  return res;
}
