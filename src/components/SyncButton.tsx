"use client";

import { RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { syncNow } from "@/app/actions";
import { cx } from "./ui";

export function SyncButton({ lastSync }: { lastSync: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted sm:inline" aria-live="polite">
        {pending ? "Syncing everything…" : msg ? msg.text : lastSync ? `Synced ${lastSync}` : "Not synced yet"}
      </span>
      <button
        onClick={() =>
          start(async () => {
            const r = await syncNow();
            setMsg({ ok: r.ok, text: r.ok ? "Up to date" : "Synced with errors" });
            if (!r.ok && r.message) console.warn(r.message);
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface-2 disabled:opacity-60"
        title={msg && !msg.ok ? "Some sources failed — see Settings → Connections" : "Sync all sources now"}
      >
        <RefreshCw className={cx("h-3.5 w-3.5", pending && "animate-spin")} />
        Sync
      </button>
    </div>
  );
}
