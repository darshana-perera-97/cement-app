import { inDateRange } from './tableToolbar';
import { cashPortion } from './paymentCheques';
import { CASH_BOOK_CATEGORY_LABELS, cashBookEntryDetail } from './cashBookCategories';

function compareByDateAsc(a, b) {
  const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
  if (dateCmp !== 0) return dateCmp;
  const aSort = a.sortAt || `${a.date || ''}T12:00:00`;
  const bSort = b.sortAt || `${b.date || ''}T12:00:00`;
  return new Date(aSort).getTime() - new Date(bSort).getTime();
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function applyEntryToBalance(balance, entry) {
  const debit = Number(entry.debit) || 0;
  const credit = Number(entry.credit) || 0;
  return roundMoney(balance + debit - credit);
}

/** Cash on hand before any activity on `beforeYmd` (YYYY-MM-DD). */
export function computeCashBalanceBeforeDate(sourceEntries, beforeYmd) {
  if (!beforeYmd) return 0;
  let balance = 0;
  const sorted = [...sourceEntries].sort(compareByDateAsc);
  for (const entry of sorted) {
    if (String(entry.date || '') >= beforeYmd) break;
    balance = applyEntryToBalance(balance, entry);
  }
  return balance;
}

/** Raw cashier movements: customer cash in + all cash book outflows (including bank deposits). */
export function buildCashBookSourceEntries(payments, cashBookEntries) {
  const entries = [];

  for (const p of Array.isArray(payments) ? payments : []) {
    const cashIn = cashPortion(p);
    if (cashIn <= 0) continue;
    const date = String(p.date ?? '').slice(0, 10);
    const customerName = String(p.customerName ?? '').trim() || '—';
    const billNumber = p.billNumber != null ? String(p.billNumber) : '—';
    entries.push({
      id: `in:${p.id}`,
      kind: 'cash_in',
      date,
      sortAt: p.createdAt || `${date}T12:00:00`,
      type: 'Customer cash',
      details: [customerName !== '—' ? customerName : '', billNumber !== '—' ? `Bill #${billNumber}` : '']
        .filter(Boolean)
        .join(' · ') || '—',
      debit: cashIn,
      credit: null,
      recordedBy: String(p.recordedBy ?? '').trim() || '—',
      detailKind: 'cash_in',
      detailRow: {
        id: p.id,
        date: date || '—',
        customerName,
        billNumber,
        cashIn,
        recordedBy: String(p.recordedBy ?? '').trim() || '—',
        sortAt: p.createdAt || `${date}T12:00:00`,
      },
    });
  }

  for (const e of Array.isArray(cashBookEntries) ? cashBookEntries : []) {
    const date = String(e.date ?? '').slice(0, 10);
    const amt = Math.max(0, Number(e.amount) || 0);
    const isBankDeposit = String(e.category ?? '').trim() === 'bank_deposit';
    entries.push({
      id: `out:${e.id}`,
      kind: isBankDeposit ? 'bank_deposit' : 'expense',
      date,
      sortAt: e.createdAt || `${date}T12:00:00`,
      type: CASH_BOOK_CATEGORY_LABELS[e.category] || e.category || 'Expense',
      details: cashBookEntryDetail(e),
      debit: null,
      credit: amt,
      recordedBy: String(e.recordedBy ?? '').trim() || '—',
      detailKind: 'expense',
      detailRow: e,
    });
  }

  return entries;
}

/**
 * Chronological cash ledger: debit = cash in, credit = cash out, balance = cash on hand.
 * When `dateFrom` is set, prepends a starting-balance row.
 */
export function buildCashBookLedgerRows(sourceEntries, { dateFrom = '', dateTo = '' } = {}) {
  const sorted = [...sourceEntries].sort(compareByDateAsc);
  const rows = [];
  let balance = dateFrom ? computeCashBalanceBeforeDate(sourceEntries, dateFrom) : 0;

  if (dateFrom) {
    rows.push({
      id: 'starting-balance',
      kind: 'starting',
      date: dateFrom,
      type: 'Starting balance',
      details: 'Cash on hand before this period',
      debit: null,
      credit: null,
      balance,
      recordedBy: '—',
      detailKind: null,
      detailRow: null,
    });
  }

  for (const entry of sorted) {
    if (!inDateRange(entry.date, dateFrom, dateTo)) continue;
    balance = applyEntryToBalance(balance, entry);
    rows.push({
      id: entry.id,
      kind: entry.kind,
      date: entry.date,
      type: entry.type,
      details: entry.details,
      debit: entry.debit,
      credit: entry.credit,
      balance,
      recordedBy: entry.recordedBy,
      detailKind: entry.detailKind,
      detailRow: entry.detailRow,
    });
  }

  return rows;
}

export function summarizeCashBookLedger(ledgerRows) {
  let debit = 0;
  let credit = 0;
  let count = 0;
  for (const row of ledgerRows) {
    if (row.kind === 'starting') continue;
    count += 1;
    debit += Number(row.debit) || 0;
    credit += Number(row.credit) || 0;
  }
  const closing = ledgerRows.length > 0 ? Number(ledgerRows[ledgerRows.length - 1].balance) || 0 : 0;
  const opening =
    ledgerRows.length > 0 && ledgerRows[0].kind === 'starting' ? Number(ledgerRows[0].balance) || 0 : 0;
  return { debit, credit, closing, opening, count, netInPeriod: roundMoney(debit - credit) };
}
