import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const Sub = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export async function POST(req: Request) {
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  await sql`
    insert into push_subscriptions (endpoint, data) values (${parsed.data.endpoint}, ${sql.json(parsed.data as never)})
    on conflict (endpoint) do update set data = excluded.data`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
  return NextResponse.json({ ok: true });
}
