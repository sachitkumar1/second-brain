// Course names arrive in many shapes: "DATA C100 001 - LEC 001" (Canvas), "Data 100" (Gradescope),
// "DATA C100 – Fall 2026" (Ed). Normalize them to one key like "DATA 100" so everything lines up.

const DEPT_ALIASES: Record<string, string> = {
  COMPSCI: "CS",
  "COMP SCI": "CS",
  "COMPUTER SCIENCE": "CS",
  ELENG: "EE",
  "EL ENG": "EE",
  STATISTICS: "STAT",
  MATHEMATICS: "MATH",
  ECONOMICS: "ECON",
  "DATA SCI": "DATA",
  DATASCI: "DATA",
  INDENG: "IEOR",
  "IND ENG": "IEOR",
  PHYSICS: "PHYSICS",
  UGBA: "UGBA",
};

const COURSE_RE =
  /\b(COMPSCI|COMP SCI|DATA SCI|DATASCI|DATA|CS|EECS|EE|EL ENG|ELENG|STAT(?:ISTICS)?|MATH(?:EMATICS)?|ECON(?:OMICS)?|IND ENG|INDENG|IEOR|PHYSICS|CHEM|BIOLOGY|BIO|UGBA|INFO|COGSCI|PSYCH|POLSCI|HISTORY|ENGLISH|MCB|L ?& ?S|PHILOS|ASTRON|ENGIN|NUSCTX|PUBPOL|GEOG|ESPM|SOCIOL|LINGUIS|MUSIC|ART|R1B|ANTHRO)\s*-?\s*(C?\d{1,3}[A-Z]{0,2})\b/i;

export function courseKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = COURSE_RE.exec(raw.toUpperCase().replace(/[_]/g, " "));
  if (!m) return null;
  const dept = DEPT_ALIASES[m[1].toUpperCase()] ?? m[1].toUpperCase().replace(/\s+/g, " ");
  // Cross-listed courses carry a "C" prefix (DATA C100 == DATA 100); drop it so they match.
  const num = m[2].toUpperCase().replace(/^C(?=\d)/, "");
  return `${dept} ${num}`;
}

/** Display label for a course: alias if configured, else normalized key, else trimmed raw name. */
export function courseLabel(raw: string | null | undefined, aliases: Record<string, string> = {}): string | null {
  if (!raw) return null;
  const key = courseKey(raw);
  if (key && aliases[key]) return aliases[key];
  if (aliases[raw]) return aliases[raw];
  return key ?? raw.trim().slice(0, 40);
}

const PALETTE = ["#2563eb", "#0d9488", "#c2410c", "#7c3aed", "#be123c", "#0369a1", "#4d7c0f", "#a16207"];

export function courseColor(key: string | null | undefined): string {
  if (!key) return "#64748b";
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Senders whose mail is class-related even when it doesn't name a course. */
export const CLASS_SENDER_DOMAINS = [
  "instructure.com",
  "bcourses.berkeley.edu",
  "gradescope.com",
  "edstem.org",
  "pensieve.co",
  "piazza.com",
  "prairielearn.com",
  "prairielearn.org",
  "calcentral.berkeley.edu",
  "registrar.berkeley.edu",
  "eecs.berkeley.edu",
  "datascience.berkeley.edu",
  "cdss.berkeley.edu",
  "math.berkeley.edu",
  "stat.berkeley.edu",
];

export function isClassSender(from: string | null | undefined): boolean {
  if (!from) return false;
  const f = from.toLowerCase();
  return CLASS_SENDER_DOMAINS.some((d) => f.includes(`@${d}`) || f.includes(`.${d}`));
}
