"use client";

import { useId, useState } from "react";
import { foldDigits } from "@/domain/evidence";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; busy?: boolean };

export function Button({ variant = "secondary", busy, children, className = "", disabled, ...rest }: BtnProps) {
  const look = {
    primary: "bg-accent text-accent-ink shadow-[0_8px_18px_-10px_rgb(40_100_219/0.9)] hover:brightness-110 active:translate-y-px",
    secondary: "bg-surface text-ink border border-line shadow-1 hover:bg-kraft-soft",
    ghost: "text-accent-text hover:bg-accent-soft",
  }[variant];
  return (
    <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-s px-4 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${look} ${className}`}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export const Spinner = () => <span aria-hidden className="spin inline-block size-4 rounded-full border-2 border-current border-t-transparent" />;

export function Card({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={`rounded-m border border-line bg-surface p-4 shadow-1 sm:p-5 ${className}`}>{children}</div>;
}

export function Labeled({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-muted" dir="auto">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-not">{error}</p>}
    </div>
  );
}

export const parseNumber = (raw: string): number | null => {
  const s = foldDigits(raw).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** Accepts Arabic or Latin digits. Keeps what is typed until it is a valid number. Empty means unknown, never zero. */
export function NumberField({ label, value, onChange, hint, integer, min = 0, placeholder = "غير محدد" }: {
  label: string; value: number | null; onChange: (v: number | null) => void; hint?: string; integer?: boolean; min?: number; placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  return (
    <Labeled label={label} hint={hint} error={error}>
      {(id) => (
        <input id={id} className="field" inputMode={integer ? "numeric" : "decimal"} placeholder={placeholder} dir="ltr" style={{ textAlign: "right" }}
          aria-invalid={!!error} value={draft ?? (value == null ? "" : String(value))}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseNumber(e.target.value);
            if (n === null) { setError(undefined); onChange(null); return; }
            if (Number.isNaN(n) || n <= min - 1e-9 || (integer && !Number.isInteger(n))) { setError(integer ? "أدخل عددًا صحيحًا موجبًا." : "أدخل رقمًا صحيحًا."); return; }
            setError(undefined);
            onChange(n);
          }}
          onBlur={() => { if (!error) setDraft(null); }} />
      )}
    </Labeled>
  );
}

export function SelectField({ label, value, options, onChange, hint, unknownLabel = "غير محدد" }: {
  label: string; value: string | null; options: Record<string, string>; onChange: (v: string | null) => void; hint?: string; unknownLabel?: string;
}) {
  return (
    <Labeled label={label} hint={hint}>
      {(id) => (
        <select id={id} className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{unknownLabel}</option>
          {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      )}
    </Labeled>
  );
}

export function TextField({ label, value, onChange, hint, type = "text" }: { label: string; value: string | null; onChange: (v: string | null) => void; hint?: string; type?: string }) {
  return (
    <Labeled label={label} hint={hint}>
      {(id) => <input id={id} type={type} className="field" dir="auto" value={value ?? ""} placeholder={type === "text" ? "غير محدد" : undefined} onChange={(e) => onChange(e.target.value || null)} />}
    </Labeled>
  );
}

export const boolOptions = { yes: "نعم", no: "لا" };
export const fromBool = (v: boolean | null) => (v == null ? null : v ? "yes" : "no");
export const toBool = (v: string | null) => (v == null ? null : v === "yes");

export type Tone = "meets" | "not" | "unknown" | "neutral" | "accent";

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const look = {
    meets: "bg-meets-soft text-meets",
    not: "bg-not-soft text-not",
    unknown: "hatch text-unknown font-medium",
    neutral: "bg-sunken text-muted",
    accent: "bg-accent-soft text-accent-text",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-s px-2 py-0.5 text-xs font-medium ${look}`}>{children}</span>;
}

export const StatusChip = ({ status }: { status: "meets" | "not" | "unknown" }) => (
  <Chip tone={status}>{status === "meets" ? "يستوفي" : status === "not" ? "لا يستوفي" : "غير معروف"}</Chip>
);

export function Note({ tone, title, children, actions }: { tone: "info" | "error" | "warn" | "ok"; title?: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  const look = {
    info: "border-accent/30 bg-accent-soft",
    error: "border-not/40 bg-not-soft",
    warn: "border-unknown/40 bg-unknown-soft",
    ok: "border-meets/40 bg-meets-soft",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-s border p-3 text-sm ${look}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function CopyButton({ text, label = "انسخ" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  return (
    <Button disabled={!text.trim()} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied("ok"); } catch { setCopied("fail"); }
      setTimeout(() => setCopied(null), 2200);
    }}>
      <span aria-live="polite">{copied === "ok" ? "تم النسخ" : copied === "fail" ? "حدد النص وانسخه يدويًا" : label}</span>
    </Button>
  );
}
