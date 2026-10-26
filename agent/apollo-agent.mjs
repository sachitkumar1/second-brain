#!/usr/bin/env node
// Apollo — Mac agent
//
// Runs on your Mac every 10 minutes. It reads iMessage (chat.db) and Instagram (an official data
// export, or the Instagram API for professional accounts) LOCALLY, works out which conversations are
// waiting on your reply, and uploads only an end-to-end encrypted list of { name, waiting since,
// unanswered count }. Message text never leaves this machine, and the dashboard server can't read the
// names either: they're AES-256-GCM encrypted with a key derived from a passphrase only you know,
// and decrypted in your browser.
//
// Zero dependencies. Requires Node.js 22.13+ (built-in node:sqlite).
//
//   node apollo-agent.mjs setup        # one-time: server URL, agent token, passphrase
//   node apollo-agent.mjs run          # sync once (add --dry-run to print locally, upload nothing)
//   node apollo-agent.mjs install      # run automatically every 10 minutes (launchd)
//   node apollo-agent.mjs uninstall
//   node apollo-agent.mjs doctor       # check permissions and setup

import { execFileSync } from "node:child_process";
import { webcrypto, createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOME = os.homedir();
const DIR = path.join(HOME, ".apollo-agent");
const CONFIG = path.join(DIR, "config.json");
const LOG = path.join(DIR, "agent.log");
const LABEL = "com.apollo.agent";
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
const KEYCHAIN_SERVICE = "apollo-agent";
const APPLE_EPOCH_MS = 978_307_200_000;
const KDF_ITERATIONS = 600_000;

// ---------------------------------------------------------------- utilities

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.chmodSync(CONFIG, 0o600);
}

function keychainSet(passphrase) {
  try {
    execFileSync("/usr/bin/security", ["add-generic-password", "-U", "-a", os.userInfo().username, "-s", KEYCHAIN_SERVICE, "-w", passphrase], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function keychainGet() {
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-a", os.userInfo().username, "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Thread ids are keyed with a secret derived from your passphrase, so the server can't
 * brute-force them back to phone numbers. Only "state" hashes (for snoozes) ever reach it.
 */
export function makeIdKey(passphrase, salt) {
  return createHash("sha256").update(`thread-ids:${salt}:${passphrase}`).digest();
}
const threadId = (idKey, s) => createHmac("sha256", idKey).update(s).digest("hex");
const b64 = (buf) => Buffer.from(buf).toString("base64");

export function msToAppleNs(ms) {
  return BigInt(Math.floor(ms - APPLE_EPOCH_MS)) * 1_000_000n;
}

/** Text of newer iMessages lives in a serialized NSAttributedString ("typedstream"). */
export function decodeAttributedBody(blob) {
  if (!blob) return null;
  const b = Buffer.from(blob);
  const i = b.indexOf("NSString");
  if (i < 0) return null;
  let p = i + "NSString".length + 5;
  if (p >= b.length) return null;
  let len = b[p];
  p += 1;
  if (len === 0x81) {
    len = b.readUInt16LE(p);
    p += 2;
  } else if (len === 0x82) {
    len = b.readUInt32LE(p);
    p += 4;
  }
  return b.subarray(p, p + len).toString("utf8");
}

const TEXT_TAPBACK = /^(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked|Reacted .{1,8} to) [“"]/;

// ------------------------------------------------------------- core logic

/**
 * Given one conversation's messages (any order), decide whether it's waiting on you.
 * msg: { fromMe, ts (ms), tapback (bool), text (string|null), read (bool) }
 */
export function computeWaiting(messages, { tapbackCountsAsReply = true } = {}) {
  const sorted = [...messages].sort((a, b) => b.ts - a.ts);
  let unanswered = 0;
  let waitingSince = null;
  let lastIncomingAt = null;
  let question = false;
  let unread = false;
  for (const m of sorted) {
    if (m.fromMe) {
      if (m.tapback && !tapbackCountsAsReply) continue;
      break; // you replied (or reacted) after their last message
    }
    if (m.tapback) continue; // their reaction to your message doesn't need a reply
    unanswered += 1;
    waitingSince = m.ts;
    lastIncomingAt ??= m.ts;
    if (m.text && m.text.includes("?")) question = true;
    if (m.read === false) unread = true;
  }
  if (!unanswered) return null;
  return { unanswered, waitingSince, lastIncomingAt, question, unread };
}

export function normalizeHandle(h) {
  if (!h) return "";
  if (h.includes("@")) return h.trim().toLowerCase();
  const digits = h.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function contactName(r) {
  const full = [r.first, r.last].filter(Boolean).join(" ").trim();
  return full || r.nick || r.org || null;
}

/** Builds handle → name from every local AddressBook database (iCloud, Google, On My Mac...). */
export async function loadContacts() {
  const { DatabaseSync } = await import("node:sqlite");
  const base = path.join(HOME, "Library", "Application Support", "AddressBook");
  const files = [];
  const top = path.join(base, "AddressBook-v22.abcddb");
  if (fs.existsSync(top)) files.push(top);
  const sources = path.join(base, "Sources");
  if (fs.existsSync(sources)) {
    for (const d of fs.readdirSync(sources)) {
      const f = path.join(sources, d, "AddressBook-v22.abcddb");
      if (fs.existsSync(f)) files.push(f);
    }
  }
  const map = new Map();
  for (const file of files) {
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const names = new Map();
      for (const r of db.prepare("SELECT Z_PK AS pk, ZFIRSTNAME AS first, ZLASTNAME AS last, ZNICKNAME AS nick, ZORGANIZATION AS org FROM ZABCDRECORD").all()) {
        const n = contactName(r);
        if (n) names.set(r.pk, n);
      }
      for (const r of db.prepare("SELECT ZOWNER AS pk, ZFULLNUMBER AS v FROM ZABCDPHONENUMBER").all()) {
        if (names.has(r.pk) && r.v) map.set(normalizeHandle(r.v), names.get(r.pk));
      }
      for (const r of db.prepare("SELECT ZOWNER AS pk, ZADDRESS AS v FROM ZABCDEMAILADDRESS").all()) {
        if (names.has(r.pk) && r.v) map.set(normalizeHandle(r.v), names.get(r.pk));
      }
    } catch {
      // A locked or unexpected database shouldn't stop the run.
    } finally {
      db?.close();
    }
  }
  return map;
}

function prettyHandle(h) {
  const d = h.replace(/\D/g, "");
  if (!h.includes("@") && d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (!h.includes("@") && d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return h;
}

/** Reads chat.db (read-only) and returns threads waiting on your reply. Nothing is uploaded here. */
export async function scanIMessage(opts, idKey) {
  const { DatabaseSync } = await import("node:sqlite");
  const chatDb = path.join(HOME, "Library", "Messages", "chat.db");
  const db = new DatabaseSync(chatDb, { readOnly: true });
  const contacts = await loadContacts();
  const since = Date.now() - opts.lookbackDays * 86_400_000;
  try {
    const chats = new Map(db.prepare("SELECT ROWID AS id, guid, chat_identifier AS ident, display_name AS name, style FROM chat").all().map((c) => [c.id, c]));
    const members = new Map();
    for (const r of db.prepare("SELECT chj.chat_id AS chat, h.id AS handle FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id").all()) {
      if (!members.has(r.chat)) members.set(r.chat, []);
      members.get(r.chat).push(r.handle);
    }
    const rows = db
      .prepare(
        // Dates are nanoseconds since 2001 (too big for JS numbers), so convert to ms inside SQLite.
        `SELECT cmj.chat_id AS chat, m.ROWID AS rid, m.is_from_me AS fromMe,
                CASE WHEN m.date > 1000000000000 THEN m.date / 1000000 ELSE m.date * 1000 END AS dateMs,
                m.associated_message_type AS amt,
                m.item_type AS itemType, m.is_read AS isRead, m.text AS text, m.attributedBody AS body
         FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
         WHERE m.date > ? ORDER BY cmj.chat_id, m.date DESC`,
      )
      .all(msToAppleNs(since));

    const byChat = new Map();
    for (const r of rows) {
      if (r.itemType !== 0) continue; // renames, member changes, etc.
      if (!byChat.has(r.chat)) byChat.set(r.chat, []);
      const text = r.text ?? decodeAttributedBody(r.body);
      byChat.get(r.chat).push({
        rid: r.rid,
        fromMe: r.fromMe === 1,
        ts: APPLE_EPOCH_MS + Number(r.dateMs),
        tapback: (r.amt >= 2000 && r.amt < 4000) || (text ? TEXT_TAPBACK.test(text) : false),
        text,
        read: r.isRead === 1,
      });
    }

    const threads = [];
    for (const [chatId, msgs] of byChat) {
      const chat = chats.get(chatId);
      if (!chat) continue;
      const isGroup = chat.style === 43;
      if (isGroup && !opts.includeGroups) continue;
      const ident = chat.ident ?? "";
      if (/^\d{3,6}$/.test(ident) || ident.startsWith("urn:biz:")) continue; // short codes, businesses
      const w = computeWaiting(msgs, opts);
      if (!w) continue;

      let name;
      let handle = null;
      if (isGroup) {
        const people = (members.get(chatId) ?? []).map((h) => contacts.get(normalizeHandle(h))?.split(" ")[0] ?? prettyHandle(h));
        name = chat.name || (people.length > 3 ? `${people.slice(0, 3).join(", ")} +${people.length - 3}` : people.join(", ")) || "Group chat";
      } else {
        handle = ident;
        name = contacts.get(normalizeHandle(ident)) ?? null;
        if (!name && opts.contactsOnly) continue;
        name ??= prettyHandle(ident);
      }
      const newestIncoming = msgs.filter((m) => !m.fromMe && !m.tapback).sort((a, b) => b.ts - a.ts)[0];
      const id = threadId(idKey, `imessage:${chat.guid}`);
      threads.push({
        id,
        state: sha256hex(`${id}:${newestIncoming?.rid ?? w.lastIncomingAt}`),
        name,
        handle,
        isGroup,
        unanswered: w.unanswered,
        waitingSince: new Date(w.waitingSince).toISOString(),
        lastIncomingAt: new Date(w.lastIncomingAt).toISOString(),
        question: w.question,
        unread: w.unread,
      });
    }
    return threads.sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------- Instagram

const fixMojibake = (s) => {
  if (typeof s !== "string") return s;
  try {
    const fixed = Buffer.from(s, "latin1").toString("utf8");
    return fixed.includes("�") ? s : fixed;
  } catch {
    return s;
  }
};

function findInboxDirs(root, depth = 0) {
  if (depth > 5 || !fs.existsSync(root)) return [];
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    if (e.name === "inbox" && path.basename(root) === "messages") out.push(p);
    else out.push(...findInboxDirs(p, depth + 1));
  }
  return out;
}

/** Finds the newest Instagram export (folder or zip) in ~/Downloads, unzipping it locally if needed. */
function locateInstagramExport(cfg) {
  if (cfg.instagram?.exportDir && fs.existsSync(cfg.instagram.exportDir)) return cfg.instagram.exportDir;
  const downloads = path.join(HOME, "Downloads");
  if (!fs.existsSync(downloads)) return null;
  const candidates = fs
    .readdirSync(downloads)
    .filter((n) => /^instagram[-_]/i.test(n))
    .map((n) => ({ n, p: path.join(downloads, n), m: fs.statSync(path.join(downloads, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  const latest = candidates[0];
  if (!latest) return null;
  if (latest.n.toLowerCase().endsWith(".zip")) {
    const dest = path.join(DIR, "instagram", latest.n.replace(/\.zip$/i, ""));
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
      execFileSync("/usr/bin/ditto", ["-x", "-k", latest.p, dest]);
    }
    return dest;
  }
  return latest.p;
}

export function parseInstagramThreads(inboxDirs, { myName, tapbackCountsAsReply = true } = {}) {
  const threads = [];
  const nameCounts = new Map();
  const raw = [];
  for (const inbox of inboxDirs) {
    for (const t of fs.readdirSync(inbox, { withFileTypes: true })) {
      if (!t.isDirectory()) continue;
      const file = path.join(inbox, t.name, "message_1.json");
      if (!fs.existsSync(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const participants = (data.participants ?? []).map((p) => fixMojibake(p.name));
        participants.forEach((n) => nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1));
        raw.push({ key: t.name, title: fixMojibake(data.title), participants, messages: data.messages ?? [] });
      } catch {
        // skip unreadable thread
      }
    }
  }
  // You're the one participant present in (nearly) every thread.
  const me = myName ?? [...nameCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const t of raw) {
    const msgs = t.messages.map((m) => {
      const content = fixMojibake(m.content ?? null);
      return {
        fromMe: fixMojibake(m.sender_name) === me,
        ts: m.timestamp_ms,
        tapback: !!content && /^(Liked a message|Reacted .{1,12} to your message)/.test(content),
        text: content,
        read: true,
      };
    });
    const w = computeWaiting(msgs, { tapbackCountsAsReply });
    if (!w) continue;
    const others = t.participants.filter((p) => p !== me);
    threads.push({ key: t.key, name: t.title || others.join(", ") || "Instagram user", isGroup: others.length > 1, ...w });
  }
  return { me, threads };
}

async function scanInstagramExport(cfg, opts, idKey) {
  const root = locateInstagramExport(cfg);
  if (!root) return null;
  const inboxes = findInboxDirs(root);
  if (!inboxes.length) return null;
  const asOf = fs.statSync(root).mtimeMs;
  const { threads } = parseInstagramThreads(inboxes, { myName: cfg.instagram?.myName, tapbackCountsAsReply: opts.tapbackCountsAsReply });
  const cutoff = asOf - opts.lookbackDays * 86_400_000;
  return {
    asOf: new Date(asOf).toISOString(),
    source: "export",
    threads: threads
      .filter((t) => t.lastIncomingAt >= cutoff && (opts.includeGroups || !t.isGroup))
      .map((t) => {
        const id = threadId(idKey, `instagram:${t.key}`);
        return {
          id,
          state: sha256hex(`${id}:${t.lastIncomingAt}`),
          name: t.name,
          handle: null,
          isGroup: t.isGroup,
          unanswered: t.unanswered,
          waitingSince: new Date(t.waitingSince).toISOString(),
          lastIncomingAt: new Date(t.lastIncomingAt).toISOString(),
          question: t.question,
          unread: false,
        };
      }),
  };
}

/**
 * Instagram API (Instagram professional accounts only). Requests ONLY sender + timestamp
 * fields — message text is never fetched.
 */
async function scanInstagramApi(cfg, opts, idKey) {
  const api = cfg.instagram?.api;
  if (!api?.token) return null;
  const version = api.version ?? "v23.0";
  // Long-lived tokens last 60 days; refresh monthly.
  if (!api.refreshedAt || Date.now() - Date.parse(api.refreshedAt) > 30 * 86_400_000) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(api.token)}`);
    if (r.ok) {
      const j = await r.json();
      api.token = j.access_token;
      api.refreshedAt = new Date().toISOString();
      saveConfig(cfg);
    }
  }
  const meRes = await fetch(`https://graph.instagram.com/${version}/me?fields=username&access_token=${encodeURIComponent(api.token)}`);
  if (!meRes.ok) throw new Error(`Instagram API /me failed (${meRes.status})`);
  const me = (await meRes.json()).username;
  const fields = "participants,updated_time,messages.limit(10){from,created_time}";
  const res = await fetch(`https://graph.instagram.com/${version}/me/conversations?platform=instagram&fields=${encodeURIComponent(fields)}&limit=50&access_token=${encodeURIComponent(api.token)}`);
  if (!res.ok) throw new Error(`Instagram API conversations failed (${res.status})`);
  const convs = (await res.json()).data ?? [];
  const cutoff = Date.now() - opts.lookbackDays * 86_400_000;
  const threads = [];
  for (const c of convs) {
    const msgs = (c.messages?.data ?? []).map((m) => ({ fromMe: m.from?.username === me, ts: Date.parse(m.created_time), tapback: false, text: null, read: true }));
    const w = computeWaiting(msgs, opts);
    if (!w || w.lastIncomingAt < cutoff) continue;
    const others = (c.participants?.data ?? []).filter((p) => p.username !== me).map((p) => p.username);
    if (others.length > 1 && !opts.includeGroups) continue;
    const id = threadId(idKey, `instagram:${c.id}`);
    threads.push({
      id,
      state: sha256hex(`${id}:${w.lastIncomingAt}`),
      name: others.length ? `@${others.join(", @")}` : "Instagram user",
      handle: others[0] ?? null,
      isGroup: others.length > 1,
      unanswered: w.unanswered,
      waitingSince: new Date(w.waitingSince).toISOString(),
      lastIncomingAt: new Date(w.lastIncomingAt).toISOString(),
      question: false,
      unread: false,
    });
  }
  return { asOf: new Date().toISOString(), source: "api", threads };
}

// ------------------------------------------------------------ encryption

export async function deriveKey(passphrase, saltB64, iterations = KDF_ITERATIONS) {
  const material = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return webcrypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(saltB64, "base64"), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPayload(key, obj) {
  const iv = randomBytes(12);
  const ct = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { ciphertext: b64(ct), iv: b64(iv) };
}

// ------------------------------------------------------------- commands

async function fetchServerOptions(cfg) {
  const defaults = { lookbackDays: 14, includeGroups: false, contactsOnly: true, tapbackCountsAsReply: true };
  try {
    const r = await fetch(`${cfg.serverUrl}/api/agent/config`, { headers: { Authorization: `Bearer ${cfg.agentToken}` }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) return { ...defaults, ...(await r.json()).replyQueue };
    if (r.status === 401) throw new Error("Server rejected the agent token. Generate a new one under Settings → Mac agent and run setup again.");
  } catch (err) {
    if (String(err.message).includes("agent token")) throw err;
    log("could not fetch settings from server, using defaults:", err.message);
  }
  return defaults;
}

async function upload(cfg, platform, key, data) {
  const { ciphertext, iv } = await encryptPayload(key, { v: 1, platform, ...data });
  const oldest = data.threads.map((t) => t.waitingSince).sort()[0] ?? null;
  const res = await fetch(`${cfg.serverUrl}/api/agent/ingest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.agentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      platform,
      ciphertext,
      iv,
      salt: cfg.salt,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS },
      waitingCount: data.threads.length,
      oldestWaitAt: oldest,
      generatedAt: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`upload ${platform} failed: ${res.status} ${await res.text()}`);
}

async function run({ dryRun = false } = {}) {
  const cfg = loadConfig();
  if (!cfg) throw new Error("Not set up yet. Run: node apollo-agent.mjs setup");
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1_000_000) fs.truncateSync(LOG, 0);
  } catch {}
  const passphrase = keychainGet() ?? cfg.passphrase;
  if (!passphrase) throw new Error("Passphrase not found in Keychain. Run setup again.");
  const opts = await fetchServerOptions(cfg);
  const key = await deriveKey(passphrase, cfg.salt);
  const idKey = makeIdKey(passphrase, cfg.salt);
  const results = {};

  if (cfg.imessage !== false) {
    try {
      const threads = await scanIMessage(opts, idKey);
      results.imessage = { asOf: new Date().toISOString(), source: "chat.db", threads };
    } catch (err) {
      log(`iMessage scan failed: ${err.message} — if this is a permissions error, give Full Disk Access to ${fs.realpathSync(process.execPath)} (run doctor)`);
    }
  }
  if (cfg.instagram?.enabled !== false) {
    let ig = null;
    try {
      ig = await scanInstagramApi(cfg, opts, idKey);
    } catch (err) {
      log("Instagram API failed, falling back to export:", err.message);
    }
    try {
      ig ??= await scanInstagramExport(cfg, opts, idKey);
    } catch (err) {
      log("Instagram export scan failed:", err.message);
    }
    if (ig) results.instagram = ig;
  }

  for (const [platform, data] of Object.entries(results)) {
    if (dryRun) {
      console.log(`\n${platform} — ${data.threads.length} waiting (as of ${data.asOf}):`);
      for (const t of data.threads) console.log(`  • ${t.name}${t.isGroup ? " (group)" : ""} — ${t.unanswered} msg, since ${t.waitingSince}${t.question ? " ?" : ""}`);
    } else {
      await upload(cfg, platform, key, data);
      log(`uploaded ${platform}: ${data.threads.length} waiting (encrypted)`);
    }
  }
  if (!Object.keys(results).length) log("nothing to upload (no sources available)");
}

async function setup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prev = loadConfig() ?? {};
  console.log("\nApollo — Mac agent setup\n");
  const serverUrl = ((await rl.question(`Dashboard URL${prev.serverUrl ? ` [${prev.serverUrl}]` : ""}: `)) || prev.serverUrl || "").replace(/\/$/, "");
  const agentToken = (await rl.question(`Agent token from Settings → Mac agent${prev.agentToken ? " [keep current]" : ""}: `)) || prev.agentToken;
  console.log("\nChoose an encryption passphrase. You'll type the same passphrase in your browser to see names.");
  console.log("It never leaves your devices. If you lose it, just run setup again with a new one.\n");
  let passphrase = "";
  while (passphrase.length < 10) {
    passphrase = await rl.question("Passphrase (10+ characters): ");
    if (passphrase.length < 10) console.log("Too short.");
  }
  const again = await rl.question("Repeat passphrase: ");
  if (again !== passphrase) {
    rl.close();
    throw new Error("Passphrases didn't match.");
  }
  const igName = await rl.question("Your Instagram display name, exactly as shown on your profile (optional, helps read exports): ");
  rl.close();

  const cfg = {
    ...prev,
    serverUrl,
    agentToken,
    salt: prev.salt ?? b64(randomBytes(16)),
    imessage: prev.imessage ?? true,
    instagram: { enabled: true, ...(prev.instagram ?? {}), ...(igName ? { myName: igName } : {}) },
  };
  delete cfg.passphrase;
  if (!keychainSet(passphrase)) {
    console.log("Couldn't save to Keychain; storing passphrase in the config file (readable only by you).");
    cfg.passphrase = passphrase;
  }
  saveConfig(cfg);
  console.log(`\nSaved ${CONFIG}. Next:\n  node ${path.basename(fileURLToPath(import.meta.url))} doctor\n  node ${path.basename(fileURLToPath(import.meta.url))} run --dry-run\n  node ${path.basename(fileURLToPath(import.meta.url))} install`);
}

function install() {
  const node = fs.realpathSync(process.execPath);
  const script = fs.realpathSync(fileURLToPath(import.meta.url));
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${node}</string><string>--disable-warning=ExperimentalWarning</string><string>${script}</string><string>run</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PLIST, plist);
  const uid = process.getuid();
  try {
    execFileSync("/bin/launchctl", ["bootout", `gui/${uid}`, PLIST], { stdio: "ignore" });
  } catch {}
  execFileSync("/bin/launchctl", ["bootstrap", `gui/${uid}`, PLIST]);
  console.log(`Installed. The agent runs every 10 minutes; logs: ${LOG}`);
  console.log(`\nIMPORTANT: give this Node binary Full Disk Access so it can read Messages:\n  ${node}\nSystem Settings → Privacy & Security → Full Disk Access → + → press ⌘⇧G and paste the path above.`);
}

function uninstall() {
  try {
    execFileSync("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, PLIST], { stdio: "ignore" });
  } catch {}
  if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
  console.log("Uninstalled the background job. Config remains in", DIR);
}

async function doctor() {
  const ok = (b, msg) => console.log(`${b ? "✓" : "✗"} ${msg}`);
  const [maj, min] = process.versions.node.split(".").map(Number);
  ok(maj > 22 || (maj === 22 && min >= 13), `Node ${process.versions.node} (need 22.13+)`);
  const cfg = loadConfig();
  ok(!!cfg, `config at ${CONFIG}`);
  ok(!!(keychainGet() ?? cfg?.passphrase), "passphrase available (Keychain)");
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(HOME, "Library", "Messages", "chat.db"), { readOnly: true });
    const n = db.prepare("SELECT COUNT(*) AS n FROM message").get().n;
    db.close();
    ok(true, `can read Messages (${n} messages)`);
  } catch (err) {
    ok(false, `can't read Messages: ${err.message}\n   → grant Full Disk Access to ${fs.realpathSync(process.execPath)} (and your terminal app for manual runs)`);
  }
  try {
    const contacts = await loadContacts();
    ok(contacts.size > 0, `contacts loaded (${contacts.size} handles)`);
  } catch (err) {
    ok(false, `contacts: ${err.message}`);
  }
  const ig = cfg ? locateInstagramExport(cfg) : null;
  ok(!!ig || !!cfg?.instagram?.api?.token, ig ? `Instagram export found: ${ig}` : cfg?.instagram?.api?.token ? "Instagram API token configured" : "no Instagram export in ~/Downloads (optional)");
  if (cfg?.serverUrl) {
    try {
      const r = await fetch(`${cfg.serverUrl}/api/agent/config`, { headers: { Authorization: `Bearer ${cfg.agentToken}` } });
      ok(r.ok, `server reachable and token accepted (${r.status})`);
    } catch (err) {
      ok(false, `server unreachable: ${err.message}`);
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "setup") await setup();
    else if (cmd === "run") await run({ dryRun: rest.includes("--dry-run") });
    else if (cmd === "install") install();
    else if (cmd === "uninstall") uninstall();
    else if (cmd === "doctor") await doctor();
    else console.log("Usage: node apollo-agent.mjs <setup|run [--dry-run]|install|uninstall|doctor>");
  } catch (err) {
    log("error:", err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
