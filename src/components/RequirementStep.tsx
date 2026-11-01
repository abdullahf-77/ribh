"use client";

import { useState } from "react";
import { limits } from "@/config/brand";
import type { Scenario } from "@/demo/scenarios";
import { materialLabels, useLabels, wallLabels } from "@/domain/decision";
import type { RequirementEvidence } from "@/domain/evidence";
import type { Requirements } from "@/domain/schemas";
import { ApiError, post, todayIso } from "@/lib/api";
import { boolOptions, Button, Card, fromBool, Note, NumberField, SelectField, TextField, toBool } from "./ui";

const req3 = { required: "مطلوبة", not_required: "غير مطلوبة" };

export function RequirementStep({ mode, text, onText, requirements: r, onRequirements, evidence, onEvidence, scenarios, onScenario, onRfq, onNext }: {
  mode: "live" | "demo" | null; text: string; onText: (t: string) => void; requirements: Requirements; onRequirements: (r: Requirements) => void;
  evidence: RequirementEvidence; onEvidence: (e: RequirementEvidence) => void; scenarios: Scenario[]; onScenario: (s: Scenario) => void; onRfq: () => void; onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [empty, setEmpty] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [newOther, setNewOther] = useState("");
  const set = <K extends keyof Requirements>(k: K, v: Requirements[K]) => {
    onRequirements({ ...r, [k]: v });
    if (evidence[k]) { const e = { ...evidence }; delete e[k]; onEvidence(e); }
  };

  const analyze = async () => {
    if (!text.trim()) { setEmpty(true); return; }
    setEmpty(false); setBusy(true); setError(null);
    try {
      const out = await post<{ requirements: Requirements; evidence: RequirementEvidence; rejected: string[] }>("/api/requirements", { text, today: todayIso() });
      onRequirements(out.requirements);
      onEvidence(out.evidence);
      setRejected(out.rejected);
      setAnalyzed(true);
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  };

  const followUps: string[] = [];
  if (analyzed || r.quantity) {
    if (!r.quantity) followUps.push("كم الكمية المطلوبة؟");
    if (!r.sizeOz) followUps.push("ما مقاس الكوب؟");
    if (!r.use) followUps.push("هل الأكواب للساخن أم البارد؟");
    if (r.budgetSar != null && r.budgetIncludesDelivery == null) followUps.push("هل تشمل ميزانيتك التوصيل؟");
    if (r.budgetSar != null && r.budgetIncludesVat == null) followUps.push("هل تشمل ميزانيتك الضريبة؟");
  }
  const hint = (k: keyof Requirements) => (evidence[k] ? `من وصفك: «${evidence[k]}»` : undefined);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Card className="self-start">
        <h3 className="text-lg font-semibold">اكتب ما تحتاج شراءه</h3>
        <textarea aria-label="وصف الطلب" className="field mt-3 min-h-36" dir="auto" maxLength={limits.requirementChars} value={text}
          placeholder="مثال: أحتاج ٣٠٠٠ كوب للمشروبات الساخنة، مقاس ٨ أونصات، بطباعة مخصصة، توصل خلال أسبوع، وميزانيتي ١٥٠٠ ريال."
          onChange={(e) => { onText(e.target.value); setEmpty(false); }} aria-invalid={empty} />
        {empty && <p role="alert" className="mt-1 text-xs text-not">اكتب وصف طلبك أولًا، أو املأ الحقول مباشرة.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" busy={busy} onClick={analyze}>{busy ? "جارٍ قراءة طلبك" : "حلّل الطلب"}</Button>
        </div>
        {error && <div className="mt-3"><Note tone="error" title="تعذر تحليل الوصف">{error.message} يمكنك ملء الحقول يدويًا والمتابعة.</Note></div>}
        {rejected.length > 0 && <div className="mt-3"><Note tone="warn">تركنا بعض الحقول فارغة لأننا لم نجد ما يدعمها في وصفك. راجعها وأكملها.</Note></div>}

        <details className="mt-6 border-t border-line pt-3" open={!text}>
          <summary className="min-h-9 cursor-pointer py-1 font-semibold">جرّب بمثال جاهز</summary>
          <p className="text-xs text-muted">كل الأمثلة خيالية، وتمر بالحسابات نفسها.</p>
          <div className="mt-2 flex flex-col gap-1">
            {[...scenarios].reverse().map((s) => (
              <button type="button" key={s.id} onClick={() => { onScenario(s); setAnalyzed(false); setError(null); setRejected([]); }}
                className="min-h-11 rounded-s px-2 py-1.5 text-start text-sm text-accent transition hover:bg-accent-soft">{s.title}</button>
            ))}
          </div>
          {mode === "demo" && <p className="mt-2 text-xs text-muted">في وضع التجربة تعمل هذه الأمثلة فقط مع التحليل الآلي. لأي نص آخر، املأ الحقول يدويًا أو فعّل Llama.</p>}
        </details>
      </Card>

      <Card>
        <h3 className="text-lg font-semibold">راجع المتطلبات وعدّلها</h3>
        <p className="mb-4 text-sm text-muted">الحقل الفارغ يعني أنك لم تحدده، ولن نفترض له قيمة.</p>
        {followUps.length > 0 && (
          <div className="mb-4"><Note tone="warn" title="نحتاج منك">
            <ul className="list-inside list-disc">{followUps.map((q) => <li key={q}>{q}</li>)}</ul>
          </Note></div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="المنتج" value={r.product} onChange={(v) => set("product", v)} hint={hint("product")} />
          <NumberField label="الكمية المطلوبة (كوب)" integer value={r.quantity} onChange={(v) => set("quantity", v)} hint={hint("quantity")} />
          <NumberField label="المقاس (أونصة)" value={r.sizeOz} onChange={(v) => set("sizeOz", v)} hint={hint("sizeOz")} />
          <SelectField label="الاستخدام" value={r.use} options={useLabels} onChange={(v) => set("use", v as Requirements["use"])} hint={hint("use")} />
          <SelectField label="المادة" value={r.material} options={materialLabels} onChange={(v) => set("material", v as Requirements["material"])} hint={hint("material")} />
          <SelectField label="نوع الجدار" value={r.wall} options={wallLabels} onChange={(v) => set("wall", v as Requirements["wall"])} hint={hint("wall")} />
          <SelectField label="الأغطية" value={r.lid} options={req3} onChange={(v) => set("lid", v as Requirements["lid"])} hint={hint("lid")} />
          <SelectField label="الطباعة المخصصة" value={r.print} options={req3} onChange={(v) => set("print", v as Requirements["print"])} hint={hint("print")} />
          <TextField label="مدينة التوصيل" value={r.city} onChange={(v) => set("city", v)} hint={hint("city")} />
          <TextField label="موعد الاستلام المطلوب" type="date" value={r.requiredDate} onChange={(v) => set("requiredDate", v)} hint={hint("requiredDate")} />
          <NumberField label="الميزانية (ريال)" value={r.budgetSar} onChange={(v) => set("budgetSar", v)} hint={hint("budgetSar")} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="تشمل التوصيل؟" value={fromBool(r.budgetIncludesDelivery)} options={boolOptions} onChange={(v) => set("budgetIncludesDelivery", toBool(v))} />
            <SelectField label="تشمل الضريبة؟" value={fromBool(r.budgetIncludesVat)} options={boolOptions} onChange={(v) => set("budgetIncludesVat", toBool(v))} />
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <h4 className="text-sm font-semibold">شروط أخرى</h4>
          <ul className="mt-2 space-y-2">
            {r.other.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1" dir="auto">{o.text}</span>
                <select aria-label={`أهمية: ${o.text}`} className="field !w-auto !min-h-9 !py-1 text-sm" value={o.level}
                  onChange={(e) => set("other", r.other.map((x) => (x.id === o.id ? { ...x, level: e.target.value as "mandatory" } : x)))}>
                  <option value="mandatory">إلزامي</option>
                  <option value="preferred">مفضّل</option>
                </select>
                <Button variant="ghost" onClick={() => set("other", r.other.filter((x) => x.id !== o.id))}>احذف</Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input aria-label="شرط جديد" className="field" dir="auto" placeholder="مثال: شهادة ملامسة الغذاء" value={newOther} onChange={(e) => setNewOther(e.target.value)} />
            <Button disabled={!newOther.trim()} onClick={() => { set("other", [...r.other, { id: `U${Date.now()}`, text: newOther.trim(), level: "mandatory" }]); setNewOther(""); }}>أضف</Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="primary" disabled={!r.quantity} onClick={onNext}>عندي عروض: أضفها</Button>
          <Button disabled={!r.quantity && !r.product} onClick={onRfq}>جهّز طلب عرض سعر</Button>
        </div>
        {!r.quantity && <p className="mt-2 text-xs text-muted">حدد الكمية للمتابعة.</p>}
      </Card>
    </div>
  );
}
