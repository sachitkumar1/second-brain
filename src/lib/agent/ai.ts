import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../env";

// One small interface over two providers:
// - Gemini (GEMINI_API_KEY): has a free tier; the default when its key is set.
// - Claude (ANTHROPIC_API_KEY): paid.
// Set AI_PROVIDER=gemini|anthropic to force one when both keys exist.

export type Provider = "gemini" | "anthropic";
type Effort = "low" | "medium" | "high";
/** Optional file to read alongside the prompt (e.g. a syllabus PDF). */
export type AIDocument = { mimeType: "application/pdf"; base64: string };

export function aiProvider(): Provider | null {
  const forced = env.aiProvider();
  if (forced === "gemini" && env.geminiApiKey()) return "gemini";
  if (forced === "anthropic" && env.anthropicApiKey()) return "anthropic";
  if (env.geminiApiKey()) return "gemini";
  if (env.anthropicApiKey()) return "anthropic";
  return null;
}

export function aiAvailable(): boolean {
  return aiProvider() !== null;
}

/** e.g. "Gemini · gemini-flash-latest", for Settings → System. */
export function aiLabel(): string {
  const p = aiProvider();
  if (p === "gemini") return `Gemini · ${env.geminiModel()}`;
  if (p === "anthropic") return `Claude · ${env.aiModel()}`;
  return "not configured";
}

// ---------------------------------------------------------------- Gemini

let gemini: GoogleGenAI | null = null;
const getGemini = () => (gemini ??= new GoogleGenAI({ apiKey: env.geminiApiKey() }));

function geminiParts(user: string, doc?: AIDocument) {
  return [...(doc ? [{ inlineData: { mimeType: doc.mimeType, data: doc.base64 } }] : []), { text: user }];
}

/** Zod → plain JSON Schema for Gemini, minus keywords it doesn't need (e.g. JS safe-integer bounds). */
export function jsonSchemaFor(schema: z.ZodType): unknown {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema") continue;
      if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) >= Number.MAX_SAFE_INTEGER) continue;
      out[k] = clean(v);
    }
    return out;
  };
  return clean(z.toJSONSchema(schema));
}

/** Pulls a JSON object out of a reply that may be wrapped in ```json fences. */
function parseJsonLoose(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

async function geminiStructured<S extends z.ZodType>(schema: S, system: string, user: string, doc: AIDocument | undefined, timeoutMs: number) {
  const signal = AbortSignal.timeout(timeoutMs);
  const ask = (withSchema: boolean) =>
    getGemini().models.generateContent({
      model: env.geminiModel(),
      contents: [{ role: "user", parts: geminiParts(withSchema ? user : `${user}\n\nReply with only JSON matching this JSON Schema:\n${JSON.stringify(jsonSchemaFor(schema))}`, doc) }],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        ...(withSchema ? { responseJsonSchema: jsonSchemaFor(schema) } : {}),
        maxOutputTokens: 16000,
        abortSignal: signal,
      },
    });
  let res;
  try {
    res = await ask(true);
  } catch (err) {
    // If this model rejects the schema itself, fall back to JSON mode with the schema in the prompt.
    if ((err as { status?: number }).status !== 400) throw err;
    res = await ask(false);
  }
  if (!res.text) return null;
  const parsed = schema.safeParse(parseJsonLoose(res.text));
  return parsed.success ? (parsed.data as z.infer<S>) : null;
}

async function geminiText(system: string, user: string, timeoutMs: number) {
  const res = await getGemini().models.generateContent({
    model: env.geminiModel(),
    contents: [{ role: "user", parts: geminiParts(user) }],
    config: { systemInstruction: system, maxOutputTokens: 8000, abortSignal: AbortSignal.timeout(timeoutMs) },
  });
  return res.text?.trim() || null;
}

// ---------------------------------------------------------------- Claude

let claude: Anthropic | null = null;
const getClaude = () => (claude ??= new Anthropic({ apiKey: env.anthropicApiKey(), maxRetries: 1, timeout: 40_000 }));

function fallbackParams(model: string) {
  // Server-side fallback re-runs a policy-declined request on another model. Haiku has no fallback.
  return model.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const };
}

function claudeContent(user: string, doc?: AIDocument): Anthropic.Beta.BetaContentBlockParam[] {
  return [
    ...(doc ? [{ type: "document" as const, source: { type: "base64" as const, media_type: doc.mimeType, data: doc.base64 } }] : []),
    { type: "text" as const, text: user },
  ];
}

async function claudeStructured<S extends z.ZodType>(schema: S, system: string, user: string, doc: AIDocument | undefined, effort: Effort, timeoutMs: number) {
  const model = env.aiModel();
  const res = await getClaude().beta.messages.parse(
    {
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: claudeContent(user, doc) }],
      output_config: { effort, format: betaZodOutputFormat(schema) },
      ...fallbackParams(model),
    },
    { timeout: timeoutMs, maxRetries: 0 },
  );
  if (res.stop_reason === "refusal") return null;
  return (res.parsed_output ?? null) as z.infer<S> | null;
}

async function claudeText(system: string, user: string, effort: Effort, timeoutMs: number) {
  const model = env.aiModel();
  const res = await getClaude().beta.messages.create(
    {
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort },
      ...fallbackParams(model),
    },
    { timeout: timeoutMs, maxRetries: 0 },
  );
  if (res.stop_reason === "refusal") return null;
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}

// ---------------------------------------------------------------- public API

/** One structured-output call. Returns null when the model declines or the output doesn't fit the schema. */
export async function structuredCall<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  document?: AIDocument;
  effort?: Effort;
  timeoutMs?: number;
}): Promise<z.infer<S> | null> {
  const timeout = opts.timeoutMs ?? 40_000;
  return aiProvider() === "gemini"
    ? geminiStructured(opts.schema, opts.system, opts.user, opts.document, timeout)
    : claudeStructured(opts.schema, opts.system, opts.user, opts.document, opts.effort ?? "low", timeout);
}

/** Plain-text call (used for the morning brief narrative). */
export async function textCall(opts: { system: string; user: string; effort?: Effort; timeoutMs?: number }): Promise<string | null> {
  const timeout = opts.timeoutMs ?? 40_000;
  return aiProvider() === "gemini" ? geminiText(opts.system, opts.user, timeout) : claudeText(opts.system, opts.user, opts.effort ?? "medium", timeout);
}
