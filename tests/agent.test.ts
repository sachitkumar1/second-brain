import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// The agent reads ~/Library/... so point HOME at a temp dir with fake Messages + Contacts databases.
const home = mkdtempSync(path.join(os.tmpdir(), "brain-home-"));
process.env.HOME = home;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agent: any;
const APPLE = 978_307_200_000;
const ns = (ms: number) => BigInt(ms - APPLE) * 1_000_000n;

beforeAll(async () => {
  mkdirSync(path.join(home, "Library", "Messages"), { recursive: true });
  const db = new DatabaseSync(path.join(home, "Library", "Messages", "chat.db"));
  db.exec(`
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT, style INTEGER);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, is_from_me INTEGER, date INTEGER, associated_message_type INTEGER,
      item_type INTEGER, is_read INTEGER, text TEXT, attributedBody BLOB, handle_id INTEGER);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER);
  `);
  const now = Date.now();
  const chats = [
    [1, "iMessage;-;+15105550101", "+15105550101", null, 45], // Alex: waiting (2 unanswered, one is a question)
    [2, "iMessage;-;+15105550102", "+15105550102", null, 45], // Priya: I replied last
    [3, "iMessage;-;+15105550103", "+15105550103", null, 45], // Jordan: I loved their last message
    [4, "iMessage;-;+15105550199", "+15105550199", null, 45], // unknown number (contactsOnly filters)
    [5, "iMessage;-;chat123", "chat123", "Data 100 study group", 43], // group (excluded by default)
    [6, "SMS;-;72975", "72975", null, 45], // short code
  ];
  for (const c of chats) db.prepare("INSERT INTO chat VALUES (?,?,?,?,?)").run(...c);
  let rid = 0;
  const msg = (chat: number, fromMe: number, minsAgo: number, text: string | null, amt = 0, read = 1, body: Buffer | null = null) => {
    rid++;
    db.prepare("INSERT INTO message VALUES (?,?,?,?,?,?,?,?,?)").run(rid, fromMe, ns(now - minsAgo * 60_000), amt, 0, read, text, body, 0);
    db.prepare("INSERT INTO chat_message_join VALUES (?,?,?)").run(chat, rid, ns(now - minsAgo * 60_000));
  };
  // typedstream-ish attributedBody holding "are you free tonight?"
  const t = Buffer.from("are you free tonight?");
  const attributed = Buffer.concat([Buffer.from("streamtyped\x81\xe8\x03\x84\x01@NSString"), Buffer.from([1, 0x94, 0x84, 1, 0x2b, t.length]), t]);
  msg(1, 1, 300, "hey!");
  msg(1, 0, 120, "did you finish hw5");
  msg(1, 0, 60, null, 0, 0, attributed);
  msg(2, 0, 200, "lunch tomorrow?");
  msg(2, 1, 100, "yes!");
  msg(3, 0, 90, "I got the internship");
  msg(3, 1, 80, null, 2000); // my "loved" tapback
  msg(4, 0, 30, "who is this");
  msg(5, 0, 20, "meeting at 5?");
  msg(6, 0, 10, "Your code is 123456");
  db.close();

  // Contacts
  const abDir = path.join(home, "Library", "Application Support", "AddressBook", "Sources", "ABC");
  mkdirSync(abDir, { recursive: true });
  const ab = new DatabaseSync(path.join(abDir, "AddressBook-v22.abcddb"));
  ab.exec(`CREATE TABLE ZABCDRECORD (Z_PK INTEGER PRIMARY KEY, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZNICKNAME TEXT, ZORGANIZATION TEXT);
           CREATE TABLE ZABCDPHONENUMBER (ZOWNER INTEGER, ZFULLNUMBER TEXT);
           CREATE TABLE ZABCDEMAILADDRESS (ZOWNER INTEGER, ZADDRESS TEXT);`);
  ab.prepare("INSERT INTO ZABCDRECORD VALUES (1,'Alex','Chen',NULL,NULL),(2,'Priya','Shah',NULL,NULL),(3,'Jordan',NULL,NULL,NULL)").run();
  ab.prepare("INSERT INTO ZABCDPHONENUMBER VALUES (1,'(510) 555-0101'),(2,'+1 510 555 0102'),(3,'510.555.0103')").run();
  ab.close();

  agent = await import("../agent/apollo-agent.mjs");
});

describe("computeWaiting", () => {
  it("counts consecutive incoming messages after your last reply", () => {
    const r = agent.computeWaiting([
      { fromMe: true, ts: 1, tapback: false, text: "hi", read: true },
      { fromMe: false, ts: 2, tapback: false, text: "ok", read: true },
      { fromMe: false, ts: 3, tapback: false, text: "you there?", read: false },
    ]);
    expect(r).toMatchObject({ unanswered: 2, waitingSince: 2, lastIncomingAt: 3, question: true, unread: true });
  });
  it("treats your tapback as a reply unless disabled", () => {
    const msgs = [
      { fromMe: false, ts: 1, tapback: false, text: "news!", read: true },
      { fromMe: true, ts: 2, tapback: true, text: null, read: true },
    ];
    expect(agent.computeWaiting(msgs)).toBeNull();
    expect(agent.computeWaiting(msgs, { tapbackCountsAsReply: false })).toMatchObject({ unanswered: 1 });
  });
  it("ignores their reactions to your message", () => {
    const msgs = [
      { fromMe: true, ts: 1, tapback: false, text: "see you", read: true },
      { fromMe: false, ts: 2, tapback: true, text: null, read: true },
    ];
    expect(agent.computeWaiting(msgs)).toBeNull();
  });
});

describe("scanIMessage", () => {
  it("finds only the 1:1 contacts waiting on a reply", async () => {
    const idKey = agent.makeIdKey("correct horse battery", "c2FsdA==");
    const threads = await agent.scanIMessage({ lookbackDays: 14, includeGroups: false, contactsOnly: true, tapbackCountsAsReply: true }, idKey);
    expect(threads.map((t: { name: string }) => t.name)).toEqual(["Alex Chen"]);
    expect(threads[0]).toMatchObject({ unanswered: 2, question: true, unread: true, isGroup: false, handle: "+15105550101" });
    expect(threads[0].id).toMatch(/^[0-9a-f]{64}$/);
  });
  it("includes groups and unknown numbers when asked", async () => {
    const idKey = agent.makeIdKey("x", "y");
    const threads = await agent.scanIMessage({ lookbackDays: 14, includeGroups: true, contactsOnly: false, tapbackCountsAsReply: true }, idKey);
    const names = threads.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["(510) 555-0199", "Alex Chen", "Data 100 study group"]);
  });
});

describe("decodeAttributedBody", () => {
  it("extracts text from a typedstream blob", () => {
    const t = Buffer.from("hello there");
    const blob = Buffer.concat([Buffer.from("xxNSString"), Buffer.from([1, 2, 3, 4, 5, t.length]), t, Buffer.from("trailing")]);
    expect(agent.decodeAttributedBody(blob)).toBe("hello there");
  });
});

describe("Instagram export", () => {
  it("finds threads where the other person spoke last and fixes mojibake", () => {
    const inbox = path.join(home, "ig", "your_instagram_activity", "messages", "inbox");
    const mk = (dir: string, data: unknown) => {
      mkdirSync(path.join(inbox, dir), { recursive: true });
      writeFileSync(path.join(inbox, dir, "message_1.json"), JSON.stringify(data));
    };
    const mojibake = Buffer.from("Zoë ✨", "utf8").toString("latin1");
    mk("zoe_123", {
      title: mojibake,
      participants: [{ name: mojibake }, { name: "Sachit Kumar" }],
      messages: [
        { sender_name: mojibake, timestamp_ms: 3000, content: "did u see this" },
        { sender_name: "Sachit Kumar", timestamp_ms: 2000, content: "lol" },
      ],
    });
    mk("sam_456", {
      title: "Sam",
      participants: [{ name: "Sam" }, { name: "Sachit Kumar" }],
      messages: [
        { sender_name: "Sachit Kumar", timestamp_ms: 5000, content: "sounds good" },
        { sender_name: "Sam", timestamp_ms: 4000, content: "tmrw?" },
      ],
    });
    const { me, threads } = agent.parseInstagramThreads([inbox], {});
    expect(me).toBe("Sachit Kumar");
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ name: "Zoë ✨", unanswered: 1 });
  });
});

describe("encryption", () => {
  it("round-trips with the browser's WebCrypto decrypt", async () => {
    const salt = Buffer.from("0123456789abcdef").toString("base64");
    const key = await agent.deriveKey("my long passphrase", salt, 100_000);
    const { ciphertext, iv } = await agent.encryptPayload(key, { threads: [{ name: "Alex" }] });
    const pt = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64") }, key, Buffer.from(ciphertext, "base64"));
    expect(JSON.parse(new TextDecoder().decode(pt))).toEqual({ threads: [{ name: "Alex" }] });
    const wrong = await agent.deriveKey("wrong passphrase!!", salt, 100_000);
    await expect(webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64") }, wrong, Buffer.from(ciphertext, "base64"))).rejects.toThrow();
  });
});
