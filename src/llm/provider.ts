import { z } from "zod";

/* The only module that knows how to talk to the model host. Any OpenAI-compatible endpoint serving
   Llama works; the model name is checked so another family can never be substituted by accident. */

export type ProviderConfig = { apiKey: string; baseUrl: string; model: string; timeoutMs: number; maxAttempts: number };

export type LlmErrorCode = "not_configured" | "invalid_model" | "timeout" | "rate_limited" | "upstream" | "malformed" | "wrong_model";
export class LlmError extends Error {
  constructor(public code: LlmErrorCode) { super(code); }
}

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "meta-llama/llama-4-maverick";

export function readConfig(env: Record<string, string | undefined> = process.env): ProviderConfig | null {
  const apiKey = env.LLAMA_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.LLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ""),
    model: env.LLAMA_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.LLAMA_TIMEOUT_MS) || 40_000,
    maxAttempts: Number(env.LLAMA_MAX_ATTEMPTS) || 2,
  };
}

export const isLlamaModel = (model: string) => /llama/i.test(model);

type Fetcher = typeof fetch;

export type CompletionRequest<T> = {
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
};

const CodeFence = /^```(?:json)?\s*|\s*```$/g;

/**
 * Sends one structured request. Retries a bounded number of times on malformed output, rate limits and
 * server errors. Offer text is never logged, and provider bodies are never surfaced to the caller.
 */
export async function completeJson<T>(cfg: ProviderConfig, req: CompletionRequest<T>, fetcher: Fetcher = fetch): Promise<T> {
  if (!isLlamaModel(cfg.model)) throw new LlmError("invalid_model");
  const jsonSchema = z.toJSONSchema(req.schema);
  delete (jsonSchema as Record<string, unknown>).$schema;

  let lastError: LlmError = new LlmError("upstream");
  let repairNote = "";

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
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
          temperature: 0,
          max_tokens: req.maxTokens ?? 3000,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user + repairNote },
          ],
          response_format: { type: "json_schema", json_schema: { name: req.name, strict: true, schema: jsonSchema } },
          // OpenRouter: only route to hosts that honor the schema, and never fall back to another model.
          ...(cfg.baseUrl.includes("openrouter.ai") ? { provider: { require_parameters: true }, models: undefined } : {}),
        }),
      });
      if (res.status === 429) { lastError = new LlmError("rate_limited"); continue; }
      if (res.status >= 500) { lastError = new LlmError("upstream"); continue; }
      if (!res.ok) throw new LlmError("upstream");

      const body = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
      if (body.model && !isLlamaModel(body.model)) throw new LlmError("wrong_model");
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
