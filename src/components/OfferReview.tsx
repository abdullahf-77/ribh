"use client";

import { useMemo, useState } from "react";
import { vatAssumption } from "@/config/brand";
import { foldDigits } from "@/domain/evidence";
import { activeVersion, correctField, fieldValue, OfferState, resolveAmbiguitiesFor, SourceText } from "@/domain/offer-state";
import type { Charge, Requirements, Tier } from "@/domain/schemas";
import { FIELD_GROUPS, fieldLabel, fieldsFor, FieldSpec } from "@/lib/fields";
import { boolOptions, Button, Card, Chip, fromBool, Note, parseNumber, toBool } from "./ui";

export function SourceBlock({ source, highlight }: { source: SourceText; highlight: { start: number; end: number } | null }) {
  const t = source.text;
  return (
    <div dir="auto" className="whitespace-pre-wrap break-words rounded-s bg-sunken p-3 text-sm">
      {highlight ? <>{t.slice(0, highlight.start)}<mark className="evidence">{t.slice(highlight.start, highlight.end)}</mark>{t.slice(highlight.end)}</> : t}
    </div>
  );
}

function Provenance({ offer, field }: { offer: OfferState; field: string }) {
  const v = activeVersion(offer, field);
  const first = offer.fields[field]?.versions[0];
  if (v?.source === "user") return <Chip tone="accent">عدّلته أنت</Chip>;
  if (v?.source === "reply") return <Chip tone="accent">من رد المورد</Chip>;
  if (first?.flag === "unsupported_quote") return <Chip tone="not">رُفض: بلا دليل</Chip>;
  if (v?.flag === "value_not_in_quote") return <Chip tone="unknown">راجع الرقم</Chip>;
  if (v?.value != null) return <Chip>من العرض</Chip>;
  return <Chip tone="unknown">غير معروف</Chip>;
}

function parseLevels(raw: string): { label: string; count: number }[] | null | undefined {
  const parts = foldDigits(raw).split(/[×x*]/i).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) return undefined;
  return nums.map((count, i) => ({ label: i === 0 ? "عبوة" : "داخلها", count }));
}

function FieldEditor({ spec, offer, onChange }: { spec: FieldSpec; offer: OfferState; onChange: (v: unknown) => void }) {
  const value = fieldValue(offer, spec.key);
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const label = `${spec.label}: ${offer.label}`;
  const t = spec.type;
  if (typeof t === "object") {
    return (
      <select aria-label={label} className="field !min-h-9 !py-1 text-sm" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">غير معروف</option>
        {Object.entries(t.options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    );
  }
  if (t === "bool") {
    return (
      <select aria-label={label} className="field !min-h-9 !py-1 text-sm" value={fromBool(value as boolean | null) ?? ""} onChange={(e) => onChange(toBool(e.target.value || null))}>
        <option value="">غير معروف</option>
        {Object.entries(boolOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    );
  }
  const shown = t === "levels" ? (value as { count: number }[] | null)?.map((l) => l.count).join(" × ") ?? "" : t === "cities" ? (value as string[] | null)?.join("، ") ?? "" : value == null ? "" : String(value);
  const commit = (raw: string) => {
    let parsed: unknown = raw.trim() || null;
    if (t === "number") { const n = parseNumber(raw); if (Number.isNaN(n) || (n != null && n < 0)) { setBad(true); return; } parsed = n; }
    if (t === "levels") { const l = parseLevels(raw); if (l === undefined) { setBad(true); return; } parsed = l; }
    if (t === "cities") parsed = raw.trim() ? raw.split(/[،,]/).map((s) => s.trim()).filter(Boolean) : null;
    setBad(false); setDraft(null);
    if (JSON.stringify(parsed) !== JSON.stringify(value)) onChange(parsed);
  };
  return (
    <>
      <input aria-label={label} aria-invalid={bad} type={t === "date" ? "date" : "text"} className="field !min-h-9 !py-1 text-sm" dir="auto"
        placeholder={t === "levels" ? "مثال: 20 × 50" : "غير معروف"} value={draft ?? shown}
        onChange={(e) => { setDraft(e.target.value); setBad(false); }} onBlur={(e) => draft != null && commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {bad && <p role="alert" className="text-xs text-not">قيمة غير صالحة{t === "levels" ? "، اكتب الأعداد مثل 20 × 50" : ""}.</p>}
    </>
  );
}

export function OfferReview({ offer, onOffer, requirements, rejected, tick }: {
  offer: OfferState; onOffer: (o: OfferState) => void; requirements: Requirements; rejected: { field: string; quote: string | null }[]; tick: () => number;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const evidence = focus ? activeVersion(offer, focus)?.evidence ?? null : null;
  const original = offer.sources[0];
  const sourceInView = evidence ? offer.sources.find((s) => s.id === evidence.sourceId) ?? original : original;
  const update = (key: string, v: unknown) => onOffer(correctField(offer, key, v, tick()));
  const charges = fieldValue<Charge[]>(offer, "charges") ?? [];
  const tiers = fieldValue<Tier[]>(offer, "tiers") ?? [];
  const otherLabels = useMemo(() => Object.fromEntries(requirements.other.map((o) => [o.id, o.text])), [requirements.other]);
  const open = offer.ambiguities.filter((a) => !a.resolved);
  const excludedNoRate = fieldValue(offer, "vatStatus") === "excluded" && fieldValue(offer, "vatRatePercent") == null;

  return (
    <Card>
      <h3 className="text-lg font-semibold" dir="auto">{fieldValue<string>(offer, "supplierName") || offer.label}</h3>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <aside className="lg:sticky lg:top-3 lg:self-start">
          <p className="mb-1 text-xs font-medium text-muted">{sourceInView.kind === "reply" ? "رد المورد كما لصقته" : "نص العرض الأصلي"}</p>
          <SourceBlock source={sourceInView} highlight={evidence && evidence.sourceId === sourceInView.id ? evidence : null} />
          <p className="mt-1 text-xs text-muted">اختر أي حقل لتظليل دليله هنا.</p>
          {!original.text.trim() && <p className="text-xs text-muted">لا يوجد نص لهذا العرض.</p>}
        </aside>

        <div className="space-y-4">
          {open.length > 0 && (
            <Note tone="warn" title="نقاط ملتبسة في العرض">
              <ul className="mt-1 space-y-2">
                {open.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span dir="auto">{a.text}{a.quote && <span className="text-muted"> («{a.quote}»)</span>}</span>
                    <Button variant="ghost" onClick={() => onOffer({ ...offer, ambiguities: offer.ambiguities.map((x) => (x.id === a.id ? { ...x, resolved: true } : x)) })}>حسمتها</Button>
                  </li>
                ))}
              </ul>
            </Note>
          )}
          {rejected.length > 0 && (
            <Note tone="warn" title="قيم استبعدناها لعدم وجود دليل عليها في النص">
              {rejected.map((x) => fieldLabel(x.field, otherLabels)).join("، ")}. بقيت غير معروفة، ويمكنك إدخالها إن تأكدت منها.
            </Note>
          )}
          {excludedNoRate && (
            <Note tone="warn" title="السعر غير شامل الضريبة ولم تُذكر النسبة"
              actions={<Button onClick={() => onOffer(correctField(offer, "vatRatePercent", vatAssumption.ratePercent, tick(), "افتراض من المستخدم"))}>استخدم {vatAssumption.ratePercent}% افتراضًا</Button>}>
              لن نحسب إجماليًا دون نسبة. النسبة المعتادة {vatAssumption.ratePercent}% منذ {vatAssumption.effectiveFrom} حسب{" "}
              <a className="underline" href={vatAssumption.sourceUrl} target="_blank" rel="noreferrer">{vatAssumption.source}</a>، لكن اعتمادها على هذا العرض افتراض منك.
            </Note>
          )}

          {FIELD_GROUPS.map((group) => (
            <fieldset key={group}>
              <legend className="mb-1 text-sm font-semibold">{group}</legend>
              <div className="divide-y divide-line rounded-s border border-line">
                {fieldsFor(requirements.category).filter((f) => f.group === group).map((spec) => {
                  const version = activeVersion(offer, spec.key);
                  const selected = focus === spec.key;
                  return (
                    <div key={spec.key} className={`grid grid-cols-[minmax(0,1fr)] items-center gap-2 p-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto] ${selected ? "bg-accent-soft" : ""}`}
                      onFocusCapture={() => setFocus(spec.key)} onClick={() => setFocus(spec.key)}>
                      <span className="text-sm">{spec.label}</span>
                      <div>
                        <FieldEditor spec={spec} offer={offer} onChange={(v) => update(spec.key, v)} />
                        {version?.evidence && selected && <p className="mt-1 text-xs text-muted" dir="auto">الدليل: «{version.evidence.quote}»</p>}
                      </div>
                      <Provenance offer={offer} field={spec.key} />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {requirements.other.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">شروطك الأخرى</legend>
              <div className="divide-y divide-line rounded-s border border-line">
                {requirements.other.map((o) => {
                  const key = `other:${o.id}`;
                  return (
                    <div key={o.id} className="grid items-center gap-2 p-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
                      <span className="text-sm" dir="auto">{o.text}</span>
                      <select aria-label={o.text} className="field !min-h-9 !py-1 text-sm" value={fieldValue<string>(offer, key) ?? ""} onChange={(e) => update(key, e.target.value || null)}>
                        <option value="">غير معروف</option>
                        <option value="meets">يستوفي</option>
                        <option value="not">لا يستوفي</option>
                      </select>
                      <Provenance offer={offer} field={key} />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-1 text-sm font-semibold">الرسوم الإضافية</legend>
            {charges.length === 0 && <p className="text-sm text-muted">لم يذكر العرض رسومًا إضافية. هذا لا يعني عدم وجودها.</p>}
            <div className="space-y-2">
              {charges.map((c, i) => (
                <div key={i} className="grid items-center gap-2 rounded-s border border-line p-2 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
                  <span className="text-sm" dir="auto">{c.label}</span>
                  <input aria-label={`مبلغ ${c.label}`} className="field !min-h-9 !py-1 text-sm" placeholder="مبلغ غير معروف" defaultValue={c.amount ?? ""}
                    onBlur={(e) => { const n = parseNumber(e.target.value); if (!Number.isNaN(n) && n !== c.amount) update("charges", charges.map((x, j) => (j === i ? { ...x, amount: n } : x))); }} />
                  <select aria-label={`ضريبة ${c.label}`} className="field !min-h-9 !py-1 text-sm" value={c.vat ?? ""} onChange={(e) => update("charges", charges.map((x, j) => (j === i ? { ...x, vat: (e.target.value || null) as Charge["vat"] } : x)))}>
                    <option value="">الضريبة غير معروفة</option>
                    <option value="included">شامل الضريبة</option>
                    <option value="excluded">غير شامل الضريبة</option>
                  </select>
                </div>
              ))}
            </div>
          </fieldset>

          {tiers.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">شرائح خصم الكمية</legend>
              <ul className="space-y-2">
                {tiers.map((t, i) => (
                  <li key={i} className="rounded-s border border-line p-2 text-sm">
                    من {t.minQty} {t.qtyUnit === "package" ? "عبوة" : "وحدة"}: {t.price} ريال {t.priceBasis === "per_package" ? "للعبوة" : "للحبة"}
                    {t.quote && <p className="text-xs text-muted" dir="auto">الدليل: «{t.quote}»</p>}
                    {t.condition && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Chip tone="unknown">شرط: {t.condition}</Chip>
                        <Button variant="ghost" onClick={() => onOffer(resolveAmbiguitiesFor(correctField(offer, "tiers", tiers.map((x, j) => (j === i ? { ...x, condition: null } : x)), tick(), "أكد المستخدم تحقق الشرط"), "tiers"))}>تأكدت أن الشرط متحقق</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </div>
      </div>
    </Card>
  );
}


