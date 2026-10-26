import "server-only";
import postgres from "postgres";
import { env } from "./env";

declare global {
  var __sql: postgres.Sql | undefined;
}

function getSql(): postgres.Sql {
  if (!globalThis.__sql) {
    const url = env.databaseUrl();
    const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url) || url.includes("host=/");
    globalThis.__sql = postgres(url, {
      // Transaction-mode poolers (Supabase :6543, Neon pooled) don't support prepared statements.
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: isLocal ? false : "require",
      onnotice: () => {},
      transform: { undefined: null },
    });
  }
  return globalThis.__sql;
}

/**
 * Shared connection pool, created lazily on first use (so builds don't need a database)
 * and reused across hot reloads and warm serverless invocations.
 */
export const sql: postgres.Sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply(_target, _this, args) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getSql() as any)(...args);
  },
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const real = getSql() as any;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});
