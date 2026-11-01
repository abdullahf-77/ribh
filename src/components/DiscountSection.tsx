"use client";

import { useState } from "react";
import { analyzeDiscount, DiscountAnalysis, DiscountScenario, InventoryInputs } from "@/domain/discount";
import { daysLabel, missingText, qty, sar } from "@/domain/explain";
import { fieldValue, OfferState, resolveOffer } from "@/domain/offer-state";
import type { Requirements, Tier } from "@/domain/schemas";
import { Card, Chip, Note, NumberField } from "./ui";

const unk = <Chip tone="unknown">غير معروف</Chip>;

function Conclusion({ a }: { a: DiscountAnalysis }) {
  const tier = a.scenarios.find((s) => !s.isBaseline);
  switch (a.conclusion) {
    case "ambiguous":
      return (
        <Note tone="warn" title="لا يمكن الحكم على الخصم قبل توضيحه">
          {a.ambiguousReasons.includes("mechanism") && "لم يوضح العرض هل يطبَّق السعر على كل الكمية أم على الزيادة فقط. "}
          {a.ambiguousReasons.includes("condition") && "وللخصم شرط لم يتأكد بعد. "}
          اسأل المورد في قسم التوضيح أدناه.
        </Note>
      );
    case "incomplete":
      return <Note tone="warn" title="الحساب غير مكتمل">بعض المبالغ أو الكميات غير معروفة، فلا يمكن المقارنة بين الخيارين. {tier?.unavailable && "والكمية المتوفرة المذكورة أقل من شريحة الخصم."}</Note>;
    case "no_larger_option":
      return <Note tone="info">لا توجد شريحة أعلى من الكمية التي تحتاجها، فالسعر المعروض هو سعر طلبك.</Note>;
    case "no_unit_benefit":
      return <Note tone="info">بعد احتساب كل الرسوم، لا تقل تكلفة الوحدة في الشريحة الأعلى.</Note>;
    case "lower_unit_lower_payment":
      return <Note tone="ok" title="الكمية الأكبر أقل في الدفع وفي تكلفة الوحدة">الدفعة تقل بمقدار {sar(-tier!.extraPaymentHalalas!)} مع زيادة الكمية، حسب أسعار العرض نفسها.</Note>;
    case "lower_unit_higher_payment":
      return (
        <Note tone="info" title="تكلفة الوحدة أقل، لكنك تدفع أكثر الآن">
          <p>تنخفض تكلفة الوحدة {tier!.unitReductionSar} ريال، وترتفع دفعتك {sar(tier!.extraPaymentHalalas!)}، وتحصل على {qty(tier!.cost.excess ?? 0)} وحدة فوق حاجتك.</p>
          <p className="mt-1">هذا مبلغ إضافي تدفعه اليوم، وليس توفيرًا فوريًا.</p>
        </Note>
      );
    default:
      return null;
  }
}

function ScenarioRow({ s, base }: { s: DiscountScenario; base: DiscountScenario }) {
  const money = (h: number | null) => (h == null ? unk : sar(h));
  return (
    <div className="rounded-s border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{s.label}</p>
        {s.isBaseline ? <Chip>نقطة المقارنة</Chip> : s.unavailable ? <Chip tone="not">يتجاوز الكمية المتوفرة</Chip> : null}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div><dt className="text-xs text-muted">كمية الشراء</dt><dd>{s.cost.purchaseQty != null ? qty(s.cost.purchaseQty) : unk}</dd></div>
        <div><dt className="text-xs text-muted">الدفعة الآن</dt><dd className="font-semibold">{money(s.cost.totalHalalas)}</dd></div>
        <div><dt className="text-xs text-muted">تكلفة الوحدة</dt><dd>{s.cost.comparableUnitSar ? `${s.cost.comparableUnitSar} ريال` : unk}</dd></div>
        <div><dt className="text-xs text-muted">فوق حاجتك</dt><dd>{s.cost.excess != null ? `${qty(s.cost.excess)} وحدة` : unk}</dd></div>
        {!s.isBaseline && <div><dt className="text-xs text-muted">زيادة الدفعة</dt><dd>{money(s.extraPaymentHalalas)}</dd></div>}
        {!s.isBaseline && <div><dt className="text-xs text-muted">انخفاض تكلفة الوحدة</dt><dd>{s.unitReductionSar ? `${s.unitReductionSar} ريال (${s.unitReductionPercent}%)` : unk}</dd></div>}
      </dl>
      {s.coverageDays != null && (
        <p className="mt-2 text-sm">
          تغطية تقديرية: نحو {daysLabel(s.coverageDays)} حسب ما أدخلته.
          {s.exceedsMaxCoverage && <span className="text-not"> تتجاوز الحد الذي حددته.</span>}
        </p>
      )}
      {!s.isBaseline && s.hypotheticalSavingHalalas != null && s.hypotheticalSavingHalalas > 0 && (
        <p className="mt-2 rounded-s bg-sunken p-2 text-xs text-muted">
          توفير مستقبلي افتراضي: {sar(s.hypotheticalSavingHalalas)}، <strong>بشرط</strong> أنك ستشتري الكمية الزائدة لاحقًا فعلًا، وبتكلفة {base.cost.comparableUnitSar} ريال للوحدة نفسها. لا يضمن العرض بقاء هذا السعر، ولا يُحتسب هنا تخزين أو تلف.
        </p>
      )}
      {s.cost.missing.length > 0 && <p className="mt-2 text-xs text-unknown">ينقص: {s.cost.missing.map(missingText).join("، ")}</p>}
    </div>
  );
}

export function DiscountSection({ offers, requirements }: { offers: OfferState[]; requirements: Requirements }) {
  const [inv, setInv] = useState<InventoryInputs>({ currentStock: null, dailyUse: null, maxCoverageDays: null });
  const items = offers
    .map((o) => ({ o, a: analyzeDiscount(resolveOffer(o), requirements, inv), tiers: fieldValue<Tier[]>(o, "tiers") ?? [] }))
    .filter((x) => x.a.applicable);
  if (!items.length) return null;

  return (
    <section>
      <h3 className="mb-2 text-lg font-semibold">هل خصم الكمية يستاهل؟</h3>
      <Card>
        <p className="mb-3 text-sm text-muted">اختياري: أدخل استهلاكك لنقدّر كم يغطي كل خيار. بدون الاستهلاك لا نعرض أي تقدير، ولا نفترض التخزين أو التلف أو الطلب المستقبلي.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="المخزون الحالي (وحدة)" integer min={1} value={inv.currentStock} onChange={(v) => setInv({ ...inv, currentStock: v })} />
          <NumberField label="متوسط الاستهلاك اليومي (وحدة)" value={inv.dailyUse} onChange={(v) => setInv({ ...inv, dailyUse: v })} />
          <NumberField label="أقصى تغطية تقبلها (يوم)" integer value={inv.maxCoverageDays} onChange={(v) => setInv({ ...inv, maxCoverageDays: v })} />
        </div>
        {items.map(({ o, a, tiers }) => (
          <div key={o.id} className="mt-5 space-y-3 border-t border-line pt-4">
            <h4 className="font-semibold" dir="auto">{fieldValue<string>(o, "supplierName") || o.label}</h4>
            <ul className="text-xs text-muted">{tiers.filter((t) => t.quote).map((t, i) => <li key={i} dir="auto">من العرض: «{t.quote}»</li>)}</ul>
            <Conclusion a={a} />
            <div className="space-y-2">{a.scenarios.map((s) => <ScenarioRow key={s.key} s={s} base={a.scenarios[0]} />)}</div>
          </div>
        ))}
      </Card>
    </section>
  );
}
