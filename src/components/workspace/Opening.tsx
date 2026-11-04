"use client";

import { useRef, useState } from "react";
import { CATEGORIES, CategoryId } from "@/domain/categories";
import { BrandLogo } from "../Brand";
import { CafeSuppliesArt, CartIcon, CATEGORY_ICON, ChatIcon, CheckIcon, CupIcon, SheetIcon } from "../Cafe";
import { Button } from "../ui";

const PICKS: CategoryId[] = ["cups", "lids", "bags", "napkins", "takeaway"];

const STEPS = [
  { Icon: ChatIcon, title: "قل وش يحتاج مقهاك", text: "بكلامك العادي. أسأل فقط عن الناقص." },
  { Icon: SheetIcon, title: "ألصق عروض الموردين", text: "كما وصلتك في واتساب أو الإيميل، وكل رقم له دليل من النص." },
  { Icon: CheckIcon, title: "اعرف التكلفة الفعلية", text: "مع الكراتين والحد الأدنى والتوصيل والضريبة، ووش تسأل المورد عنه." },
];

/* Invented numbers that show the idea: the lowest unit price is not the lowest bill. */
const SAMPLE = [
  { name: "مورد القمة", shown: "0.31 ر.س للكوب", note: "التوصيل والضريبة محسوبة", total: "1,230", best: true },
  { name: "مورد المتكامل", shown: "0.29 ر.س للكوب", note: "يلزمك بـ 3,500 كوب كحد أدنى", total: "1,350", best: false },
  { name: "مورد الرياض", shown: "0.27 ر.س للكوب", note: "لم يذكر التوصيل ولا الضريبة", total: null, best: false },
];

/** The first thing anyone sees: what Ribh is for, one input, and a picture of the café supplies it compares. */
export function Opening({ mode, onSend, onDemo }: { mode: "live" | "demo" | null; onSend: (text: string) => void; onDemo: (pathId: string) => void }) {
  const [text, setText] = useState("");
  const [empty, setEmpty] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    if (!text.trim()) { setEmpty(true); input.current?.focus(); return; }
    onSend(text);
  };
  const pick = (id: CategoryId) => (mode === "demo" ? onDemo(id) : onSend(CATEGORIES[id].example));

  return (
    <div className="desk min-h-dvh">
      <div className="band" />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <BrandLogo className="h-11 w-auto" />
        <nav className="flex items-center gap-1 sm:gap-2">
          <a href="#how" className="hidden min-h-10 items-center rounded-full px-3 text-sm text-muted hover:bg-kraft-soft hover:text-ink md:inline-flex">كيف يعمل رِبح؟</a>
          <a href="#example" className="hidden min-h-10 items-center rounded-full px-3 text-sm text-muted hover:bg-kraft-soft hover:text-ink md:inline-flex">مثال المقارنة</a>
          {mode === "demo" && <span className="hatch rounded-s px-2 py-1 text-xs font-medium text-unknown">وضع تجربة بأمثلة خيالية</span>}
          <Button variant="primary" className="!min-h-10 text-sm" onClick={() => input.current?.focus()}>ابدأ الآن</Button>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <section className="grid items-center gap-8 pb-12 pt-4 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pt-8">
          <div className="rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1 text-sm font-medium text-kraft-text"><CupIcon className="size-4" /> مساعد مشتريات ذكي للمقاهي</span>
            <h1 className="font-display mt-4 text-4xl leading-[1.35] font-bold tracking-tight sm:text-5xl sm:leading-[1.3] xl:text-[3.4rem]">
              قبل ما تدفع،<br /><span className="sm:whitespace-nowrap">اعرف أي عرض <span className="relative inline-block text-accent-text">يناسبك<svg viewBox="0 0 120 12" aria-hidden className="absolute inset-x-0 -bottom-1 h-3 w-full text-green"><path d="M3 8c30-6 80-8 114-3" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg></span>.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted">ألصق عروض موردي الأكواب والأغطية والأكياس والمناديل والعبوات كما وصلتك، ورِبح يحسب لك التكلفة الفعلية ويبيّن الأنسب والناقص.</p>

            <form className="sheet mt-7 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <label htmlFor="first-message" className="mb-2 flex items-center gap-2 font-semibold"><CartIcon className="size-5 text-green" /> وش تحتاج تشتري؟</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <textarea ref={input} id="first-message" rows={1} dir="auto" autoFocus value={text} aria-invalid={empty} aria-describedby={empty ? "first-error" : undefined}
                  className="field min-h-12 flex-1 resize-none py-2.5 text-base"
                  placeholder="مثال: أحتاج ٣٠٠٠ كوب ورقي ٨ أونصات مع أغطية"
                  onChange={(e) => { setText(e.target.value); setEmpty(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
                <Button type="submit" variant="primary" className="min-h-12 px-6">ابدأ المقارنة ←</Button>
              </div>
              {empty && <p id="first-error" role="alert" className="mt-2 text-sm text-not">اكتب طلبك أولًا، أو اختر مثالًا.</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="أمثلة سريعة">
                <span className="text-sm text-muted">{mode === "demo" ? "جرّب مثالًا خياليًا:" : "أمثلة سريعة:"}</span>
                {PICKS.map((id) => {
                  const I = CATEGORY_ICON[id];
                  return <button key={id} type="button" onClick={() => pick(id)} className="chip-pick"><I className="size-4" />{CATEGORIES[id].label}</button>;
                })}
              </div>
            </form>
          </div>

          <CafeSuppliesArt className="mx-auto w-full max-w-md lg:max-w-none" />
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-6 pb-12">
          <h2 id="how-title" className="font-display text-2xl font-bold sm:text-3xl">كيف يعمل رِبح؟</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {STEPS.map(({ Icon, title, text }, i) => (
              <li key={title} className="rounded-m border border-line bg-surface/85 p-5 shadow-1">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full bg-kraft-soft text-kraft-text"><Icon className="size-6" /></span>
                  <span className="price text-sm text-muted">0{i + 1}</span>
                </div>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="example" aria-labelledby="example-title" className="sheet mb-12 scroll-mt-6 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="example-title" className="font-display text-2xl font-bold">الأرخص بالسعر ليس الأرخص فعليًا</h2>
            <span className="hatch rounded-s px-2 py-1 text-xs font-medium text-unknown">مثال توضيحي بأرقام خيالية</span>
          </div>
          <p className="mt-1 text-sm text-muted">٣٠٠٠ كوب ورقي ٨ أونصات مع أغطية، من ثلاثة موردين:</p>
          <ul className="mt-5 grid gap-4 md:grid-cols-3">
            {SAMPLE.map((s) => (
              <li key={s.name} className={`relative rounded-m border bg-surface p-4 ${s.best ? "border-meets shadow-[0_0_0_1px_var(--c-meets)]" : "border-line"}`}>
                {s.best && <span className="absolute -top-3 start-4 inline-flex items-center gap-1 rounded-full bg-meets px-2.5 py-0.5 text-xs font-semibold text-white"><CheckIcon className="size-3.5" /> الأنسب لك</span>}
                <p className="font-semibold">{s.name}</p>
                <dl className="mt-2">
                  <div className="leader"><dt>السعر الظاهر</dt><dd className="price">{s.shown}</dd></div>
                </dl>
                <p className="mt-1 text-xs text-muted">{s.note}</p>
                <div className={`mt-3 flex items-baseline justify-between rounded-s px-3 py-2.5 ${s.total ? (s.best ? "bg-meets-soft text-meets" : "bg-sunken") : "hatch text-unknown"}`}>
                  <span className="text-sm font-medium">التكلفة الفعلية</span>
                  {s.total ? <span className="price text-xl font-semibold">{s.total} <span className="text-sm">ر.س</span></span> : <span className="text-sm font-semibold">معلومة ناقصة</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-5 pb-6 text-xs text-muted sm:px-8"><span dir="ltr">Built with Llama</span> · الأرقام تحسبها قواعد التطبيق، ولا أرسل شيئًا للموردين.</footer>
    </div>
  );
}
