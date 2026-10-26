import "server-only";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { courseKey } from "../courses";
import { fetchOk } from "../http";
import { upsertItems } from "../store";
import { upsertSyllabusSource } from "../syllabus";
import type { SourceAdapter, SyncContext, SyncResult } from "./types";

// Watches a course website (e.g. ds100.org, cs61a.org, math54 page) and turns new text
// on the page into an "update" in Class Updates. The agent then summarizes it and pulls out deadlines.

const MAX_SNAPSHOT = 60_000;
// Bump when pageLines output changes, so the next check re-baselines instead of reporting a fake "site changed".
const FORMAT = 2;

export function pageLines(html: string, selector?: string): string[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer, header .navbar").remove();
  // Schedules are usually tables: keep each row on one line ("Week 9 | Tue 10/27 | Lecture 18 | HW 6 due Thu").
  $("tr").each((_, tr) => {
    const cells = $(tr)
      .children("td, th")
      .map((__, c) => $(c).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    $(tr).replaceWith($("<p>").text(cells.join(" | ")));
  });
  const root = selector ? $(selector) : $("main").length ? $("main") : $("body");
  const lines: string[] = [];
  const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, td, th, dt, dd, blockquote, pre, div, table, ul, ol, section, article";
  root.find("h1, h2, h3, h4, h5, h6, p, li, td, th, dt, dd, blockquote, pre, div").each((_, el) => {
    // Only innermost blocks, so each piece of text appears once.
    const node = $(el);
    if (node.find(BLOCKS).length) return;
    const t = node.text().replace(/\s+/g, " ").trim();
    if (t.length >= 3) lines.push(t);
  });
  // De-duplicate consecutive repeats.
  return lines.filter((l, i) => l !== lines[i - 1]);
}

/** Lines present in `next` that weren't in `prev`, in page order. */
export function addedLines(prev: string[], next: string[]): string[] {
  const before = new Set(prev);
  return next.filter((l) => !before.has(l));
}

export const webpage: SourceAdapter = {
  intervalMinutes: 60,
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const url = String(ctx.conn.config.url ?? "");
    if (!/^https?:\/\//i.test(url)) throw new Error("Page URL must start with http(s)://");
    const res = await fetchOk(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Apollo course-page watcher)", Accept: "text/html" },
      timeoutMs: 20_000,
    });
    const lines = pageLines(await res.text(), ctx.conn.config.selector || undefined);
    const snapshot = lines.join("\n").slice(0, MAX_SNAPSHOT);
    if (snapshot.replace(/\s+/g, "").length < 200) {
      throw new Error(
        "This page has almost no text without JavaScript, so it can't be read. Add the course's schedule or syllabus page directly, or upload the schedule under Classes → Syllabi & schedules.",
      );
    }
    const hash = createHash("sha256").update(snapshot).digest("hex");
    const prevHash = ctx.conn.cursor.hash as string | undefined;
    const prevLines = String(ctx.conn.cursor.snapshot ?? "").split("\n");

    let newItems: SyncResult["newItems"] = [];
    if (prevHash && prevHash !== hash && ctx.conn.cursor.format === FORMAT) {
      const added = addedLines(prevLines, snapshot.split("\n"));
      const diffText = added.join("\n").trim();
      // Ignore tiny churn like a changed "last updated" timestamp.
      if (diffText.replace(/\d+/g, "").length >= 25) {
        const course = (ctx.conn.config.course as string | undefined) || courseKey(ctx.conn.label) || null;
        newItems = await upsertItems(ctx.conn.id, [
          {
            source: "webpage",
            kind: "update",
            externalId: hash.slice(0, 24),
            title: `${ctx.conn.label} updated`,
            body: diffText.slice(0, 6000),
            url,
            course,
            occurredAt: ctx.now,
            isClass: true,
            importance: 1,
            aiStatus: ctx.settings.ai.enabled ? "pending" : "skipped",
            aiMeta: { addedLines: added.length },
          },
        ]);
      }
    }
    // Course sites usually carry the schedule; the agent reads the full page for dates whenever it changes.
    if (ctx.conn.config.schedule !== false) {
      await upsertSyllabusSource({
        source: "webpage",
        ref: ctx.conn.id,
        connectionId: ctx.conn.id,
        course: (ctx.conn.config.course as string | undefined) || courseKey(ctx.conn.label) || null,
        title: ctx.conn.label,
        url,
        text: snapshot,
      });
    }
    return {
      newItems,
      counts: { lines: lines.length, changed: prevHash && prevHash !== hash ? 1 : 0 },
      cursor: { hash, snapshot, format: FORMAT, checkedAt: ctx.now.toISOString() },
    };
  },
};
