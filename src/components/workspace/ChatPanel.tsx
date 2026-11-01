"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationState, ReplySource, TurnEvent } from "@/chat/types";
import { CATEGORIES, CATEGORY_IDS, CategoryId } from "@/domain/categories";
import { demoPaths, unsupportedExample } from "@/demo/chat-script";
import { confirmedOffers } from "@/chat/state";
import { fieldValue } from "@/domain/offer-state";
import { BrandSymbol } from "../Brand";
import { Button, Chip, Spinner } from "../ui";
import { SECTIONS, SectionId } from "./Sections";

export type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  source?: ReplySource;
  targets: SectionId[];
  /** The result this message described. Once it differs from the current one, the message is marked outdated. */
  resultKey?: string;
  action?: "reanalyze";
  failed?: { text: string | null; event: TurnEvent | null; message: string; code: string };
};

export type Composer = { kind: "chat" } | { kind: "offer" } | { kind: "reply"; offerId: string };

const SOURCE_CHIP: Record<ReplySource, { label: string; tone: "accent" | "unknown" | "neutral" }> = {
  llama: { label: "رد Llama", tone: "accent" },
  demo: { label: "رد تجريبي محفوظ", tone: "unknown" },
  computed: { label: "محسوب من بياناتك", tone: "neutral" },
};

const MIN = 320, MAX = 620;

export function ChatPanel({ className, mode, messages, busy, composer, onComposer, inputRef, state, currentKey, onSend, onRetry, onGoTo, pendingSwitch, onConfirmSwitch, onCancelSwitch, chooseReply, onChooseReply, onReanalyze }: {
  className: string; mode: "live" | "demo" | null; messages: Message[]; busy: boolean; composer: Composer; onComposer: (c: Composer) => void; inputRef: React.RefObject<HTMLTextAreaElement | null>; state: ConversationState;
  currentKey: string | null; onSend: (text: string, c: Composer) => boolean; onRetry: (id: number) => void; onGoTo: (s: SectionId) => void;
  pendingSwitch: { to: CategoryId; text: string | null } | null; onConfirmSwitch: () => void; onCancelSwitch: () => void; chooseReply: string | null; onChooseReply: (offerId: string) => void; onReanalyze: () => void;
}) {
  const [text, setText] = useState("");
  const [width, setWidth] = useState(420);
  const [collapsed, setCollapsed] = useState(false);
  const [demoPath, setDemoPath] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const clamp = (w: number) => Math.min(MAX, Math.max(MIN, Math.min(w, window.innerWidth * 0.5)));
  const submit = (value: string, c: Composer) => {
    if (onSend(value, c)) { setText(""); if (inputRef.current) inputRef.current.style.height = ""; }
  };

  const sent = new Set(messages.filter((m) => m.role === "user").map((m) => m.text.replace(/\s+/g, " ").trim()));
  const path = demoPaths.find((p) => p.id === demoPath);
  const nextDemo = path?.steps.find((s) => !sent.has(s.text.replace(/\s+/g, " ").trim()));
  const unconfirmed = state.offers.length - confirmedOffers(state).length;
  const hasSession = state.requirements.category != null || state.offers.length > 0;
  const composerLabel = composer.kind === "offer" ? "نص عرض مورد" : composer.kind === "reply" ? `رد مورد: ${(() => { const o = state.offers.find((x) => x.id === composer.offerId); return (o && fieldValue<string>(o, "supplierName")) || o?.label; })()}` : null;

  if (collapsed) {
    return (
      <div className="hidden w-14 shrink-0 flex-col items-center gap-2 border-e border-line bg-surface py-3 lg:flex">
        <button type="button" aria-label="افتح المساعد" title="افتح المساعد" onClick={() => setCollapsed(false)} className="rounded-s p-1 hover:bg-sunken"><BrandSymbol className="size-8" /></button>
        <span className="text-xs text-muted [writing-mode:vertical-rl]">المساعد</span>
      </div>
    );
  }

  return (
    <aside aria-label="المساعد" style={{ "--panel": `${width}px` } as React.CSSProperties} className={`${className} relative min-h-0 w-full shrink-0 flex-col border-e border-line bg-surface lg:w-[var(--panel)]`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <h2 className="flex items-center gap-2 font-semibold"><BrandSymbol className="size-6" /> المساعد</h2>
        <button type="button" onClick={() => setCollapsed(true)} className="hidden min-h-9 rounded-s px-2 text-sm text-muted hover:bg-sunken lg:block">طيّ اللوحة</button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" role="log" aria-live="polite" aria-label="المحادثة">
        <div className="space-y-3">
          {messages.map((m) => m.role === "user" ? (
            <div key={m.id} className="flex justify-start">
              <div dir="auto" className="max-h-56 max-w-[88%] overflow-y-auto whitespace-pre-wrap rounded-m bg-accent px-3 py-2 text-sm text-accent-ink">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2">
              <BrandSymbol className="mt-1 size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                {m.failed ? (
                  <div role="alert" className="rounded-s border border-not/40 bg-not-soft p-3 text-sm">
                    <p className="font-semibold">{m.failed.code === "demo_unavailable" ? "هذا خارج أمثلة وضع التجربة" : "لم يكتمل الرد"}</p>
                    <p>{m.failed.code === "demo_unavailable" ? "في وضع التجربة أفهم رسائل الأمثلة الخيالية فقط. اختر مثالًا من الأسفل. لتحادثني بحرية يلزم تفعيل Llama. يمكنك أيضًا تعبئة المتطلبات والعروض يدويًا." : m.failed.message}</p>
                    {m.failed.code !== "demo_unavailable" && <div className="mt-2"><Button disabled={busy} onClick={() => onRetry(m.id)}>أعد المحاولة</Button></div>}
                  </div>
                ) : (
                  <>
                    <p dir="auto" className="whitespace-pre-wrap rounded-m border border-line bg-canvas px-3 py-2 text-sm leading-7">{m.text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {m.source && <Chip tone={SOURCE_CHIP[m.source].tone}>{SOURCE_CHIP[m.source].label}</Chip>}
                      {m.targets.map((t) => <button key={t} type="button" onClick={() => onGoTo(t)} className="min-h-7 rounded-s px-1.5 text-xs text-accent-text underline underline-offset-2">راجع: {SECTIONS.find((s) => s.id === t)?.label}</button>)}
                      {m.resultKey && m.resultKey !== currentKey && <Chip tone="unknown">تغيّرت البيانات بعد هذا الرد؛ النتيجة الحالية في المقارنة</Chip>}
                    </div>
                    {m.action === "reanalyze" && <div className="mt-2"><Button disabled={busy} onClick={onReanalyze}>أعد قراءة العروض</Button></div>}
                  </>
                )}
              </div>
            </div>
          ))}
          {pendingSwitch && state.requirements.category && (
            <div className="rounded-s border border-unknown/40 bg-unknown-soft p-3 text-sm">
              <p className="font-semibold">استبدال {CATEGORIES[state.requirements.category].label} بـ {CATEGORIES[pendingSwitch.to].label}؟</p>
              <div className="mt-2 flex flex-wrap gap-2"><Button variant="primary" onClick={onConfirmSwitch}>نعم، ابدأ مقارنة جديدة</Button><Button onClick={onCancelSwitch}>أبقِ الحالية</Button></div>
            </div>
          )}
          {chooseReply && state.offers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {state.offers.map((o) => <Button key={o.id} disabled={busy} onClick={() => onChooseReply(o.id)}><bdi>{fieldValue<string>(o, "supplierName") || o.label}</bdi></Button>)}
            </div>
          )}
          {busy && <div className="flex items-center gap-2 text-sm text-muted" role="status"><BrandSymbol className="size-6" /><Spinner /> جارٍ قراءة رسالتك وتجهيز الرد…</div>}
        </div>
      </div>

      <div className="border-t border-line bg-surface px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <div aria-label="أمثلة واقتراحات" className="mb-2">
          {mode === "demo" && !path && (
            <details open={!hasSession} className="text-xs">
              <summary className="min-h-7 cursor-pointer font-medium text-muted">أمثلة خيالية حسب المنتج</summary>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {demoPaths.map((p) => <button key={p.id} type="button" disabled={busy} onClick={() => { setDemoPath(p.id); submit(p.steps[0].text, { kind: "chat" }); }} className="hatch min-h-8 rounded-s px-2.5 font-medium text-unknown disabled:opacity-50">{p.label}</button>)}
                <button type="button" disabled={busy} onClick={() => submit(unsupportedExample, { kind: "chat" })} className="hatch min-h-8 rounded-s px-2.5 font-medium text-unknown disabled:opacity-50">منتج غير مدعوم</button>
              </div>
            </details>
          )}
          {mode === "live" && !hasSession && (
            <details open className="text-xs">
              <summary className="min-h-7 cursor-pointer font-medium text-muted">جرّب أن تكتب</summary>
              <div className="mt-1 flex flex-col gap-1">
                {CATEGORY_IDS.map((c) => <button key={c} type="button" onClick={() => { setText(CATEGORIES[c].example); inputRef.current?.focus(); }} className="min-h-8 truncate rounded-s border border-line px-2 text-start" dir="auto">{CATEGORIES[c].example}</button>)}
              </div>
            </details>
          )}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 text-xs [scrollbar-width:none]">
            {nextDemo && <button type="button" disabled={busy} title={nextDemo.text} onClick={() => submit(nextDemo.text, { kind: "chat" })} className="hatch min-h-8 max-w-60 shrink-0 truncate rounded-s px-2.5 font-medium text-unknown disabled:opacity-50">مثال خيالي: {nextDemo.text.split("\n")[0]}</button>}
            {path && <button type="button" onClick={() => setDemoPath(null)} className="min-h-8 shrink-0 rounded-s border border-line px-2.5">مثال آخر</button>}
            {state.offers.length < 3 && composer.kind === "chat" && <button type="button" onClick={() => { onComposer({ kind: "offer" }); inputRef.current?.focus(); }} className="min-h-8 shrink-0 rounded-s border border-line px-2.5">ألصق عرض مورد</button>}
            {unconfirmed > 0 && <button type="button" onClick={() => onGoTo("offers")} className="min-h-8 shrink-0 rounded-s border border-line px-2.5">أكّد العروض ({unconfirmed})</button>}
          </div>
        </div>
        {composerLabel && (
          <div className="mb-1 flex items-center gap-2 text-xs">
            <Chip tone="accent"><bdi>{composerLabel}</bdi></Chip>
            <button type="button" onClick={() => onComposer({ kind: "chat" })} className="min-h-7 text-muted underline">إلغاء</button>
          </div>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(text, composer); }}>
          <textarea ref={inputRef} rows={1} dir="auto" value={text} aria-label="اكتب رسالتك"
            placeholder={composer.kind === "offer" ? "ألصق نص العرض كما وصلك" : composer.kind === "reply" ? "ألصق رد المورد كما وصلك" : "اكتب رسالتك أو ألصق عرض مورد"}
            className="field max-h-40 resize-none text-sm"
            onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight + 2, 160)}px`; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(text, composer); } }} />
          <Button type="submit" variant="primary" busy={busy} disabled={!text.trim()} className="shrink-0">إرسال</Button>
        </form>
      </div>

      <div role="separator" aria-orientation="vertical" aria-label="تغيير عرض لوحة المساعد" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width} tabIndex={0}
        className="absolute inset-y-0 end-0 hidden w-1.5 cursor-col-resize hover:bg-accent/30 focus-visible:bg-accent/40 lg:block"
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (dragging.current) setWidth(clamp(window.innerWidth - e.clientX)); }}
        onPointerUp={() => { dragging.current = false; }}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") setWidth((w) => clamp(w + 24)); if (e.key === "ArrowRight") setWidth((w) => clamp(w - 24)); }} />
    </aside>
  );
}
