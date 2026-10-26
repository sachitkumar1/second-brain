import { NextResponse } from "next/server";
import { z } from "zod";
import { agentAuthorized } from "@/lib/agentAuth";
import { sql } from "@/lib/db";
import { setKV } from "@/lib/settings";

// Receives the end-to-end encrypted reply queue from the Mac agent. The payload is AES-GCM
// ciphertext produced on your Mac; the key never leaves your devices, so the server can't read names.

export const dynamic = "force-dynamic";

const Payload = z.object({
  platform: z.enum(["imessage", "instagram"]),
  ciphertext: z.string().max(1_500_000),
  iv: z.string().max(64),
  salt: z.string().max(128),
  kdf: z.object({ name: z.literal("PBKDF2"), hash: z.literal("SHA-256"), iterations: z.number().int().min(100_000).max(5_000_000) }),
  waitingCount: z.number().int().min(0).max(10_000),
  oldestWaitAt: z.string().datetime().nullable(),
  generatedAt: z.string().datetime(),
});

export async function POST(req: Request) {
  if (!(await agentAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const p = parsed.data;
  await sql`
    insert into reply_queue (platform, ciphertext, iv, salt, kdf, waiting_count, oldest_wait_at, generated_at, updated_at)
    values (${p.platform}, ${p.ciphertext}, ${p.iv}, ${p.salt}, ${sql.json(p.kdf)}, ${p.waitingCount},
            ${p.oldestWaitAt ? new Date(p.oldestWaitAt) : null}, ${new Date(p.generatedAt)}, now())
    on conflict (platform) do update set
      ciphertext = excluded.ciphertext, iv = excluded.iv, salt = excluded.salt, kdf = excluded.kdf,
      waiting_count = excluded.waiting_count, oldest_wait_at = excluded.oldest_wait_at,
      generated_at = excluded.generated_at, updated_at = now()`;
  await setKV("agent_last_seen", { at: new Date().toISOString(), platform: p.platform });
  // Expired snoozes are useless; keep the table small.
  await sql`delete from reply_dismissals where until is not null and until < now() - interval '1 day'`;
  return NextResponse.json({ ok: true });
}
