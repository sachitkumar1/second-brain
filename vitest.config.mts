import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": r("./src"), "server-only": r("./tests/server-only-stub.ts") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], pool: "forks", fileParallelism: false },
});
