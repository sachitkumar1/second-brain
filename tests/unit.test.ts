import { describe, expect, it } from "vitest";
import { courseKey, isClassSender } from "@/lib/courses";
import { addDays, daysBetween, fmtDue, inWindow, localDate, zonedToUtc } from "@/lib/time";
import { parseAssignments, parseCourses, parseGsDate } from "@/lib/sources/gradescope";
import { addedLines, pageLines } from "@/lib/sources/webpage";
import { cleanSlackText } from "@/lib/sources/slack";
import { extractBody } from "@/lib/sources/google";

const TZ = "America/Los_Angeles";

describe("time", () => {
  it("converts wall-clock times across DST", () => {
    expect(zonedToUtc("2026-10-28", "23:59", TZ).toISOString()).toBe("2026-10-29T06:59:00.000Z"); // PDT
    expect(zonedToUtc("2026-11-03", "09:30", TZ).toISOString()).toBe("2026-11-03T17:30:00.000Z"); // PST
    expect(zonedToUtc("2026-11-01", "12:00", TZ).toISOString()).toBe("2026-11-01T20:00:00.000Z"); // DST ends that morning
  });
  it("computes local dates and day math", () => {
    expect(localDate(new Date("2026-10-27T06:30:00Z"), TZ)).toBe("2026-10-26");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
  it("handles quiet-hour windows that wrap midnight", () => {
    expect(inWindow(23 * 60 + 30, "23:00", "07:30")).toBe(true);
    expect(inWindow(6 * 60, "23:00", "07:30")).toBe(true);
    expect(inWindow(12 * 60, "23:00", "07:30")).toBe(false);
  });
  it("formats due dates relative to today", () => {
    const now = new Date("2026-10-26T19:00:00Z"); // noon PT Monday
    expect(fmtDue(new Date("2026-10-27T06:59:00Z"), TZ, now)).toBe("Today 11:59 PM");
    expect(fmtDue(new Date("2026-10-28T00:00:00Z"), TZ, now)).toBe("Tomorrow 5:00 PM");
  });
});

describe("courses", () => {
  it("normalizes names from different platforms to one key", () => {
    expect(courseKey("DATA C100 001 - LEC 001")).toBe("DATA 100");
    expect(courseKey("Data 100")).toBe("DATA 100");
    expect(courseKey("COMPSCI 61B - Data Structures")).toBe("CS 61B");
    expect(courseKey("MATH 110: Linear Algebra")).toBe("MATH 110");
    expect(courseKey("STAT C140")).toBe("STAT 140");
    expect(courseKey("Club meeting")).toBeNull();
  });
  it("recognizes class senders", () => {
    expect(isClassSender("Gradescope <no-reply@gradescope.com>")).toBe(true);
    expect(isClassSender("bCourses <notifications@instructure.com>")).toBe(true);
    expect(isClassSender("Pensieve <team@pensieve.co>")).toBe(true);
    expect(isClassSender("Chase <no-reply@chase.com>")).toBe(false);
  });
});

describe("gradescope parsing", () => {
  const account = `<div class="courseList"><div class="courseList--term pageSubheading">Fall 2026</div>
    <div class="courseList--coursesForTerm">
      <a class="courseBox" href="/courses/111"><h3 class="courseBox--shortname">DATA C100</h3><div class="courseBox--name">Principles of Data Science</div></a>
      <a class="courseBox" href="/courses/222"><h3 class="courseBox--shortname">Math 110</h3><div class="courseBox--name">Linear Algebra</div></a>
    </div>
    <div class="courseList--term pageSubheading">Spring 2026</div>
    <div class="courseList--coursesForTerm"><a class="courseBox" href="/courses/999"><h3 class="courseBox--shortname">CS 61B</h3></a></div></div>`;
  it("reads only the current term's courses", () => {
    expect(parseCourses(account).map((c) => c.id)).toEqual(["111", "222"]);
  });
  const course = `<table id="assignments-student-table"><tbody>
    <tr><th class="table--primaryLink"><a href="/courses/111/assignments/5/submissions/9">HW 5</a></th>
      <td class="submissionStatus"><div class="submissionStatus--score">18.0 / 20.0</div></td>
      <td><time class="submissionTimeChart--dueDate" datetime="2026-10-20 23:59:00 -0700">Oct 20</time></td></tr>
    <tr><th class="table--primaryLink"><button class="js-submitAssignment" data-assignment-id="6" data-assignment-title="HW 6">HW 6</button></th>
      <td class="submissionStatus"><div class="submissionStatus--text">No Submission</div></td>
      <td><time class="submissionTimeChart--dueDate" datetime="2026-10-27 23:59:00 -0700">Oct 27</time></td></tr>
  </tbody></table>`;
  it("reads assignments, due dates and scores", () => {
    const a = parseAssignments(course, "111");
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ id: "5", title: "HW 5", submitted: true, score: "18.0 / 20.0" });
    expect(a[1]).toMatchObject({ id: "6", title: "HW 6", submitted: false, score: null });
    expect(a[1].due?.toISOString()).toBe("2026-10-28T06:59:00.000Z");
    expect(parseGsDate("2026-11-03 09:00:00 -0800")?.toISOString()).toBe("2026-11-03T17:00:00.000Z");
  });
});

describe("course website diffs", () => {
  it("reports only new lines", () => {
    const before = pageLines("<main><h2>Week 8</h2><p>Lecture 15 slides</p></main>");
    const after = pageLines("<main><h2>Week 9</h2><p>Lecture 15 slides</p><p>HW 7 released, due Nov 4</p></main>");
    expect(addedLines(before, after)).toEqual(["Week 9", "HW 7 released, due Nov 4"]);
  });
});

describe("slack + gmail text", () => {
  it("cleans Slack markup", () => {
    expect(cleanSlackText("hey <@U1> see <#C9|general> and <https://x.com|this> &amp; <!here>", { U1: "Sachit" })).toBe(
      "hey @Sachit see #general and this & @here",
    );
  });
  it("prefers text/plain parts and ignores attachments", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const body = extractBody({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64("<p>Hi</p>") } }, { mimeType: "text/plain", body: { data: b64("Hi plain") } }] },
        { mimeType: "application/pdf", filename: "a.pdf", body: { data: b64("PDF") } },
      ],
    });
    expect(body).toBe("Hi plain");
  });
});
