"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { brand } from "@/config/brand";
import { scenarios, Scenario } from "@/demo/scenarios";
import { decide, Priority } from "@/domain/decision";
import type { RequirementEvidence, ValidatedOffer } from "@/domain/evidence";
import { newOfferState, validateRawOffer } from "@/domain/evidence";
import { OfferState, pushVersion, resolveOffer } from "@/domain/offer-state";
import { emptyRequirements, Requirements } from "@/domain/schemas";
import { rawOffer } from "@/demo/build";
import { ApiError, post, todayIso } from "@/lib/api";
import { CompareStep } from "./CompareStep";
import { OffersStep, OfferInput } from "./OffersStep";
import { RequirementStep } from "./RequirementStep";
import { ReviewStep } from "./ReviewStep";
import { RfqStep } from "./RfqStep";
import { Note } from "./ui";

export type StepId = "requirements" | "rfq" | "offers" | "review" | "compare";
const STEPS: { id: StepId; label: string }[] = [
  { id: "requirements", label: "المتطلبات" },
  { id: "rfq", label: "طلب العرض" },
  { id: "offers", label: "العروض" },
  { id: "review", label: "المراجعة" },
  { id: "compare", label: "القرار" },
];

const IDS = ["A", "B", "C"] as const;
const LETTERS = { A: "المورد أ", B: "المورد ب", C: "المورد ج" };
const blankInputs = (): OfferInput[] => IDS.map((id) => ({ id, name: "", text: "" }));
const otherKey = (r: Requirements) => JSON.stringify(r.other.map((o) => [o.id, o.text]));

export type OfferProblem = { id: string; message: string; code: string };

export function Workspace() {
  const [step, setStep] = useState<StepId>("requirements");
  const [mode, setMode] = useState<"live" | "demo" | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [requirementText, setRequirementText] = useState("");
  const [requirements, setRequirements] = useState<Requirements>(emptyRequirements);
  const [reqEvidence, setReqEvidence] = useState<RequirementEvidence>({});
  const [inputs, setInputs] = useState<OfferInput[]>(blankInputs);
  const [offers, setOffers] = useState<OfferState[]>([]);
  const [analyzedOthers, setAnalyzedOthers] = useState("[]");
  const [problems, setProblems] = useState<OfferProblem[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [priority, setPriority] = useState<Priority>("cash");
  const [orderDate, setOrderDate] = useState(todayIso);
  const [changeNote, setChangeNote] = useState<{ offerLabel: string; lines: string[] } | null>(null);
  const [rejected, setRejected] = useState<Record<string, { field: string; quote: string | null }[]>>({});
  const clock = useRef(1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tick = useCallback(() => ++clock.current, []);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((d) => setMode(d.mode)).catch(() => setMode("demo"));
  }, []);

  const go = useCallback((id: StepId) => {
    setStep(id);
    requestAnimationFrame(() => { window.scrollTo({ top: 0 }); headingRef.current?.focus({ preventScroll: true }); });
  }, []);

  const loadScenario = useCallback((s: Scenario) => {
    setScenario(s);
    setRequirementText(s.requirementText);
    setRequirements(emptyRequirements());
    setReqEvidence({});
    setOffers([]);
    setProblems([]);
    setChangeNote(null);
    setRejected({});
    setInputs(IDS.map((id, i) => ({ id, name: "", text: s.offers[i]?.text ?? "" })));
  }, []);

  const startOver = useCallback(() => {
    setScenario(null); setRequirementText(""); setRequirements(emptyRequirements()); setReqEvidence({}); setInputs(blankInputs());
    setOffers([]); setProblems([]); setChangeNote(null); setRejected({}); setPriority("cash"); go("requirements");
  }, [go]);

  const addFromValidated = (id: (typeof IDS)[number], input: OfferInput, validated: ValidatedOffer): OfferState => {
    let state = newOfferState(id, input.name.trim() || LETTERS[id], input.text, validated, tick());
    if (input.name.trim()) state = pushVersion(state, "supplierName", { value: input.name.trim(), source: "user", evidence: null, flag: null, at: tick() });
    return state;
  };

  const analyzeOffers = useCallback(async () => {
    const filled = inputs.filter((i) => i.text.trim());
    setAnalyzing(true);
    setProblems([]);
    const results = await Promise.allSettled(filled.map((input) =>
      post<{ validated: ValidatedOffer }>("/api/offers", { offerId: input.id, text: input.text, other: requirements.other }),
    ));
    const nextOffers: OfferState[] = [];
    const nextProblems: OfferProblem[] = [];
    const nextRejected: typeof rejected = {};
    results.forEach((r, i) => {
      const input = filled[i];
      if (r.status === "fulfilled") {
        nextOffers.push(addFromValidated(input.id as "A", input, r.value.validated));
        nextRejected[input.id] = r.value.validated.rejected;
      } else {
        const e = r.reason as ApiError;
        nextProblems.push({ id: input.id, message: e.message, code: e.code });
      }
    });
    setAnalyzing(false);
    setOffers(nextOffers);
    setProblems(nextProblems);
    setRejected(nextRejected);
    setAnalyzedOthers(otherKey(requirements));
    setChangeNote(null);
    if (!nextProblems.length) go("review");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, requirements, go]);

  /** Lets the user carry on by hand when analysis is unavailable. Everything starts as unknown. */
  const manualEntry = useCallback((id: string) => {
    const input = inputs.find((i) => i.id === id)!;
    const empty = validateRawOffer(rawOffer({}), `offer:${id}`, input.text, []);
    setOffers((prev) => [...prev.filter((o) => o.id !== id), addFromValidated(id as "A", input, empty)].sort((a, b) => a.id.localeCompare(b.id)));
    setProblems((prev) => prev.filter((p) => p.id !== id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs]);

  const reanalyzeOthers = useCallback(async () => {
    setAnalyzing(true);
    setProblems([]);
    try {
      const next = await Promise.all(offers.map(async (o) => {
        const text = o.sources[0].text;
        const r = await post<{ validated: ValidatedOffer }>("/api/offers", { offerId: o.id, text, other: requirements.other });
        let state = o;
        // Only requirement matches are refreshed; the user's corrections and earlier evidence stay.
        for (const [k, v] of Object.entries(r.validated.fields)) {
          if (k.startsWith("other:")) state = pushVersion(state, k, { ...v, source: "offer", at: tick() });
        }
        return state;
      }));
      setOffers(next);
      setAnalyzedOthers(otherKey(requirements));
    } catch (e) {
      setProblems([{ id: "*", code: (e as ApiError).code, message: (e as ApiError).message }]);
    } finally {
      setAnalyzing(false);
    }
  }, [offers, requirements, tick]);

  const decision = useMemo(
    () => (requirements.quantity && offers.length ? decide(offers.map(resolveOffer), requirements, orderDate, priority) : null),
    [offers, requirements, orderDate, priority],
  );

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const reachable = (id: StepId) => {
    if (id === "requirements" || id === step) return true;
    if (id === "rfq" || id === "offers") return !!requirements.quantity;
    return offers.length >= 1;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <button type="button" onClick={startOver} className="text-xl font-bold" aria-label={`${brand.nameAr}: ابدأ من جديد`}>{brand.nameAr}</button>
        {mode === "demo" && <span className="hatch rounded-s px-2 py-1 text-xs font-medium text-unknown">وضع التجربة: أمثلة خيالية محفوظة، وليست تحليل Llama مباشر</span>}
        {mode === "live" && <span className="rounded-s bg-meets-soft px-2 py-1 text-xs font-medium text-meets">التحليل يعمل عبر Llama</span>}
      </header>

      {step === "requirements" && !requirements.quantity && !requirementText && (
        <section className="pb-6 pt-2">
          <h1 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">أي عرض يطابق طلبك فعلًا، وكم ستدفع، وماذا تسأل المورد قبل الشراء؟</h1>
          <p className="mt-3 max-w-2xl text-muted">لأكواب المقاهي. اكتب ما تحتاجه، ألصق عروض الموردين كما وصلتك، وتحصل على مقارنة تبيّن المعروف والمجهول مع دليل كل رقم.</p>
        </section>
      )}

      <nav aria-label="خطوات الشراء" className="mb-5 overflow-x-auto [scrollbar-width:none]">
        <ol className="flex min-w-max gap-1 border-b border-line">
          {STEPS.map((s, i) => {
            const current = s.id === step;
            return (
              <li key={s.id}>
                <button type="button" disabled={!reachable(s.id)} aria-current={current ? "step" : undefined} onClick={() => go(s.id)}
                  className={`-mb-px min-h-11 border-b-2 px-2 py-2 sm:px-3 text-sm transition disabled:opacity-40 ${current ? "border-accent font-semibold text-accent" : i < stepIndex ? "border-transparent text-ink hover:border-line" : "border-transparent text-muted hover:border-line"}`}>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {scenario && (
        <div className="mb-4">
          <Note tone="info" title={`مثال خيالي: ${scenario.title}`}>{scenario.lesson} كل الموردين والأسعار والردود هنا مختلقة للتوضيح.</Note>
        </div>
      )}

      <main>
        <h2 ref={headingRef} tabIndex={-1} className="sr-only">{STEPS[stepIndex].label}</h2>
        {step === "requirements" && (
          <RequirementStep
            mode={mode} text={requirementText} onText={setRequirementText} requirements={requirements} onRequirements={setRequirements}
            evidence={reqEvidence} onEvidence={setReqEvidence} scenarios={scenarios} onScenario={loadScenario}
            onRfq={() => go("rfq")} onNext={() => go("offers")}
          />
        )}
        {step === "rfq" && <RfqStep mode={mode} requirements={requirements} onRequirements={setRequirements} onBack={() => go("requirements")} onNext={() => go("offers")} />}
        {step === "offers" && (
          <OffersStep inputs={inputs} onInputs={setInputs} busy={analyzing} problems={problems} analyzedCount={offers.length}
            onAnalyze={analyzeOffers} onManual={manualEntry} onContinue={() => { setProblems([]); go("review"); }} mode={mode} />
        )}
        {step === "review" && (
          <ReviewStep offers={offers} onOffers={setOffers} requirements={requirements} rejected={rejected} tick={tick} onNext={() => go("compare")} onBack={() => go("offers")} />
        )}
        {step === "compare" && decision && (
          <CompareStep
            mode={mode} decision={decision} requirements={requirements} onRequirements={setRequirements} offers={offers} onOffers={setOffers}
            priority={priority} onPriority={setPriority} orderDate={orderDate} onOrderDate={setOrderDate} scenario={scenario} tick={tick}
            changeNote={changeNote} onChangeNote={setChangeNote} onEditRequirements={() => go("requirements")} onEditOffers={() => go("review")} onStartOver={startOver}
            needsReanalysis={otherKey(requirements) !== analyzedOthers} reanalyzing={analyzing} onReanalyze={reanalyzeOthers} problems={problems}
          />
        )}
        {step === "compare" && !decision && <Note tone="warn" title="أكمل الكمية المطلوبة أولًا">لا يمكن حساب المقارنة بدون كمية. <button type="button" className="underline" onClick={() => go("requirements")}>عد إلى المتطلبات</button></Note>}
      </main>
      <footer className="mt-10 border-t border-line pt-3 text-xs text-muted">
        <span dir="ltr">Built with Llama</span> · الأرقام تحسبها قواعد التطبيق، ويبقى قرار الشراء لك.
      </footer>
    </div>
  );
}
