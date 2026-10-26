import { NextResponse } from "next/server";
import { bearer } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { tick } from "@/lib/jobs/tick";

export const dynamic = "force-dynamic";
// Hobby plans allow up to 60s (300s with Fluid compute); the tick keeps itself under ~55s.
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = env.cronSecret();
  if (!secret) return false;
  const provided = bearer(req) ?? new URL(req.url).searchParams.get("secret");
  return !!provided && safeEqual(provided, secret);
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await tick());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
