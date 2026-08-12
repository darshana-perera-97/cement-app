import { useEffect } from 'react';

export function displayText(value) {
  const text = value == null ? '' : String(value).trim();
  return text || '—';
}

export function formatMoney(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

export function formatAmount(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

export function formatDateTime(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '—';
  return raw.slice(0, 19).replace('T', ' ');
}

export function SummaryField({ label, value, className = '', valueClassName = '' }) {
  return (
    <div className={`rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100 ${className}`}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm font-medium text-slate-900 ${valueClassName}`}>{value}</dd>
    </div>
  );
}

export function SummaryGrid({ children, className = '' }) {
  return <dl className={`mt-4 grid grid-cols-2 gap-3 ${className}`}>{children}</dl>;
}

export function SectionHeading({ children }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</p>;
}

export function NoteBlock({ label = 'Note', value }) {
  return (
    <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{displayText(value)}</p>
    </div>
  );
}

export function brandHasBags(row, brandKey) {
  return (Number(row[`${brandKey}Bags`]) || 0) > 0;
}

export function brandHasLoadActivity(row, brandKey) {
  const bags = Number(row[`${brandKey}Bags`]) || 0;
  const cost = Number(row[`${brandKey}Cost`]) || 0;
  const inv = String(row[`${brandKey}Invoice`] ?? '').trim();
  const chq = String(row[`${brandKey}Cheque`] ?? '').trim();
  return bags > 0 || cost > 0 || inv || chq;
}

export function BrandSectionShell({ brand, active, emptyText, children }) {
  return (
    <section
      className={`overflow-hidden rounded-xl ring-1 ${active ? `${brand.ring} ring-slate-100` : 'ring-slate-100 opacity-80'}`}
    >
      <div className={`px-3 py-2 text-sm font-semibold ${brand.ledger.head}`}>{brand.label}</div>
      {active ? children : <p className="bg-white px-3 py-2.5 text-sm text-slate-400">{emptyText}</p>}
    </section>
  );
}

export function BrandFieldCell({ brand, lead = false, label, value, valueClassName = '' }) {
  const cellClass = lead ? brand.ledger.cellLead : brand.ledger.cell;
  return (
    <div className={`bg-white px-3 py-2.5 ${cellClass}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-slate-900 ${valueClassName}`}>{value}</dd>
    </div>
  );
}

export function BrandSections({ title, children }) {
  return (
    <div className="mt-5">
      {title ? <SectionHeading>{title}</SectionHeading> : null}
      <div className={`space-y-3 ${title ? 'mt-3' : ''}`}>{children}</div>
    </div>
  );
}

export function DetailModalShell({
  open,
  onClose,
  title,
  subtitle,
  titleId = 'row-detail-modal-title',
  children,
  actions = null,
  panelSizeClassName = 'max-w-lg',
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[101] flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div className={`relative z-10 w-full min-h-0 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 ${panelSizeClassName}`}>
        <div className="min-h-0 max-h-[min(90vh,calc(100dvh-3rem))] overflow-y-auto overscroll-contain p-6">
          <h2 id={titleId} className="text-lg font-bold text-slate-900">
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          {children}
          {actions}
          <button
            type="button"
            onClick={onClose}
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-md"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
