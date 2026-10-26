import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { exchangeGoogleCode } from "@/lib/sources/google";
import { syncDue } from "@/lib/sources";
import { createConnection, updateConnection, type Connection } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?${q}#connections`, req.url));
  const error = url.searchParams.get("error");
  if (error) return back(`error=${encodeURIComponent(`Google sign-in was cancelled (${error}).`)}`);

  const state = url.searchParams.get("state") ?? "";
  const expected = req.cookies.get("g_oauth_state")?.value ?? "";
  if (!state || !expected || !safeEqual(state, expected)) return back(`error=${encodeURIComponent("Sign-in expired; try connecting again.")}`);

  try {
    const { secret, email } = await exchangeGoogleCode(url.searchParams.get("code") ?? "");
    const existing = await sql<Connection[]>`select * from connections where type = 'google' and account = ${email}`;
    let id: string;
    if (existing[0]) {
      id = existing[0].id;
      await updateConnection(id, { secret, status: "ok", last_error: null, enabled: true });
    } else {
      id = (await createConnection({ type: "google", label: email, account: email, secret, config: { gmail: true, calendar: true, drive: true } })).id;
    }
    // First import in the background of this request so the dashboard isn't empty.
    await syncDue({ budgetMs: 40_000, onlyId: id });
    const res = back(`connected=${encodeURIComponent(email)}`);
    res.cookies.delete({ name: "g_oauth_state", path: "/api/oauth/google" });
    return res;
  } catch (err) {
    return back(`error=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
  }
}
