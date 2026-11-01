import { NextResponse } from "next/server";
import { z } from "zod";
import { LlmError } from "@/llm/provider";
import { DemoUnavailable } from "@/llm/service";

/* Shared by all routes: size limit, input validation, rate limit, and safe error messages.
   Request bodies are never logged. */

const MESSAGES: Record<string, { status: number; message: string }> = {
  invalid_input: { status: 400, message: "راجع المدخلات: بعض الحقول فارغة أو طويلة جدًا." },
  too_large: { status: 413, message: "النص طويل جدًا. اختصره ثم أعد المحاولة." },
  demo_unavailable: { status: 409, message: "وضع التجربة يحلل الأمثلة الجاهزة فقط. لتحليل نص آخر يلزم تفعيل Llama." },
  rate_limited: { status: 429, message: "الخدمة مشغولة الآن. انتظر دقيقة ثم أعد المحاولة." },
  rate_limited_local: { status: 429, message: "طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة." },
  timeout: { status: 504, message: "تأخر رد التحليل. أعد المحاولة، وإن تكرر فاختصر النص." },
  malformed: { status: 502, message: "لم نحصل على نتيجة صالحة من التحليل. أعد المحاولة أو أدخل البيانات يدويًا." },
  upstream: { status: 502, message: "تعذر الوصول إلى خدمة التحليل. أعد المحاولة بعد قليل." },
  invalid_model: { status: 500, message: "إعداد النموذج غير صحيح. يجب أن يكون نموذج Llama." },
  wrong_model: { status: 502, message: "رُفضت النتيجة لأنها لم تصدر عن نموذج Llama." },
  internal: { status: 500, message: "حدث خطأ غير متوقع. أعد المحاولة." },
};

export const fail = (code: keyof typeof MESSAGES) => {
  const { status, message } = MESSAGES[code];
  return NextResponse.json({ error: { code, message } }, { status });
};

const MAX_BODY = 200_000;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;
const hits = new Map<string, number[]>();

/** Best-effort per-instance limiter so a public deployment cannot drain the model budget in one burst. */
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

export function handle<T>(schema: z.ZodType<T>, run: (input: T) => Promise<unknown>) {
  return async (req: Request) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (limited(ip)) return fail("rate_limited_local");
    const raw = await req.text();
    if (raw.length > MAX_BODY) return fail("too_large");
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return fail("invalid_input"); }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return fail("invalid_input");
    try {
      return NextResponse.json(await run(parsed.data));
    } catch (e) {
      if (e instanceof DemoUnavailable) return fail("demo_unavailable");
      if (e instanceof LlmError) return fail(e.code === "not_configured" ? "upstream" : e.code);
      console.error("request failed:", (e as Error).name);
      return fail("internal");
    }
  };
}

export const Today = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
