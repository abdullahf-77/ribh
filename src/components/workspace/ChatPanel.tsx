"use client";

import { useEffect, useRef, useState } from "react";
import { confirmedOffers } from "@/chat/state";
import type { ConversationState, ReplySource, TurnEvent } from "@/chat/types";
import { demoPaths, unsupportedExample } from "@/demo/chat-script";
import { CATEGORIES, CategoryId } from "@/domain/categories";
import { fieldValue } from "@/domain/offer-state";
import { BrandSymbol } from "../Brand";
import { Button, Chip, Spinner } from "../ui";
import { SECTION_LABEL, SectionId } from "./Sections";

export type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  source?: ReplySource;
  model?: string | null;
  targets: SectionId[];
  /** The result this message described. Once it differs from the current one, the message is marked outdated. */
  resultKey?: string;
  action?: "reanalyze";
  failed?: { text: string | null; event: TurnEvent | null; message: string; code: string };
};

export type Composer = { kind: "chat" } | { kind: "offer" } | { kind: "reply"; offerId: string };

/** Names the model that really answered. A reply from another family must never read as Llama. */
const sourceLabel = (m: Message) => {
  if (m.source === "demo") return "رد تجريبي محفوظ";
  if (m.source === "computed") return "محسوب من بياناتك";
  if (!m.model) return "رد الذكاء الاصطناعي";
  return /llama/i.test(m.model) ? "رد Llama" : `رد ${m.model.split("/").pop()}`;
};

const MIN = 320, MAX = 620;

export function ChatPanel({ className, mode, messages, busy, composer, onComposer, inputRef, state, currentKey, onSend, onRetry, onGoTo, pendingSwitch, onConfirmSwitch, onCancelSwitch, chooseReply, onChooseReply, onReanalyze, demoPath, onDemoPath }: {
  className: string; mode: "live" | "demo" | null; messages: Message[]; busy: boolean; composer: Composer; onComposer: (c: Composer) => void; inputRef: React.RefObject<HTMLTextAreaElement | null>; state: ConversationState;
  currentKey: string | null; onSend: (text: string, c: Composer) => boolean; onRetry: (id: number) => void; onGoTo: (s: SectionId) => void;
  pendingSwitch: { to: CategoryId; text: string | null } | null; onConfirmSwitch: () => void; onCancelSwitch: () => void; chooseReply: string | null; onChooseReply: (offerId: string) => void; onReanalyze: () => void;
  demoPath: string | null; onDemoPath: (id: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [width, setWidth] = useState(400);
  const [collapsed, setCollapsed] = useState(false);
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
  const nextDemo = mode === "demo" ? path?.steps.find((s) => !sent.has(s.text.replace(/\s+/g, " ").trim())) : null;
  const unconfirmed = state.offers.length - confirmedOffers(state).length;
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
      <div className="hidden items-center justify-between gap-2 px-4 pt-3 lg:flex">
        <h2 className="text-sm font-semibold text-muted">المساعد</h2>
        <button type="button" onClick={() => setCollapsed(true)} className="min-h-8 rounded-s px-2 text-xs text-muted hover:bg-sunken">طيّ</button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="المحادثة">
        <div className="space-y-4">
          {messages.map((m) => m.role === "user" ? (
            <div key={m.id} className="flex justify-start">
              <div dir="auto" className="max-h-48 max-w-[88%] overflow-y-auto whitespace-pre-wrap rounded-m rounded-tr-sm bg-accent px-3.5 py-2 text-sm text-accent-ink shadow-1">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="rise flex gap-2">
              <BrandSymbol className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                {m.failed ? (
                  <div role="alert" className="border-s-2 border-not ps-3 text-sm">
                    <p className="font-semibold text-not">{m.failed.code === "demo_unavailable" ? "هذا خارج الأمثلة" : "ما اكتمل الرد"}</p>
                    <p>{m.failed.code === "demo_unavailable" ? "في وضع التجربة أفهم رسائل الأمثلة الخيالية فقط. يمكنك تعبئة «احتياجي» يدويًا." : m.failed.message}</p>
                    {m.failed.code !== "demo_unavailable" && <div className="mt-2"><Button disabled={busy} onClick={() => onRetry(m.id)}>أعد المحاولة</Button></div>}
                  </div>
                ) : (
                  <>
                    <p dir="auto" className="whitespace-pre-wrap rounded-m rounded-tl-sm bg-sunken px-3.5 py-2 text-[15px] leading-7">{m.text}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      {m.source && <span>{sourceLabel(m)}</span>}
                      {m.targets.map((t) => <button key={t} type="button" onClick={() => onGoTo(t)} className="min-h-7 text-accent-text underline underline-offset-2">افتح {SECTION_LABEL[t]}</button>)}
                    </div>
                    {m.resultKey && m.resultKey !== currentKey && <p className="mt-1 text-xs text-unknown">تغيّرت البيانات بعد هذا الرد. النتيجة الحالية في «القرار».</p>}
                    {m.action === "reanalyze" && <div className="mt-2"><Button disabled={busy} onClick={onReanalyze}>أعد قراءة العروض</Button></div>}
                  </>
                )}
              </div>
            </div>
          ))}
          {pendingSwitch && state.requirements.category && (
            <div className="border-s-2 border-unknown ps-3 text-sm">
              <p className="font-semibold">نستبدل {CATEGORIES[state.requirements.category].label} بـ{CATEGORIES[pendingSwitch.to].label}؟</p>
              <p className="text-muted">تنمسح المواصفات والعروض الحالية.</p>
              <div className="mt-2 flex flex-wrap gap-2"><Button variant="primary" onClick={onConfirmSwitch}>نعم، استبدلها</Button><Button onClick={onCancelSwitch}>لا، أبقِها</Button></div>
            </div>
          )}
          {chooseReply && state.offers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {state.offers.map((o) => <Button key={o.id} disabled={busy} onClick={() => onChooseReply(o.id)}><bdi>{fieldValue<string>(o, "supplierName") || o.label}</bdi></Button>)}
            </div>
          )}
          {busy && <div className="flex items-center gap-2 text-sm text-muted" role="status"><Spinner /> أقرأ رسالتك…</div>}
        </div>
      </div>

      <div className="border-t border-line bg-surface px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2">
        <div aria-label="اقتراحات" className="mb-1.5 flex gap-1.5 overflow-x-auto pb-0.5 text-xs [scrollbar-width:none] empty:hidden">
          {nextDemo && <button type="button" disabled={busy} title={nextDemo.text} onClick={() => submit(nextDemo.text, { kind: "chat" })} className="hatch min-h-9 max-w-64 shrink-0 truncate rounded-s px-2.5 font-medium text-unknown disabled:opacity-50">مثال خيالي: {nextDemo.text.split("\n")[0]}</button>}
          {mode === "demo" && !nextDemo && (
            <>
              {demoPaths.filter((p) => p.id !== demoPath).map((p) => <button key={p.id} type="button" disabled={busy} onClick={() => { onDemoPath(p.id); submit(p.steps[0].text, { kind: "chat" }); }} className="hatch min-h-9 shrink-0 rounded-s px-2.5 font-medium text-unknown disabled:opacity-50">{p.label}</button>)}
              <button type="button" disabled={busy} onClick={() => submit(unsupportedExample, { kind: "chat" })} className="hatch min-h-9 shrink-0 rounded-s px-2.5 font-medium text-unknown disabled:opacity-50">منتج غير مدعوم</button>
            </>
          )}
          {state.offers.length < 3 && composer.kind === "chat" && state.requirements.category && <button type="button" onClick={() => { onComposer({ kind: "offer" }); inputRef.current?.focus(); }} className="chip-pick !min-h-9 shrink-0 !text-xs">ألصق عرض مورد</button>}
          {unconfirmed > 0 && <button type="button" onClick={() => onGoTo("offers")} className="chip-pick !min-h-9 shrink-0 !text-xs">أكّد العروض ({unconfirmed})</button>}
        </div>
        {composerLabel && (
          <div className="mb-1 flex items-center gap-2 text-xs">
            <Chip tone="accent"><bdi>{composerLabel}</bdi></Chip>
            <button type="button" onClick={() => onComposer({ kind: "chat" })} className="min-h-7 text-muted underline">إلغاء</button>
          </div>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(text, composer); }}>
          <textarea ref={inputRef} rows={1} dir="auto" value={text} aria-label="اكتب رسالتك"
            placeholder={composer.kind === "offer" ? "ألصق نص العرض كما وصلك" : composer.kind === "reply" ? "ألصق رد المورد كما وصلك" : "اكتب أو ألصق عرض مورد"}
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
