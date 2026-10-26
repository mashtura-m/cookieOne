import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Cat, ScanStatus } from '../api';

export function Button({ variant = 'default', size, busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm'; busy?: boolean }) {
  return (
    <button {...rest} className={`btn btn-${variant}${size ? ' btn-sm' : ''} ${rest.className ?? ''}`} disabled={rest.disabled || busy}>
      {busy ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-h">
          {title ? <h2>{title}</h2> : <span />}
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <small className="hint">{hint}</small> : null}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-h">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export const CATEGORY_LABEL: Record<Cat, string> = {
  necessary: 'Necessary', preferences: 'Preferences', statistics: 'Statistics', marketing: 'Marketing', unclassified: 'Unclassified',
};

export function CatPill({ cat }: { cat: Cat }) {
  return <span className={`pill cat-${cat}`}>{CATEGORY_LABEL[cat]}</span>;
}

const STATUS_LABEL: Record<ScanStatus, string> = { queued: 'Queued', running: 'Scanning', completed: 'Completed', failed: 'Failed' };
export function StatusPill({ status }: { status: ScanStatus }) {
  return <span className={`pill st-${status}`}>{status === 'running' ? <span className="spinner sm" aria-hidden /> : null}{STATUS_LABEL[status]}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function Loading() {
  return <div className="loading"><span className="spinner" aria-hidden /> Loading…</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="alert alert-bad" role="alert">{error}</div> : null;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-h">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-b">{children}</div>
        {footer ? <footer className="modal-f">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  return (
    <div className="copybox">
      {label ? <div className="copybox-l">{label}</div> : null}
      <div className="copybox-row">
        <code>{value}</code>
        <Button size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>
  );
}

export function fmtDate(s: string | null | undefined, withTime = true): string {
  if (!s) return '—';
  const d = new Date(s);
  return withTime ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

// ---- Toasts ----------------------------------------------------------------
const ToastCtx = createContext<(msg: string, bad?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; bad: boolean; id: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={(msg, bad = false) => setToast({ msg, bad, id: Date.now() })}>
      {children}
      {toast ? <div className={`toast${toast.bad ? ' toast-bad' : ''}`} role="status">{toast.msg}</div> : null}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
