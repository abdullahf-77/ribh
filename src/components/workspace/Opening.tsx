"use client";

import { useState } from "react";
import { CATEGORIES } from "@/domain/categories";
import { demoPaths } from "@/demo/chat-script";
import { BrandLogo } from "../Brand";
import { Button } from "../ui";

const LIVE_EXAMPLES = [CATEGORIES.cups.example, CATEGORIES.napkins.example, CATEGORIES.takeaway.example];
const DEMO_EXAMPLES = ["cups", "napkins", "takeaway"].map((id) => demoPaths.find((p) => p.id === id)!);

/** The first thing anyone sees: one sentence, one input, three ways to begin. */
export function Opening({ mode, onSend, onDemo }: { mode: "live" | "demo" | null; onSend: (text: string) => void; onDemo: (pathId: string) => void }) {
  const [text, setText] = useState("");
  const [empty, setEmpty] = useState(false);
  const submit = () => {
    if (!text.trim()) { setEmpty(true); return; }
    onSend(text);
  };
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-6 sm:px-8">
      <header className="flex items-center justify-between gap-3">
        <BrandLogo className="h-11 w-auto" />
        {mode === "demo" && <span className="hatch rounded-s px-2 py-1 text-xs font-medium text-unknown">وضع تجربة بأمثلة خيالية</span>}
      </header>

      <div className="rise flex flex-1 flex-col justify-center py-10">
        <h1 className="font-display text-4xl leading-[1.25] font-bold sm:text-6xl sm:leading-[1.2]">قبل ما تدفع،<br />اعرف أي عرض يناسبك.</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">قل لي وش يحتاج مقهاك، وألصق عروض الموردين كما وصلتك. أحسب لك التكلفة الفعلية، وأبيّن لك الناقص.</p>

        <form className="sheet mt-8 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor="first-message" className="mb-2 block text-sm font-medium">وش تبي تشتري؟</label>
          <textarea id="first-message" rows={2} dir="auto" autoFocus value={text} aria-invalid={empty} aria-describedby={empty ? "first-error" : undefined}
            className="w-full resize-none border-0 border-b-2 border-field-line bg-transparent pb-2 text-lg outline-none transition focus:border-accent"
            placeholder="مثال: أحتاج ٣٠٠٠ كوب ورقي مقاس ٨ أونصات"
            onChange={(e) => { setText(e.target.value); setEmpty(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {empty ? <p id="first-error" role="alert" className="text-sm text-not">اكتب طلبك أولًا، أو اختر مثالًا.</p> : <p className="text-sm text-muted">أكواب، أغطية، أكياس، مناديل، وعبوات سفري</p>}
            <Button type="submit" variant="primary">ابدأ</Button>
          </div>
        </form>

        <div className="mt-5" aria-label="أمثلة">
          <p className="text-sm text-muted">{mode === "demo" ? "جرّب مثالًا خياليًا:" : "أو ابدأ بمثال:"}</p>
          <ul className="mt-1 divide-y divide-line">
            {mode === "demo"
              ? DEMO_EXAMPLES.map((p) => <li key={p.id}><button type="button" onClick={() => onDemo(p.id)} className="example">{p.steps[0].text}</button></li>)
              : LIVE_EXAMPLES.map((ex) => <li key={ex}><button type="button" onClick={() => onSend(ex)} className="example">{ex}</button></li>)}
          </ul>
        </div>
      </div>

      <footer className="text-xs text-muted"><span dir="ltr">Built with Llama</span> · الأرقام تحسبها قواعد التطبيق، ولا أرسل شيئًا للموردين.</footer>
    </main>
  );
}
