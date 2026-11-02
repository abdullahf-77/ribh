import { z } from "zod";

/* The only module that knows how to talk to the model host. Any OpenAI-compatible endpoint works. Models are
   checked: Llama, or one the owner named in LLAMA_EXTRA_ALLOWED_MODELS, so nothing is substituted by accident. */

export type ProviderConfig = {
  apiKey: string; baseUrl: string; model: string; timeoutMs: number; maxAttempts: number; hostOrder?: string[];
  /** A second Llama host, used only after the first one fails. */
  fallback?: { apiKey: string; baseUrl: string; model: string };
  /** Non-Llama models the owner explicitly allowed. */
  allowedModels?: string[];
  /** Caps output on the main host, for hosts that refuse requests above a per-minute output limit. */
  maxOutputTokens?: number;
  /** The model that actually answered last, so replies are never labelled with the wrong one. */
  servedModel?: string;
};

export type LlmErrorCode = "insufficient_credits" | "auth" | "not_configured" |"invalid_model" | "timeout" | "rate_limited" | "upstream" | "malformed" | "wrong_model";
export class LlmError extends Error {
  constructor(public code: LlmErrorCode) { super(code); }
}

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "meta-llama/llama-4-maverick";

export function readConfig(env: Record<string, string | undefined> = process.env): ProviderConfig | null {
  const apiKey = env.LLAMA_API_KEY?.trim();
  if (!apiKey) return null;
  const fallbackKey = env.LLAMA_FALLBACK_API_KEY?.trim();
  return {
    maxOutputTokens: Number(env.LLAMA_MAX_OUTPUT_TOKENS) || undefined,
    allowedModels: (env.LLAMA_EXTRA_ALLOWED_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean),
    ...(fallbackKey ? {
      fallback: {
        apiKey: fallbackKey,
        baseUrl: (env.LLAMA_FALLBACK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ""),
        model: env.LLAMA_FALLBACK_MODEL?.trim() || DEFAULT_MODEL,
      },
    } : {}),
    apiKey,
    baseUrl: (env.LLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ""),
    model: env.LLAMA_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.LLAMA_TIMEOUT_MS) || 30_000,
    maxAttempts: Number(env.LLAMA_MAX_ATTEMPTS) || 2,
    // Measured 2026-11-01: Parasail about 10s per offer, the default route about 66s, for the same model.
    hostOrder: (env.LLAMA_HOST_ORDER ?? "parasail").split(",").map((h) => h.trim()).filter(Boolean),
  };
}

export const isLlamaModel = (model: string) => /llama/i.test(model);
const isAllowed = (cfg: ProviderConfig, model: string) => isLlamaModel(model) || !!cfg.allowedModels?.some((m) => model === m || model.startsWith(`${m}-`));

type Fetcher = typeof fetch;

export type CompletionRequest<T> = {
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
};

const MAX_RATE_WAIT_SECONDS = 50;
const CodeFence = /^```(?:json)?\s*|\s*```$/g;

/**
 * Sends one structured request to the main host, then to the fallback host if that fails for any reason.
 * Both must serve an allowed model: anything else is refused, never used as a backup.
 */
export async function completeJson<T>(cfg: ProviderConfig, req: CompletionRequest<T>, fetcher: Fetcher = fetch): Promise<T> {
  if (!isAllowed(cfg, cfg.model)) throw new LlmError("invalid_model");
  const { fallback } = cfg;
  if (fallback && !isAllowed(cfg, fallback.model)) throw new LlmError("invalid_model");
  try {
    const out = await completeOnHost(cfg, req, fetcher);
    cfg.servedModel = cfg.model;
    return out;
  } catch (e) {
    if (!fallback) throw e;
    console.warn("main host failed, trying fallback:", e instanceof LlmError ? e.code : "error");
    // One attempt, so the whole request stays inside the route limit.
    const out = await completeOnHost({ ...cfg, ...fallback, maxAttempts: 1, maxOutputTokens: undefined }, req, fetcher);
    cfg.servedModel = fallback.model;
    return out;
  }
}

/**
 * Retries a bounded number of times on malformed output, rate limits and server errors.
 * Offer text is never logged, and provider bodies are never surfaced to the caller.
 */
async function completeOnHost<T>(cfg: ProviderConfig, req: CompletionRequest<T>, fetcher: Fetcher): Promise<T> {
  const jsonSchema = z.toJSONSchema(req.schema);
  delete (jsonSchema as Record<string, unknown>).$schema;

  let lastError: LlmError = new LlmError("upstream");
  let repairNote = "";

  let attempts = cfg.maxAttempts;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, cfg.timeoutMs < 1000 ? 1 : 400 * attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetcher(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          // The same input at temperature 0 repeats the same failure, so a retry varies slightly.
          temperature: attempt === 1 ? 0 : 0.2,
          max_tokens: Math.min(req.maxTokens ?? 3000, cfg.maxOutputTokens ?? Infinity),
          // Thinking output would count against the same per-minute limit and is never shown.
          ...(/qwen/i.test(cfg.model) ? { reasoning_effort: "none" } : {}),
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user + repairNote },
          ],
          response_format: { type: "json_schema", json_schema: { name: req.name, strict: true, schema: jsonSchema } },
          // OpenRouter: try the fastest measured host first, then other hosts of this same model. Never another model.
          ...(cfg.baseUrl.includes("openrouter.ai") ? { provider: { require_parameters: true, ...(cfg.hostOrder?.length ? { order: cfg.hostOrder } : {}) } } : {}),
        }),
      });
      if (res.status === 429) {
        lastError = new LlmError("rate_limited");
        // Per-minute limits clear within seconds, so a stated short wait beats leaving this host.
        const stated = Number(res.headers.get("retry-after")) || Number(/try again in ([\d.]+)s/.exec(await res.text())?.[1]);
        if (cfg.maxAttempts > 1 && stated > 0 && stated <= MAX_RATE_WAIT_SECONDS) {
          attempts = Math.max(attempts, 4);
          if (attempt < attempts) await new Promise((r) => setTimeout(r, stated * 1000 + 250));
        }
        continue;
      }
      // Some hosts return 400 when the model failed to produce valid JSON. That is worth another attempt.
      if (res.status === 400) { lastError = new LlmError("malformed"); if (cfg.maxAttempts > 1) attempts = Math.max(attempts, 3); continue; }
      if (res.status >= 500) { lastError = new LlmError("upstream"); continue; }
      if (res.status === 402) throw new LlmError("insufficient_credits");
      if (res.status === 401 || res.status === 403) throw new LlmError("auth");
      if (!res.ok) throw new LlmError("upstream");

      const body = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
      if (body.model && !isAllowed(cfg, body.model)) throw new LlmError("wrong_model");
      const content = body.choices?.[0]?.message?.content;
      if (!content) { lastError = new LlmError("malformed"); continue; }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content.trim().replace(CodeFence, ""));
      } catch {
        lastError = new LlmError("malformed");
        repairNote = "\n\nالمحاولة السابقة لم تكن JSON صالحًا. أعد الإجابة بـ JSON فقط وفق المخطط.";
        continue;
      }
      const result = req.schema.safeParse(parsed);
      if (result.success) return result.data;
      lastError = new LlmError("malformed");
      repairNote = "\n\nالمحاولة السابقة خالفت المخطط. التزم بكل الحقول وأنواعها.";
    } catch (e) {
      if (e instanceof LlmError) throw e;
      lastError = new LlmError((e as Error).name === "AbortError" ? "timeout" : "upstream");
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
