import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../env";

let client: Anthropic | null = null;

export function aiAvailable(): boolean {
  return !!env.anthropicApiKey();
}

function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: env.anthropicApiKey(), maxRetries: 1, timeout: 40_000 });
  return client;
}

type Effort = "low" | "medium" | "high";

function fallbackParams(model: string) {
  // Server-side fallback re-runs a policy-declined request on another model. Haiku has no fallback.
  return model.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const };
}

/** One structured-output call. Returns null when the model declines or output can't be parsed. */
export async function structuredCall<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  effort?: Effort;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<z.infer<S> | null> {
  const model = env.aiModel();
  const res = await getClient().beta.messages.parse(
    {
    model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
      ...fallbackParams(model),
    },
    opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined,
  );
  if (res.stop_reason === "refusal") return null;
  return (res.parsed_output ?? null) as z.infer<S> | null;
}

/** Plain-text call (used for the morning brief narrative). */
export async function textCall(opts: { system: string; user: string; effort?: Effort; maxTokens?: number; timeoutMs?: number }): Promise<string | null> {
  const model = env.aiModel();
  const res = await getClient().beta.messages.create(
    {
      model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort ?? "medium" },
      ...fallbackParams(model),
    },
    opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined,
  );
  if (res.stop_reason === "refusal") return null;
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}
