"use client";

import { useState } from "react";
import { limits } from "@/config/brand";
import { Button, Card, Note } from "./ui";
import type { OfferProblem } from "./Workspace";

export type OfferInput = { id: string; name: string; text: string };
const LETTERS: Record<string, string> = { A: "المورد أ", B: "المورد ب", C: "المورد ج" };

export function OffersStep({ inputs, onInputs, busy, problems, analyzedCount, onAnalyze, onManual, onContinue, mode }: {
  inputs: OfferInput[]; onInputs: (i: OfferInput[]) => void; busy: boolean; problems: OfferProblem[]; analyzedCount: number;
  onAnalyze: () => void; onManual: (id: string) => void; onContinue: () => void; mode: "live" | "demo" | null;
}) {
  const [tried, setTried] = useState(false);
  const filled = inputs.filter((i) => i.text.trim()).length;
  const set = (id: string, patch: Partial<OfferInput>) => onInputs(inputs.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const tooFew = filled < limits.minOffers;

  return (
    <div>
      <p className="mb-4 text-sm text-muted">ألصق كل عرض كما وصلك من واتساب أو البريد، بالعربية أو الإنجليزية. تحتاج عرضين على الأقل، وثلاثة كحد أقصى.</p>
      <div className="grid gap-4 md:grid-cols-3">
        {inputs.map((input) => {
          const problem = problems.find((p) => p.id === input.id);
          return (
            <Card key={input.id}>
              <h3 className="font-semibold">{input.name || LETTERS[input.id]}</h3>
              <label className="mt-2 block text-xs text-muted" htmlFor={`name-${input.id}`}>اسم المورد (اختياري)</label>
              <input id={`name-${input.id}`} className="field" dir="auto" value={input.name} onChange={(e) => set(input.id, { name: e.target.value })} />
              <label className="mt-3 block text-xs text-muted" htmlFor={`text-${input.id}`}>نص العرض{input.id === "C" ? " (اختياري)" : ""}</label>
              <textarea id={`text-${input.id}`} className="field min-h-56" dir="auto" maxLength={limits.offerChars} value={input.text}
                aria-invalid={tried && input.id !== "C" && !input.text.trim()} onChange={(e) => set(input.id, { text: e.target.value })} />
              <p className="mt-1 text-xs text-muted">{input.text.length.toLocaleString("en-US")} / {limits.offerChars.toLocaleString("en-US")}</p>
              {problem && (
                <div className="mt-2">
                  <Note tone="error" title="تعذر تحليل هذا العرض" actions={<>
                    <Button onClick={onAnalyze} disabled={busy}>أعد المحاولة</Button>
                    <Button onClick={() => onManual(input.id)}>أدخله يدويًا</Button>
                  </>}>{problem.message}</Note>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {tried && tooFew && <div className="mt-4"><Note tone="error">أضف نص عرضين على الأقل لتتم المقارنة.</Note></div>}
      {busy && <div className="mt-4"><Note tone="info">جارٍ قراءة العروض واستخراج بياناتها مع أدلتها. قد يستغرق هذا نصف دقيقة.</Note></div>}
      {mode === "demo" && !busy && <p className="mt-3 text-xs text-muted">وضع التجربة يحلل نصوص الأمثلة الخيالية فقط. يمكنك إدخال أي عرض آخر يدويًا بعد الضغط على «حلّل العروض».</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant={analyzedCount ? "secondary" : "primary"} busy={busy} onClick={() => { setTried(true); if (!tooFew) onAnalyze(); }}>{busy ? "جارٍ التحليل" : analyzedCount ? "أعد تحليل العروض" : "حلّل العروض"}</Button>
        {analyzedCount >= 1 && !busy && <Button variant="primary" onClick={onContinue}>تابع إلى المراجعة ({analyzedCount})</Button>}
      </div>
      {analyzedCount >= 1 && !busy && <p className="mt-2 text-xs text-muted">إعادة التحليل تستبدل البيانات الحالية وتعديلاتك عليها.</p>}
    </div>
  );
}
