// Applies db/migrations/*.sql in order. Runs automatically before `next build`,
// so every Vercel deploy brings the database schema up to date.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.warn("[migrate] DATABASE_URL is not set; skipping migrations.");
  process.exit(0);
}

const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url) || url.includes("host=/");
const sql = postgres(url, { prepare: false, max: 1, ssl: isLocal ? false : "require", onnotice: () => {} });

try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`[migrate] applied ${file}`);
  }
  console.log("[migrate] database is up to date");
} catch (err) {
  console.error("[migrate] failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
