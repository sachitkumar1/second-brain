// Publishes the Mac agent at /agent/apollo-agent.mjs so you can curl it onto your Mac.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/agent", { recursive: true });
copyFileSync("agent/apollo-agent.mjs", "public/agent/apollo-agent.mjs");
