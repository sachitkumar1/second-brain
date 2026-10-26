import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";

// Browser-facing: returns ciphertext for client-side decryption plus snooze markers.
// Requires a dashboard session (enforced in proxy.ts).

export const dynamic = "force-dynamic";

export async function GET() {
  const [platforms, dismissals, slack] = await Promise.all([
    sql`select platform, ciphertext, iv, salt, kdf, waiting_count, oldest_wait_at, generated_at, updated_at from reply_queue`,
    sql`select state_hash, until from reply_dismissals where until is null or until > now()`,
    sql`select id, name, waiting_since, unanswered, url, state_hash from reply_waiting order by waiting_since`,
  ]);
  return NextResponse.json({ platforms, dismissals, slack }, { headers: { "cache-control": "no-store" } });
}

// snoozeHours: null = handled (hidden until they message again, since that changes the state hash).
const Dismiss = z.object({ stateHash: z.string().min(1).max(128), snoozeHours: z.number().positive().max(24 * 30).nullable() });

export async function POST(req: Request) {
  const parsed = Dismiss.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { stateHash, snoozeHours } = parsed.data;
  const until = snoozeHours ? new Date(Date.now() + snoozeHours * 3_600_000) : null;
  await sql`
    insert into reply_dismissals (state_hash, until) values (${stateHash}, ${until})
    on conflict (state_hash) do update set until = excluded.until, created_at = now()`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const stateHash = new URL(req.url).searchParams.get("stateHash") ?? "";
  await sql`delete from reply_dismissals where state_hash = ${stateHash}`;
  return NextResponse.json({ ok: true });
}
