import { createContext, useContext, useEffect, useId, useState, useCallback } from "react";
import { useDebounced, useFetch } from "./hooks";

export const cx = (...a) => a.filter(Boolean).join(" ");

export const inputCls =
  "w-full rounded border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand";
export const thCls = "px-3 py-2 text-left text-sm font-bold text-muted whitespace-nowrap";
export const tdCls = "px-3 py-2.5 text-sm align-middle";
export const tableWrap = "relative overflow-x-auto rounded border border-line bg-white";

export function Button({ variant = "secondary", className, ...props }) {
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-dark border-brand",
    secondary: "bg-white text-ink hover:bg-panel border-line",
  };
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "rounded border px-3.5 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant], className
      )}
    />
  );
}

export function PageHeader({ title, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-bold">{label}</label>
      {typeof children === "function" ? children(id) : children}
      {hint && <span className="mt-1 block text-sm text-muted">{hint}</span>}
    </div>
  );
}

export function Alert({ kind = "error", children }) {
  if (!children) return null;
  const tone = kind === "error" ? "border-bad bg-bad-soft text-bad" : "border-warn-bar bg-warn-soft text-warn";
  return <div role="alert" className={cx("rounded border px-3 py-2 text-sm", tone)}>{children}</div>;
}

export function Loading({ label = "Loading" }) {
  return <p className="py-8 text-center text-sm text-muted" role="status">{label}…</p>;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="rounded border border-bad bg-bad-soft p-4 text-sm text-bad" role="alert">
      <p className="font-bold">Couldn't load this data</p>
      <p className="mt-1">{error.message}</p>
      {onRetry && <Button className="mt-3" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="rounded border border-dashed border-line bg-white px-6 py-10 text-center">
      <p className="font-bold">{title}</p>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}

export function Pager({ page, perPage, total, onPage }) {
  if (!total) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const last = Math.ceil(total / perPage);
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-muted">Showing {from}–{to} of {total.toLocaleString("en-US")}</span>
      <div className="flex gap-2">
        <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button disabled={page >= last} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 sm:p-10"
         onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
           className="w-full max-w-lg rounded border border-line bg-panel p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded px-2 py-1 text-xl leading-none text-muted hover:text-ink">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Stock gauge: the bar is current quantity, the tick marks the reorder level.
 * Bar turns amber at or below the tick and red at zero, so low stock reads at a glance.
 */
export function StockGauge({ quantity, reorderLevel }) {
  const scale = Math.max(quantity, reorderLevel, 1) * 1.15;
  const pct = (quantity / scale) * 100;
  const tick = (reorderLevel / scale) * 100;
  const low = quantity <= reorderLevel;
  const state = quantity === 0 ? "out of stock" : low ? "at or below reorder level" : "healthy";
  const color = quantity === 0 ? "bg-bad" : low ? "bg-warn-bar" : "bg-ok";
  return (
    <div className="flex items-center gap-3" title={`${quantity} in stock, reorder at ${reorderLevel}`}>
      <span className="w-9 text-right text-sm font-bold">{quantity}</span>
      <div className="relative h-2.5 w-28 rounded-sm bg-line/60" role="img"
           aria-label={`${quantity} in stock, reorder level ${reorderLevel}: ${state}`}>
        <div className={cx("h-full rounded-sm", color)} style={{ width: `${pct}%` }} />
        <div className="absolute -top-1 h-4.5 w-0.5 bg-ink" style={{ left: `${tick}%` }} />
      </div>
      <span className={cx("text-sm", low ? "font-bold text-warn" : "text-muted")}>
        {low ? "reorder" : `min ${reorderLevel}`}
      </span>
    </div>
  );
}

/** Search-as-you-type picker over a paginated list endpoint (products, suppliers). */
export function Picker({ label, path, labelOf, value, onChange }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, loading } = useFetch(value ? null : path, { q: dq, per_page: 6 });
  return (
    <Field label={label}>
      {(id) =>
        value ? (
          <div className="flex items-center justify-between rounded border border-line bg-white px-3 py-2 text-sm">
            <span>{labelOf(value)}</span>
            <button type="button" className="font-bold text-brand hover:underline" onClick={() => onChange(null)}>Change</button>
          </div>
        ) : (
          <div>
            <input id={id} className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search" autoComplete="off" />
            <ul className="mt-1 max-h-44 overflow-y-auto rounded border border-line bg-white">
              {loading && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
              {data?.items.map((item, i) => (
                <li key={i}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-panel" onClick={() => onChange(item)}>
                    {labelOf(item)}
                  </button>
                </li>
              ))}
              {data && !data.items.length && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
            </ul>
          </div>
        )
      }
    </Field>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="rounded border border-ok bg-white px-4 py-2.5 text-sm shadow-lg">{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
