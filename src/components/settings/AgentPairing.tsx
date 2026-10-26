"use client";

import { Copy } from "lucide-react";
import { useState, useTransition } from "react";
import { createAgentToken } from "@/app/actions";
import { buttonClass } from "../ui";

export function AgentPairing({ appUrl, paired }: { appUrl: string; paired: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const copy = (s: string) => navigator.clipboard?.writeText(s);
  const cmds = token
    ? [
        "# 1. Download the agent (one file, no dependencies)",
        `mkdir -p ~/apollo-agent && curl -fsSL ${appUrl}/agent/apollo-agent.mjs -o ~/apollo-agent/apollo-agent.mjs`,
        "# 2. Set it up (paste the token below when asked; pick a passphrase)",
        "node ~/apollo-agent/apollo-agent.mjs setup",
        "# 3. Check permissions, preview locally, then run every 10 minutes",
        "node ~/apollo-agent/apollo-agent.mjs doctor",
        "node ~/apollo-agent/apollo-agent.mjs run --dry-run",
        "node ~/apollo-agent/apollo-agent.mjs install",
      ].join("\n")
    : "";
  return (
    <div>
      {!token ? (
        <button
          className={buttonClass.primary}
          disabled={pending}
          onClick={() =>
            (!paired || window.confirm("Generating a new token disconnects the agent that's using the current one. Continue?")) &&
            start(async () => setToken(String((await createAgentToken()).data)))
          }
        >
          {pending ? "Generating…" : paired ? "Generate a new agent token" : "Pair your Mac"}
        </button>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-[13px] font-medium text-ink-2">Agent token (shown once; only a hash is stored)</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs">{token}</code>
              <button className={buttonClass.secondary} onClick={() => copy(token)} aria-label="Copy token">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div>
            <p className="text-[13px] font-medium text-ink-2">Then run this in Terminal on your Mac</p>
            <pre className="scroll-quiet mt-1.5 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink-2">{cmds}</pre>
            <button className={`${buttonClass.ghost} mt-1`} onClick={() => copy(cmds.split("\n").filter((l) => !l.startsWith("#")).join("\n"))}>
              <Copy className="h-3.5 w-3.5" /> Copy commands
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
