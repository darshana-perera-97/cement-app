/**
 * Shared helpers and layout for table search / filter bars on dashboard pages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Spinner shown while page / table data is fetching.
 * @param {object} props
 * @param {string} [props.label='Loading…']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {string} [props.className]
 * @param {boolean} [props.labelHidden] hide label visually (kept for screen readers)
 */
export function LoadingSpinner({ label = 'Loading…', size = 'md', className = '', labelHidden = false }) {
  const dim =
    size === 'sm'
      ? 'h-3.5 w-3.5 border-[1.5px]'
      : size === 'lg'
        ? 'h-7 w-7 border-2'
        : 'h-5 w-5 border-2';
  return (
    <span
      role="status"
      className={`inline-flex items-center justify-center gap-2.5 text-sm text-slate-500 ${className}`.trim()}
    >
      <span
        className={`inline-block shrink-0 animate-spin rounded-full border-slate-200 border-t-indigo-500 ${dim}`}
        aria-hidden="true"
      />
      {label ? (
        <span className={labelHidden ? 'sr-only' : undefined}>{label}</span>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </span>
  );
}

export function rowMatchesQuery(q, parts) {
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return true;
  return parts.some((p) => String(p ?? '').toLowerCase().includes(s));
}

/** dateStr is YYYY-MM-DD */
export function inDateRange(dateStr, from, to) {
  if (!from && !to) return true;
  const d = String(dateStr ?? '');
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function TableFiltersBar({ children, hint, className = '' }) {
  return (
    <div
      className={`rounded-[20px] bg-white p-3 shadow-md shadow-slate-200/30 ring-1 ring-slate-100 sm:p-4 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end [&>*]:w-full sm:[&>*]:w-auto">
        {children}
      </div>
      {hint ? (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs tabular-nums text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** className for text/date/select inputs inside filter bars */
export const filterControl =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

/** Prefer these over hard-coded min-w on filter labels so mobile stacks cleanly. */
export const filterLabel =
  'block w-full min-w-0 text-sm font-medium text-slate-600 sm:min-w-[9rem] sm:flex-1';

export const filterLabelNarrow =
  'block w-full min-w-0 text-sm font-medium text-slate-600 sm:min-w-[7.5rem]';

/** Fixed overlay dialogs: cap height and scroll on short viewports (`min-h-0` keeps flex layouts from blocking overflow). */
export const modalPanelClass =
  'relative z-10 min-h-0 w-full max-h-[min(90vh,calc(100dvh-3rem))] max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl rounded-b-none bg-white p-4 shadow-2xl ring-1 ring-slate-200 sm:rounded-2xl sm:p-6';

export const modalPanelClassMd =
  'relative z-10 min-h-0 w-full max-h-[min(90vh,calc(100dvh-3rem))] max-w-md overflow-y-auto overscroll-contain rounded-t-2xl rounded-b-none bg-white p-4 shadow-2xl ring-1 ring-slate-200 sm:rounded-[20px] sm:p-6';

export const modalPanelClass2xl =
  'relative z-10 min-h-0 w-full max-h-[min(90vh,calc(100dvh-3rem))] max-w-2xl overflow-y-auto overscroll-contain rounded-t-2xl rounded-b-none bg-white p-4 shadow-2xl ring-1 ring-slate-200 sm:rounded-2xl sm:p-6';

export const modalPanelClass3xl =
  'relative z-10 min-h-0 w-full max-h-[min(90vh,calc(100dvh-3rem))] max-w-3xl overflow-y-auto overscroll-contain rounded-t-2xl rounded-b-none bg-white p-4 shadow-2xl ring-1 ring-slate-200 sm:rounded-2xl sm:p-6';

export const modalPanelClass4xl =
  'relative z-10 min-h-0 w-full max-h-[min(90vh,calc(100dvh-3rem))] max-w-6xl overflow-y-auto overscroll-contain rounded-t-2xl rounded-b-none bg-white p-4 shadow-2xl ring-1 ring-slate-200 sm:rounded-2xl sm:p-6';

/** Full-screen dimmed layer; clicking it should call `onClose`. Place before the dialog panel. */
export function ModalBackdrop({ onClose, className = '' }) {
  return (
    <button
      type="button"
      className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm ${className}`.trim()}
      aria-label="Close"
      onClick={onClose}
    />
  );
}

/**
 * Wrapper for data tables: vertical + horizontal scroll with a max height so
 * `position: sticky` on `<thead>` keeps headers visible while scrolling rows.
 * Use with `hidden sm:block` — phones use {@link MobileRowCard} lists instead.
 */
export const scrollTableWrap =
  'max-h-[min(70vh,40rem)] overflow-auto rounded-[20px] bg-white shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:max-h-[min(75vh,40rem)]';

/** Apply to `<thead>` (sticky within {@link scrollTableWrap}). */
export const stickyThead =
  'sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 shadow-[0_1px_0_0_rgb(241_245_249)] backdrop-blur-sm';

/** For tables with custom header cell colors (e.g. brand columns); use instead of opaque stickyThead bg. */
export const stickyTheadTransparent =
  'sticky top-0 z-10 border-b border-slate-200 bg-white/90 shadow-[0_1px_0_0_rgb(241_245_249)] backdrop-blur-sm';

/**
 * Sticky first column for tablet+ horizontal scroll.
 * Apply to the first `th` / `td` in each row (identity column).
 */
export const stickyFirstTh =
  'sticky left-0 z-[12] bg-slate-50/95 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)] backdrop-blur-sm';

export const stickyFirstThTransparent =
  'sticky left-0 z-[12] bg-white/95 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)] backdrop-blur-sm';

export const stickyFirstTd =
  'sticky left-0 z-[11] bg-white shadow-[2px_0_4px_-2px_rgba(15,23,42,0.06)]';

export const stickyFirstTdMuted =
  'sticky left-0 z-[11] bg-slate-50/95 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.06)]';

/** Mobile-only list wrapper (`sm:hidden`). Pair with `hidden sm:block` + scrollTableWrap. */
export const mobileCardList =
  'space-y-3 sm:hidden';

/**
 * Compact card for one data row on phones.
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {React.ReactNode} [props.badge]
 * @param {{ label: string, value: React.ReactNode }[]} [props.fields]
 * @param {React.ReactNode} [props.actions]
 * @param {() => void} [props.onClick]
 * @param {string} [props.className]
 */
export function MobileRowCard({
  title,
  subtitle,
  badge,
  fields = [],
  actions,
  onClick,
  className = '',
}) {
  const shellClass =
    `rounded-2xl bg-white p-4 shadow-md shadow-slate-200/30 ring-1 ring-slate-100 ${
      onClick ? 'cursor-pointer transition hover:ring-indigo-200/80' : ''
    } ${className}`.trim();

  return (
    <div
      className={shellClass}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      {fields.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {fields.map((f, i) => (
            <div key={`${f.label}-${i}`} className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {f.label}
              </dt>
              <dd className="mt-0.5 break-words text-sm font-medium tabular-nums text-slate-800">
                {f.value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
/** Options in the rows-per-page control (values must be positive integers). */
export const PAGE_SIZE_OPTIONS = [8, 10, 25, 50, 100];

const paginationBtn =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40';

const paginationSelect =
  'rounded-lg border-0 bg-slate-100 py-1.5 pl-2 pr-8 text-xs font-medium text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

/**
 * Client-side pagination over an already-filtered list.
 *
 * @param {number} totalCount - Length of the filtered list.
 * @param {unknown[]} resetDeps - When any entry changes, page resets to 1.
 * @param {number} [defaultPageSize=10]
 */
export function useTablePagination(totalCount, resetDeps, defaultPageSize = 10) {
  const initialSize =
    typeof defaultPageSize === 'number' && defaultPageSize > 0
      ? defaultPageSize
      : 10;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => initialSize);

  const setPageSize = useCallback((n) => {
    setPageSizeState(n);
    setPage(1);
  }, []);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies filter identity
  }, resetDeps);

  const totalPages = useMemo(() => {
    if (totalCount <= 0) return 1;
    return Math.max(1, Math.ceil(totalCount / pageSize));
  }, [totalCount, pageSize]);

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const pageSafe = Math.min(page, totalPages);
  const offset = (pageSafe - 1) * pageSize;

  return {
    page: pageSafe,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    offset,
  };
}

/** When {@link defaultPageSize} is not in {@link PAGE_SIZE_OPTIONS}, include it so the select stays valid. */
export function pageSizeOptionsWith(defaultPageSize) {
  const n = typeof defaultPageSize === 'number' && defaultPageSize > 0 ? defaultPageSize : 10;
  if (PAGE_SIZE_OPTIONS.includes(n)) return PAGE_SIZE_OPTIONS;
  return [n, ...PAGE_SIZE_OPTIONS].sort((a, b) => a - b);
}

/**
 * Rows-per-page + prev/next + page indicator. Place below the scrollable table wrapper.
 */
export function TablePaginationBar({
  page,
  totalPages,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className = '',
}) {
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}
    >
      <p className="text-xs tabular-nums text-slate-500">
        {totalCount === 0
          ? 'No rows on this page.'
          : `${from}–${to} of ${totalCount.toLocaleString()}`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className={paginationSelect}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={paginationBtn}
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
            aria-label="First page"
          >
            First
          </button>
          <button
            type="button"
            className={paginationBtn}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            Prev
          </button>
          <span className="px-1 text-xs tabular-nums text-slate-600">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            className={paginationBtn}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            Next
          </button>
          <button
            type="button"
            className={paginationBtn}
            disabled={page >= totalPages}
            onClick={() => onPageChange(totalPages)}
            aria-label="Last page"
          >
            Last
          </button>
        </div>
      </div>
    </div>
  );
}
