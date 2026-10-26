import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { esc } from "@/lib/notify/templates";
import { verifyAction } from "@/lib/session";
import { applyTaskAction, type TaskAction } from "@/lib/tasks";

// One-click links from emails. GET shows a confirm button (so link scanners can't trigger actions);
// POST performs it. Tokens are signed, single-purpose and expire after 10 days.

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  done: "Mark as done",
  snooze: "Snooze until tomorrow",
  nocarry: "Stop carrying this over",
};

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;color:#0e1726;display:grid;place-items:center;min-height:100vh;padding:16px}
.card{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:28px;max-width:420px;width:100%;box-sizing:border-box}
h1{font-size:18px;margin:0 0 8px}p{color:#5b6576;margin:0 0 20px;line-height:1.5}
button,a.btn{display:inline-block;background:#003262;color:#fff;border:0;border-radius:8px;padding:11px 18px;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}
a.link{color:#003262;margin-left:14px;font-size:14px}</style></head><body><div class="card">${body}</div></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const claims = await verifyAction(token);
  if (!claims) return page("Link expired", `<h1>This link has expired</h1><p>Open the dashboard to update the task.</p><a class="btn" href="${appUrl()}">Open dashboard</a>`, 400);
  const rows = await sql<{ title: string; status: string }[]>`select title, status from tasks where id = ${claims.id}`;
  if (!rows[0]) return page("Not found", `<h1>Task not found</h1><p>It may have been deleted.</p><a class="btn" href="${appUrl()}">Open dashboard</a>`, 404);
  return page(
    LABELS[claims.a] ?? "Confirm",
    `<h1>${esc(LABELS[claims.a] ?? "Confirm")}?</h1><p>${esc(rows[0].title)}</p>
     <form method="post"><input type="hidden" name="t" value="${esc(token)}"><button type="submit">Confirm</button><a class="link" href="${appUrl()}">Cancel</a></form>`,
  );
}

export async function POST(req: Request) {
  const form = await req.formData();
  const claims = await verifyAction(String(form.get("t") ?? ""));
  if (!claims || !(claims.a in LABELS)) return page("Link expired", `<h1>This link has expired</h1><a class="btn" href="${appUrl()}">Open dashboard</a>`, 400);
  const task = await applyTaskAction(claims.id, claims.a as TaskAction);
  if (!task) return page("Not found", `<h1>Task not found</h1><a class="btn" href="${appUrl()}">Open dashboard</a>`, 404);
  const done = claims.a === "done" ? "Marked done" : claims.a === "snooze" ? "Snoozed until tomorrow" : "Won't carry over anymore";
  return page(done, `<h1>✓ ${esc(done)}</h1><p>${esc(task.title)}</p><a class="btn" href="${appUrl()}">Open dashboard</a>`);
}
