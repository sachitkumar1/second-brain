import { NextResponse } from "next/server";
import { agentAuthorized } from "@/lib/agentAuth";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Non-sensitive settings the Mac agent follows (lookback window, group chats, etc.). */
export async function GET(req: Request) {
  if (!(await agentAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const s = await getSettings();
  return NextResponse.json({ replyQueue: s.replyQueue, timezone: s.timezone, serverTime: new Date().toISOString() });
}
