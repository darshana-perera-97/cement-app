import { DetailModalShell } from './detailModalShared';
import { RowDetailContent, getRowDetailMeta } from './rowDetailContent';

/**
 * Structured read-only popup for table row details.
 * Pass `variant` for a user-friendly layout; omit for a simple field dump fallback.
 */
export default function RowDetailModal({
  open,
  row,
  onClose,
  variant = null,
  title = null,
  subtitle = null,
  actions = null,
}) {
  if (!open || row == null || typeof row !== 'object') return null;

  const meta = variant ? getRowDetailMeta(variant, row) : { title: 'Details', subtitle: null };
  const finalTitle = title ?? meta.title;
  const finalSubtitle = subtitle ?? meta.subtitle;
  const panelSizeClassName = variant === 'incentive' ? 'max-w-3xl' : 'max-w-lg';

  return (
    <DetailModalShell
      open={open}
      onClose={onClose}
      title={finalTitle}
      subtitle={finalSubtitle}
      actions={actions}
      panelSizeClassName={panelSizeClassName}
    >
      {variant ? (
        <RowDetailContent variant={variant} row={row} />
      ) : (
        <RawRowDump row={row} />
      )}
    </DetailModalShell>
  );
}

function formatDetailValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'string') return value === '' ? '—' : value;
  if (Array.isArray(value)) return value.length === 0 ? '—' : JSON.stringify(value, null, 2);
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function humanizeKey(key) {
  return String(key)
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function RawRowDump({ row }) {
  const entries = Object.entries(row).filter(([, v]) => typeof v !== 'function');

  return (
    <dl className="mt-4 space-y-3">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{humanizeKey(key)}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{formatDetailValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Shared interaction pattern for data tables: click row or Enter/Space to open details. */
export function detailRowAttrs(openDetail, extraClassName = '') {
  return {
    tabIndex: 0,
    role: 'button',
    title: 'Click to view full row',
    className: `cursor-pointer outline-none transition-colors focus-visible:bg-indigo-50/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${extraClassName}`.trim(),
    onClick: openDetail,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail();
      }
    },
  };
}
