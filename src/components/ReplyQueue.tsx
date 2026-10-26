"use client";

import { Check, Clock, ExternalLink, HelpCircle, Lock, LockOpen, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, cx, Empty, inputClass } from "./ui";

// End-to-end encrypted reply queue. The Mac agent encrypts { name, waiting since, count } with a key
// derived from your passphrase; this component derives the same key in the browser (WebCrypto) and
// decrypts locally. The server only ever stores and returns ciphertext.

type Thread = {
  id: string;
  state: string;
  name: string;
  handle: string | null;
  isGroup: boolean;
  unanswered: number;
  waitingSince: string;
  lastIncomingAt: string;
  question: boolean;
  unread: boolean;
};
type Platform = {
  platform: "imessage" | "instagram";
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: { iterations: number };
  waiting_count: number;
  updated_at: string;
};
type Payload = { platforms: Platform[]; dismissals: { state_hash: string; until: string | null }[]; slack: SlackThread[] };
type SlackThread = { id: string; name: string; waiting_since: string; unanswered: number; url: string | null; state_hash: string };
type Decrypted = { asOf?: string; source?: string; threads: Thread[] };

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// --- remember-on-this-device: a non-extractable CryptoKey kept in IndexedDB (never the passphrase).
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("apollo", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(k: string): Promise<CryptoKey | undefined> {
  const db = await idb();
  return new Promise((resolve) => {
    const req = db.transaction("keys").objectStore("keys").get(k);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => resolve(undefined);
  });
}
async function idbSet(k: string, v: CryptoKey | null) {
  const db = await idb();
  const store = db.transaction("keys", "readwrite").objectStore("keys");
  if (v) store.put(v, k);
  else store.delete(k);
}

async function deriveKey(passphrase: string, salt: string, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(salt), iterations }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}

async function decrypt(key: CryptoKey, p: Platform): Promise<Decrypted> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(p.iv) }, key, b64(p.ciphertext));
  return JSON.parse(new TextDecoder().decode(pt)) as Decrypted;
}

function ago(iso: string, now: number): string {
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const AVATAR = ["#dbe7f6", "#e3f1ec", "#fbeadb", "#ece6f8", "#f8e1e6", "#e1eef5", "#eef3dc", "#f6efd9"];
const avatarBg = (s: string) => AVATAR[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % AVATAR.length];

type Tab = "imessage" | "instagram" | "slack";

export function ReplyQueue({ counts, agentSeen, serverNow }: { counts: Record<Tab, number>; agentSeen: string | null; serverNow: string }) {
  const now = new Date(serverNow).getTime();
  const [data, setData] = useState<Payload | null>(null);
  const [decrypted, setDecrypted] = useState<Partial<Record<"imessage" | "instagram", Decrypted>>>({});
  const [locked, setLocked] = useState(true);
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>(counts.imessage || !counts.slack ? "imessage" : "slack");

  const load = useCallback(async () => {
    const res = await fetch("/api/replyqueue", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as Payload;
    setData(json);
    setHidden(new Set(json.dismissals.map((d) => d.state_hash)));
    return json;
  }, []);

  const unlockWith = useCallback(async (key: CryptoKey, payload: Payload) => {
    const out: Partial<Record<"imessage" | "instagram", Decrypted>> = {};
    for (const p of payload.platforms) out[p.platform] = await decrypt(key, p);
    setDecrypted(out);
    setLocked(false);
  }, []);

  // Auto-unlock with a remembered key, if any.
  useEffect(() => {
    (async () => {
      const payload = await load();
      if (!payload?.platforms.length) {
        setLocked(false);
        return;
      }
      try {
        const key = await idbGet(`rq:${payload.platforms[0].salt}`);
        if (key) await unlockWith(key, payload);
      } catch {
        // Stale key (passphrase changed) — fall back to the prompt.
      }
    })();
  }, [load, unlockWith]);

  const onUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.platforms.length) return;
    setBusy(true);
    setError(null);
    try {
      const p0 = data.platforms[0];
      const key = await deriveKey(pass, p0.salt, p0.kdf.iterations);
      await unlockWith(key, data);
      if (remember) await idbSet(`rq:${p0.salt}`, key);
      setPass("");
    } catch {
      setError("That passphrase didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    if (data?.platforms[0]) await idbSet(`rq:${data.platforms[0].salt}`, null);
    setDecrypted({});
    setLocked(true);
  };

  const dismiss = async (stateHash: string, hours: number | null) => {
    setHidden((h) => new Set(h).add(stateHash));
    await fetch("/api/replyqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stateHash, snoozeHours: hours }),
    });
  };

  const threads = useMemo(() => {
    if (tab === "slack") return [];
    return (decrypted[tab]?.threads ?? []).filter((t) => !hidden.has(t.state)).sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
  }, [decrypted, tab, hidden]);
  const slack = (data?.slack ?? []).filter((s) => !hidden.has(s.state_hash));
  const hasEncrypted = !!data?.platforms.length;

  const visibleCount = (t: Tab) =>
    t === "slack" ? (data ? slack.length : counts.slack) : decrypted[t] ? decrypted[t]!.threads.filter((x) => !hidden.has(x.state)).length : counts[t];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-3 pt-2.5" role="tablist" aria-label="Platforms">
        {(
          [
            ["imessage", "iMessage"],
            ["instagram", "Instagram"],
            ["slack", "Slack"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
              tab === id ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:text-ink",
            )}
          >
            {label}
            <span className="tabular text-muted">{visibleCount(id)}</span>
          </button>
        ))}
        {hasEncrypted && !locked && (
          <button onClick={lock} className="ml-auto rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Lock reply queue" title="Lock (forget key on this device)">
            <LockOpen className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="scroll-quiet mt-1 max-h-[380px] flex-1 overflow-y-auto pb-2">
        {tab !== "slack" && hasEncrypted && locked ? (
          <form onSubmit={onUnlock} className="space-y-2.5 px-4 py-4">
            <div className="flex items-start gap-2.5 text-sm text-ink-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              <p>
                <span className="font-semibold text-ink">{counts.imessage + counts.instagram} people</span> are waiting on a reply. Names are end-to-end encrypted. Enter your passphrase to see them.
              </p>
            </div>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase" className={inputClass} aria-label="Passphrase" autoComplete="off" />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--navy)]" />
              Remember on this device
            </label>
            {error && <p className="text-xs text-red">{error}</p>}
            <button type="submit" disabled={busy || !pass} className="w-full rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-on-navy hover:bg-navy-hover disabled:opacity-60">
              {busy ? "Decrypting…" : "Unlock"}
            </button>
          </form>
        ) : tab === "slack" ? (
          slack.length ? (
            <ul className="divide-y divide-line-2">
              {slack.map((s) => (
                <Row
                  key={s.id}
                  name={s.name}
                  meta={`${s.unanswered} message${s.unanswered === 1 ? "" : "s"} · waiting ${ago(s.waiting_since, now)}`}
                  href={s.url}
                  onDone={() => dismiss(s.state_hash, null)}
                  onSnooze={() => dismiss(s.state_hash, 24)}
                />
              ))}
            </ul>
          ) : (
            <Empty icon={<MessageCircle />}>You&apos;re caught up on Slack DMs.</Empty>
          )
        ) : threads.length ? (
          <ul className="divide-y divide-line-2">
            {threads.map((t) => (
              <Row
                key={t.id}
                name={t.name}
                group={t.isGroup}
                question={t.question}
                unread={t.unread}
                meta={`${t.unanswered} message${t.unanswered === 1 ? "" : "s"} · waiting ${ago(t.waitingSince, now)}`}
                href={
                  tab === "imessage"
                    ? t.handle && !t.isGroup
                      ? `sms:${t.handle}`
                      : null
                    : t.handle
                      ? `https://ig.me/m/${t.handle}`
                      : "https://www.instagram.com/direct/inbox/"
                }
                onDone={() => dismiss(t.state, null)}
                onSnooze={() => dismiss(t.state, 24)}
              />
            ))}
          </ul>
        ) : (
          <Empty icon={<MessageCircle />}>
            {decrypted[tab as "imessage" | "instagram"]
              ? "You're all caught up here."
              : tab === "instagram"
                ? "No Instagram data yet. Drop an Instagram export (JSON) in ~/Downloads, or connect the API in the Mac agent."
                : "The Mac agent hasn't sent anything yet. Set it up under Settings → Mac agent."}
          </Empty>
        )}
      </div>
      <p className="border-t border-line-2 px-4 py-2 text-[11px] text-muted">
        {agentSeen ? `Mac agent last checked in ${ago(agentSeen, now)} ago · end-to-end encrypted` : "Mac agent not connected yet"}
        {tab === "instagram" && decrypted.instagram?.source === "export" && decrypted.instagram.asOf ? ` · export from ${new Date(decrypted.instagram.asOf).toLocaleDateString()}` : ""}
      </p>
    </div>
  );
}

function Row({
  name,
  meta,
  href,
  group,
  question,
  unread,
  onDone,
  onSnooze,
}: {
  name: string;
  meta: string;
  href: string | null;
  group?: boolean;
  question?: boolean;
  unread?: boolean;
  onDone: () => void;
  onSnooze: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5">
      <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-[#1f2a3d]" style={{ background: avatarBg(name) }} aria-hidden>
        {initials(name)}
        {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-gold" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          {group && <Badge>Group</Badge>}
          {question && (
            <Badge tone="gold">
              <HelpCircle className="h-3 w-3" /> Question
            </Badge>
          )}
        </div>
        <p className="tabular text-xs text-muted">{meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Open conversation with ${name}`} title="Open">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button onClick={onSnooze} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Snooze ${name} for a day`} title="Snooze a day">
          <Clock className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDone} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Mark ${name} as handled`} title="Handled (until they message again)">
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
