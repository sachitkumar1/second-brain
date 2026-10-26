"use client";

import { AlertTriangle, CheckCircle2, PauseCircle, RefreshCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import {
  getSlackChannels,
  removeConnection,
  setConnectionEnabled,
  setSlackChannels,
  syncConnectionNow,
  updateGoogleConfig,
} from "@/app/actions";
import { buttonClass, cx } from "../ui";

export type ConnectionView = {
  id: string;
  type: string;
  label: string;
  account: string | null;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastSync: string | null;
  detail: string | null;
  google?: { gmail: boolean; calendar: boolean; drive: boolean };
  slackChannels?: { id: string; name: string }[];
};

const TYPE_LABEL: Record<string, string> = {
  google: "Google",
  slack: "Slack",
  canvas: "bCourses",
  ed: "Ed",
  gradescope: "Gradescope",
  ics: "Calendar feed",
  webpage: "Course website",
};

export function ConnectionCard({ c }: { c: ConnectionView }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [channels, setChannels] = useState<{ id: string; name: string; is_private: boolean }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(c.slackChannels?.map((x) => x.id) ?? []));
  const [filter, setFilter] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.message ? { ok: r.ok, text: r.message } : null);
    });

  const statusIcon =
    !c.enabled ? <PauseCircle className="h-4 w-4 text-muted" /> : c.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-green" /> : <AlertTriangle className="h-4 w-4 text-amber" />;

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5">{statusIcon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {c.label} <span className="ml-1 text-xs font-medium text-muted">{TYPE_LABEL[c.type] ?? c.type}</span>
          </p>
          <p className="text-xs text-muted">
            {c.account && c.account !== c.label ? `${c.account} · ` : ""}
            {!c.enabled ? "Paused" : c.status === "needs_auth" ? "Needs to be reconnected" : c.lastSync ? `Synced ${c.lastSync}` : "Not synced yet"}
            {c.detail ? ` · ${c.detail}` : ""}
          </p>
          {c.lastError && c.status !== "ok" && <p className="mt-1 break-words text-xs text-amber">{c.lastError}</p>}
          {msg && <p className={cx("mt-1 text-xs", msg.ok ? "text-green" : "text-red")}>{msg.text}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {c.type === "google" && c.status === "needs_auth" && (
            <a href={`/api/oauth/google/start?hint=${encodeURIComponent(c.account ?? "")}`} className={buttonClass.secondary}>
              Reconnect
            </a>
          )}
          <button disabled={pending || !c.enabled} onClick={() => run(() => syncConnectionNow(c.id))} className={buttonClass.ghost} title="Sync now">
            <RefreshCw className={cx("h-3.5 w-3.5", pending && "animate-spin")} /> Sync
          </button>
          <button disabled={pending} onClick={() => run(() => setConnectionEnabled(c.id, !c.enabled))} className={buttonClass.ghost}>
            {c.enabled ? "Pause" : "Resume"}
          </button>
          <button
            disabled={pending}
            onClick={() => window.confirm(`Disconnect ${c.label}? Its synced data will be removed.`) && run(() => removeConnection(c.id))}
            className={cx(buttonClass.ghost, "hover:text-red")}
            aria-label={`Remove ${c.label}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {c.google && (
        <div className="mt-2.5 flex flex-wrap gap-4 pl-7 text-sm">
          {(["gmail", "calendar", "drive"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-ink-2">
              <input
                type="checkbox"
                defaultChecked={c.google![k]}
                className="accent-[var(--navy)]"
                onChange={(e) => run(() => updateGoogleConfig(c.id, { ...c.google!, [k]: e.target.checked }))}
              />
              {k === "gmail" ? "Gmail" : k === "calendar" ? "Calendar" : "Drive"}
            </label>
          ))}
        </div>
      )}

      {c.type === "slack" && (
        <div className="mt-2.5 pl-7">
          <p className="text-xs text-muted">
            Announcement channels: {c.slackChannels?.length ? c.slackChannels.map((x) => `#${x.name}`).join(", ") : "none yet"}
          </p>
          {channels === null ? (
            <button
              className={cx(buttonClass.ghost, "mt-1 -ml-2 text-link")}
              onClick={() =>
                start(async () => {
                  const r = await getSlackChannels(c.id);
                  if (r.ok) setChannels(r.data as { id: string; name: string; is_private: boolean }[]);
                  else setMsg({ ok: false, text: r.message ?? "Couldn't load channels" });
                })
              }
            >
              Choose channels…
            </button>
          ) : (
            <div className="mt-2 rounded-xl border border-line p-2">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels" className="mb-2 w-full rounded-md border border-line bg-surface px-2 py-1 text-sm" />
              <div className="scroll-quiet grid max-h-56 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
                {channels
                  .filter((ch) => ch.name.includes(filter.toLowerCase()))
                  .map((ch) => (
                    <label key={ch.id} className="flex items-center gap-2 py-0.5 text-sm text-ink-2">
                      <input
                        type="checkbox"
                        className="accent-[var(--navy)]"
                        checked={picked.has(ch.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(ch.id);
                          else next.delete(ch.id);
                          setPicked(next);
                        }}
                      />
                      {ch.is_private ? "🔒" : "#"}
                      {ch.name}
                    </label>
                  ))}
              </div>
              <button
                className={cx(buttonClass.primary, "mt-2")}
                disabled={pending}
                onClick={() => run(() => setSlackChannels(c.id, channels.filter((ch) => picked.has(ch.id)).map(({ id, name }) => ({ id, name }))))}
              >
                Save channels
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
