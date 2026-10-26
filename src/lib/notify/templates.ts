// Email-safe HTML (tables + inline styles) with a matching plain-text version.

export const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const C = {
  bg: "#f4f5f7",
  card: "#ffffff",
  ink: "#0e1726",
  muted: "#5b6576",
  line: "#e4e7ec",
  navy: "#003262",
  gold: "#fdb515",
  red: "#b42318",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type EmailRow = {
  title: string;
  meta?: string;
  url?: string | null;
  color?: string | null;
  badge?: { text: string; tone?: "red" | "navy" | "muted" };
  links?: { label: string; href: string }[];
  note?: string | null;
};

export type EmailSection = { title: string; rows: EmailRow[]; empty?: string };

export type Built = { html: string; text: string };

function rowHtml(r: EmailRow): string {
  const title = r.url ? `<a href="${esc(r.url)}" style="color:${C.ink};text-decoration:none;font-weight:600">${esc(r.title)}</a>` : `<span style="font-weight:600">${esc(r.title)}</span>`;
  const badgeColor = r.badge?.tone === "red" ? C.red : r.badge?.tone === "navy" ? C.navy : C.muted;
  const badge = r.badge
    ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border:1px solid ${badgeColor};border-radius:10px;color:${badgeColor};font-size:11px;font-weight:600">${esc(r.badge.text)}</span>`
    : "";
  const links = r.links?.length
    ? `<div style="margin-top:6px">${r.links
        .map((l) => `<a href="${esc(l.href)}" style="color:${C.navy};font-size:12px;text-decoration:none;margin-right:14px">${esc(l.label)}</a>`)
        .join("")}</div>`
    : "";
  const note = r.note ? `<div style="color:${C.muted};font-size:13px;margin-top:3px;line-height:1.45">${esc(r.note)}</div>` : "";
  return `<tr><td style="padding:10px 0;border-top:1px solid ${C.line}">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      <td width="4" style="background:${esc(r.color ?? C.line)};border-radius:2px"></td>
      <td style="padding-left:12px;font-family:${FONT};font-size:14px;color:${C.ink};line-height:1.4">
        ${title}${badge}
        ${r.meta ? `<div style="color:${C.muted};font-size:12px;margin-top:2px">${esc(r.meta)}</div>` : ""}
        ${note}${links}
      </td></tr></table>
  </td></tr>`;
}

export function buildEmail(opts: {
  preheader: string;
  heading: string;
  subheading?: string;
  intro?: string | null;
  sections: EmailSection[];
  footer: { label: string; href: string }[];
}): Built {
  const sectionsHtml = opts.sections
    .filter((s) => s.rows.length || s.empty)
    .map(
      (s) => `<tr><td style="padding:22px 0 4px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.04em;color:${C.navy};text-transform:uppercase">${esc(s.title)}${
        s.rows.length ? ` <span style="color:${C.muted};font-weight:600">· ${s.rows.length}</span>` : ""
      }</td></tr>
      ${s.rows.length ? s.rows.map(rowHtml).join("") : `<tr><td style="padding:8px 0;color:${C.muted};font-family:${FONT};font-size:13px;border-top:1px solid ${C.line}">${esc(s.empty)}</td></tr>`}`,
    )
    .join("");

  const intro = opts.intro
    ? `<tr><td style="padding:16px 18px;background:#f8f9fb;border-left:3px solid ${C.gold};border-radius:6px;font-family:${FONT};font-size:14px;line-height:1.55;color:${C.ink}">${esc(opts.intro)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => (l.startsWith("- ") || l.startsWith("• ") ? `<div style="padding-left:12px;text-indent:-10px">• ${l.slice(2)}</div>` : `<div style="margin-bottom:6px">${l}</div>`))
        .join("")}</td></tr>`
    : "";

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:12px">
    <tr><td style="padding:22px 24px 6px">
      <div style="font-family:${FONT};font-size:12px;color:${C.muted};font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${C.gold};margin-right:6px"></span>Apollo</div>
      <div style="font-family:${FONT};font-size:22px;font-weight:700;color:${C.ink};margin-top:8px">${esc(opts.heading)}</div>
      ${opts.subheading ? `<div style="font-family:${FONT};font-size:14px;color:${C.muted};margin-top:4px">${esc(opts.subheading)}</div>` : ""}
    </td></tr>
    <tr><td style="padding:12px 24px 24px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${intro}${sectionsHtml}
    </table></td></tr>
  </table>
  <div style="font-family:${FONT};font-size:12px;color:${C.muted};padding:14px">
    ${opts.footer.map((f) => `<a href="${esc(f.href)}" style="color:${C.muted};margin:0 8px">${esc(f.label)}</a>`).join("")}
  </div>
</td></tr></table></body></html>`;

  const textParts: string[] = [opts.heading, opts.subheading ?? "", ""];
  if (opts.intro) textParts.push(opts.intro, "");
  for (const s of opts.sections) {
    if (!s.rows.length && !s.empty) continue;
    textParts.push(`== ${s.title.toUpperCase()} ==`);
    if (!s.rows.length) textParts.push(s.empty ?? "");
    for (const r of s.rows) {
      textParts.push(`• ${r.title}${r.badge ? ` [${r.badge.text}]` : ""}${r.meta ? ` — ${r.meta}` : ""}`);
      if (r.note) textParts.push(`  ${r.note}`);
      if (r.url) textParts.push(`  ${r.url}`);
      for (const l of r.links ?? []) textParts.push(`  ${l.label}: ${l.href}`);
    }
    textParts.push("");
  }
  textParts.push(opts.footer.map((f) => `${f.label}: ${f.href}`).join("\n"));
  return { html, text: textParts.join("\n") };
}
