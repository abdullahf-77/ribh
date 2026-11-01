"use client";

import { useState } from "react";
import { rfqGaps } from "@/domain/rfq";
import type { Requirements } from "@/domain/schemas";
import { useLabels } from "@/domain/decision";
import { ApiError, post } from "@/lib/api";
import { Button, Card, Chip, CopyButton, Note, NumberField, SelectField, TextField } from "./ui";

const req3 = { required: "مطلوبة", not_required: "غير مطلوبة" };

export function RfqStep({ mode, requirements: r, onRequirements, onBack, onNext }: {
  mode: "live" | "demo" | null; requirements: Requirements; onRequirements: (r: Requirements) => void; onBack: () => void; onNext: () => void;
}) {
  const [includeBudget, setIncludeBudget] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState<{ source: "llama" | "template"; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const gaps = rfqGaps(r);
  const blocking = gaps.some((g) => g.blocking);

  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const out = await post<{ message: string; source: "llama" | "template"; reason: string | null }>("/api/rfq", { requirements: r, includeBudget });
      setMessage(out.message);
      setSource({ source: out.source, reason: out.reason });
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="self-start">
        <h3 className="text-lg font-semibold">قبل تجهيز الطلب</h3>
        {gaps.length === 0 && <p className="mt-2 text-sm text-muted">كل ما يحتاجه المورد محدد.</p>}
        {gaps.length > 0 && (
          <>
            <p className="mb-3 mt-1 text-sm text-muted">هذه الإجابات تجعل عرض المورد قابلًا للمقارنة.{!blocking && " ما تتركه فارغًا لن يُذكر في الرسالة."}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {gaps.map((g) => {
                const set = (v: unknown) => onRequirements({ ...r, [g.field]: v });
                if (g.field === "quantity") return <NumberField key={g.field} integer label={g.question} value={r.quantity} onChange={set} />;
                if (g.field === "sizeOz") return <NumberField key={g.field} label={g.question} value={r.sizeOz} onChange={set} />;
                if (g.field === "use") return <SelectField key={g.field} label={g.question} value={r.use} options={useLabels} onChange={set} />;
                if (g.field === "lid") return <SelectField key={g.field} label={g.question} value={r.lid} options={req3} onChange={set} />;
                if (g.field === "print") return <SelectField key={g.field} label={g.question} value={r.print} options={req3} onChange={set} />;
                if (g.field === "requiredDate") return <TextField key={g.field} type="date" label={g.question} value={r.requiredDate} onChange={set} />;
                return <TextField key={g.field} label={g.question} value={r[g.field] as string | null} onChange={set} />;
              })}
            </div>
          </>
        )}
        {r.budgetSar != null && (
          <label className="mt-4 flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={includeBudget} onChange={(e) => setIncludeBudget(e.target.checked)} />
            <span>أظهر ميزانيتي للمورد ({r.budgetSar.toLocaleString("en-US")} ريال). <span className="text-muted">مخفية ما لم تفعّل هذا الخيار.</span></span>
          </label>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" busy={busy} disabled={blocking} onClick={generate}>{busy ? "جارٍ تجهيز الطلب" : message ? "أعد تجهيز الطلب" : "جهّز طلب عرض سعر"}</Button>
          <Button onClick={onBack}>عدّل المتطلبات</Button>
        </div>
        {blocking && <p className="mt-2 text-xs text-muted">حدد المنتج والكمية والمقاس أولًا.</p>}
        {error && <div className="mt-3"><Note tone="error" title="تعذر تجهيز الطلب">{error.message}</Note></div>}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">رسالتك للمورد</h3>
          {source?.source === "llama" && <Chip tone="accent">صياغة Llama بعد التحقق من مطابقتها لطلبك</Chip>}
          {source?.source === "template" && <Chip>{source.reason === "demo" || mode === "demo" ? "قالب جاهز (وضع التجربة)" : "قالب جاهز بعد تعذر صياغة موثوقة"}</Chip>}
        </div>
        {message == null ? (
          <p className="mt-6 rounded-s bg-sunken p-6 text-center text-sm text-muted">ستظهر الرسالة هنا لتراجعها وتعدّلها وتنسخها.</p>
        ) : (
          <>
            <textarea aria-label="نص طلب عرض السعر" className="field mt-3 min-h-96 whitespace-pre-wrap" dir="auto" value={message} onChange={(e) => setMessage(e.target.value)} />
            <p className="mt-2 text-xs text-muted">لا يرسل التطبيق شيئًا. انسخها وأرسلها بنفسك.</p>
            <div className="mt-3 flex flex-wrap gap-2"><CopyButton text={message} label="انسخ الرسالة" /></div>
          </>
        )}
        <div className="mt-5 border-t border-line pt-4">
          <Button variant={message ? "primary" : "secondary"} disabled={!r.quantity} onClick={onNext}>وصلتني العروض: أضفها</Button>
        </div>
      </Card>
    </div>
  );
}
