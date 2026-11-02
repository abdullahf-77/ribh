import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GET as status } from "@/app/api/status/route";
import { completeJson, ProviderConfig, readConfig } from "@/llm/provider";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const schema = z.object({ a: z.number() });
const cfg: ProviderConfig = {
  apiKey: "main-key", baseUrl: "http://main.test/v1", model: "meta-llama/llama-4-maverick", timeoutMs: 100, maxAttempts: 2,
  fallback: { apiKey: "backup-key", baseUrl: "http://backup.test/v1", model: "meta-llama/llama-4-scout" },
};
const ok = (model = "meta-llama/llama-4-scout") => new Response(JSON.stringify({ model, choices: [{ message: { content: '{"a":1}' } }] }));
const call = (fetcher: typeof fetch, c = cfg) => completeJson(c, { name: "t", system: "s", user: "u", schema }, fetcher);

/** Answers by host, and records which hosts were called and with which key. */
function hosts(main: () => Response | Promise<Response>, backup: () => Response | Promise<Response> = () => ok()) {
  const calls: { host: string; auth: string; model: string; body: string }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const body = init.body as string;
    const host = url.includes("main.test") ? "main" : "backup";
    calls.push({ host, auth: (init.headers as Record<string, string>).authorization, model: JSON.parse(body).model, body });
    return host === "main" ? main() : backup();
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("fallback host", () => {
  beforeEachSilence();

  it("is not called when the main host works", async () => {
    const { fetcher, calls } = hosts(() => ok("meta-llama/llama-4-maverick"));
    await expect(call(fetcher)).resolves.toEqual({ a: 1 });
    expect(calls.map((c) => c.host)).toEqual(["main"]);
  });

  for (const [label, main] of [
    ["no credits", () => new Response("", { status: 402 })],
    ["a rejected key", () => new Response("", { status: 401 })],
    ["rate limiting", () => new Response("", { status: 429 })],
    ["a server error", () => new Response("", { status: 500 })],
    ["a host-side JSON failure", () => new Response("", { status: 400 })],
    ["malformed output", () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))],
    ["a network failure", () => { throw new TypeError("network"); }],
  ] as [string, () => Response][]) {
    it(`takes over after ${label}, using its own key and model`, async () => {
      const { fetcher, calls } = hosts(main);
      await expect(call(fetcher)).resolves.toEqual({ a: 1 });
      expect(calls.at(-1)?.host).toBe("backup");
      expect(calls.filter((c) => c.host === "backup")).toHaveLength(1);
      expect(calls.at(-1)?.auth).toBe("Bearer backup-key");
      expect(calls.at(-1)?.model).toBe("meta-llama/llama-4-scout");
    });
  }

  it("takes over after a timeout", async () => {
    const hang = ((url: string, init: RequestInit) => url.includes("main.test")
      ? new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))
      : Promise.resolve(ok())) as unknown as typeof fetch;
    await expect(call(hang)).resolves.toEqual({ a: 1 });
  });

  it("never sends either key in a request body", async () => {
    const { fetcher, calls } = hosts(() => new Response("", { status: 402 }));
    await call(fetcher);
    for (const c of calls) { expect(c.body).not.toContain("main-key"); expect(c.body).not.toContain("backup-key"); }
  });

  it("reports the fallback's error when both fail", async () => {
    const { fetcher } = hosts(() => new Response("", { status: 402 }), () => new Response("", { status: 401 }));
    await expect(call(fetcher)).rejects.toMatchObject({ code: "auth" });
  });

  it("refuses a fallback configured with another model family, before calling anything", async () => {
    const { fetcher, calls } = hosts(() => ok());
    await expect(call(fetcher, { ...cfg, fallback: { ...cfg.fallback!, model: "openai/gpt-oss-120b" } })).rejects.toMatchObject({ code: "invalid_model" });
    expect(calls).toEqual([]);
  });

  it("refuses a fallback that answers with another model family", async () => {
    const { fetcher } = hosts(() => new Response("", { status: 402 }), () => ok("qwen/qwen3"));
    await expect(call(fetcher)).rejects.toMatchObject({ code: "wrong_model" });
  });

  it("keeps retrying on the main host when no fallback is set", async () => {
    const { fetcher, calls } = hosts(() => new Response("", { status: 500 }));
    await expect(call(fetcher, { ...cfg, fallback: undefined })).rejects.toMatchObject({ code: "upstream" });
    expect(calls.map((c) => c.host)).toEqual(["main", "main"]);
  });
});

describe("fallback configuration", () => {
  it("is off unless its key is set", () => {
    expect(readConfig({ LLAMA_API_KEY: "k" })?.fallback).toBeUndefined();
    expect(readConfig({ LLAMA_API_KEY: "k", LLAMA_FALLBACK_BASE_URL: "http://x/v1" })?.fallback).toBeUndefined();
  });
  it("reads its own host and model", () => {
    expect(readConfig({ LLAMA_API_KEY: "k", LLAMA_FALLBACK_API_KEY: "b", LLAMA_FALLBACK_BASE_URL: "http://x/v1/", LLAMA_FALLBACK_MODEL: "meta/llama-x" })?.fallback)
      .toEqual({ apiKey: "b", baseUrl: "http://x/v1", model: "meta/llama-x" });
  });
  it("status says whether one is set, without revealing it", async () => {
    vi.stubEnv("LLAMA_API_KEY", "main-key");
    vi.stubEnv("LLAMA_FALLBACK_API_KEY", "backup-key");
    const text = await status().text();
    expect(JSON.parse(text).fallbackConfigured).toBe(true);
    expect(text).not.toContain("key\":\"");
    expect(text).not.toContain("backup-key");
    expect(text).not.toContain("main-key");
  });
});

function beforeEachSilence() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("an explicitly allowed non-Llama main model", () => {
  const groq: ProviderConfig = { ...cfg, model: "qwen/qwen3.8-27b", allowedModels: ["qwen/qwen3.8-27b"], fallback: { ...cfg.fallback!, model: "meta-llama/llama-4-maverick" } };
  const single = (over: Partial<ProviderConfig>) => ({ ...groq, ...over });

  it("is refused unless named by the owner", async () => {
    const { fetcher, calls } = hosts(() => ok("qwen/qwen3.8-27b"));
    await expect(call(fetcher, single({ allowedModels: [] }))).rejects.toMatchObject({ code: "invalid_model" });
    expect(calls).toEqual([]);
  });

  it("works when named, and records which model answered", async () => {
    const c = single({});
    const { fetcher } = hosts(() => ok("qwen/qwen3.8-27b"));
    await call(fetcher, c);
    expect(c.servedModel).toBe("qwen/qwen3.8-27b");
  });

  it("records Llama when the backup answered", async () => {
    const c = single({});
    const { fetcher } = hosts(() => new Response("", { status: 429 }), () => ok("meta-llama/llama-4-maverick"));
    await call(fetcher, c);
    expect(c.servedModel).toBe("meta-llama/llama-4-maverick");
  });

  it("still refuses an answer from some other model", async () => {
    const { fetcher } = hosts(() => ok("openai/gpt-oss-120b"), () => new Response("", { status: 401 }));
    await expect(call(fetcher, single({}))).rejects.toMatchObject({ code: "auth" });
  });

  it("retries a host-side JSON failure on the main host before falling back", async () => {
    let n = 0;
    const { fetcher, calls } = hosts(() => (++n === 1 ? new Response("", { status: 400 }) : ok("qwen/qwen3.8-27b")));
    await call(fetcher, single({}));
    expect(calls.map((c) => c.host)).toEqual(["main", "main"]);
  });

  it("reads the allow-list from the environment", () => {
    expect(readConfig({ LLAMA_API_KEY: "k", LLAMA_EXTRA_ALLOWED_MODELS: "qwen/qwen3.8-27b, x/y" })?.allowedModels).toEqual(["qwen/qwen3.8-27b", "x/y"]);
    expect(readConfig({ LLAMA_API_KEY: "k" })?.allowedModels).toEqual([]);
  });
});

describe("working within a host's rate limits", () => {
  const body = (over: object) => JSON.parse((over as { body: string }).body);
  it("waits the stated short time on the main host before falling back", async () => {
    let n = 0;
    const { fetcher, calls } = hosts(() => (++n === 1 ? new Response("Please try again in 0.01s", { status: 429 }) : ok("meta-llama/llama-4-maverick")));
    await call(fetcher);
    expect(calls.map((c) => c.host)).toEqual(["main", "main"]);
  });
  it("does not wait long, and falls back instead", async () => {
    const { fetcher, calls } = hosts(() => new Response("Please try again in 90s", { status: 429 }));
    const started = Date.now();
    await call(fetcher);
    expect(calls.at(-1)?.host).toBe("backup");
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it("caps output on the main host only", async () => {
    const seen: number[] = [];
    const fetcher = (async (url: string, init: object) => {
      seen.push(body(init).max_tokens);
      return url.includes("main.test") ? new Response("", { status: 402 }) : ok();
    }) as unknown as typeof fetch;
    await completeJson({ ...cfg, maxOutputTokens: 950 }, { name: "t", system: "s", user: "u", schema, maxTokens: 1800 }, fetcher);
    expect(seen).toEqual([950, 1800]);
  });
  it("turns off thinking only for the model that needs it", async () => {
    const reasoning: unknown[] = [];
    const fetcher = (async (_: string, init: object) => { reasoning.push(body(init).reasoning_effort); return ok("qwen/qwen3.8-27b"); }) as unknown as typeof fetch;
    await call(fetcher, { ...cfg, model: "qwen/qwen3.8-27b", allowedModels: ["qwen/qwen3.8-27b"] });
    expect(reasoning).toEqual(["none"]);
    reasoning.length = 0;
    await call(((async (_: string, init: object) => { reasoning.push(body(init).reasoning_effort); return ok("meta-llama/llama-4-maverick"); }) as unknown) as typeof fetch);
    expect(reasoning).toEqual([undefined]);
  });
});

describe("retrying a host-side JSON failure", () => {
  it("varies the temperature, so a retry is not an identical request", async () => {
    const temps: number[] = [];
    let n = 0;
    const fetcher = (async (_: string, init: { body: string }) => {
      temps.push(JSON.parse(init.body).temperature);
      return ++n < 3 ? new Response("", { status: 400 }) : ok("meta-llama/llama-4-maverick");
    }) as unknown as typeof fetch;
    await call(fetcher);
    expect(temps).toEqual([0, 0.2, 0.2]);
  });
});
