import { inDateRange } from './tableToolbar';
import { buildChequeTableRows, cashPortion } from './paymentCheques';
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
  if (entry.affectsBalance === false) return balance;
  const debit = Number(entry.debit) || 0;
  const credit = Number(entry.credit) || 0;
  return roundMoney(balance + debit - credit);
}

/** Pending cheques held (not yet deposited) — customer payments + company cheques, any converting date. */
function appendPendingChequeEntries(entries, payments, cashBookEntries) {
  buildChequeTableRows(payments, (p, c, flat) => {
    if (c.chequeDeposited || c.chequeReturned) return null;
    const receivedDate = String(p.date ?? '').slice(0, 10);
    const customerName = String(p.customerName ?? '').trim() || '—';
    const billNumber = p.billNumber != null ? String(p.billNumber) : '—';
    const chequeNumber = flat.chequeNumber && flat.chequeNumber !== '—' ? flat.chequeNumber : '';
    const converting = flat.chequeDate || '—';
    entries.push({
      id: `chq:${flat.rowKey}`,
      kind: 'cheque_in',
      date: receivedDate,
      sortAt: p.createdAt || `${receivedDate}T12:00:00`,
      type: 'Customer cheque',
      details: [
        customerName !== '—' ? customerName : '',
        billNumber !== '—' ? `Bill #${billNumber}` : '',
        chequeNumber ? `#${chequeNumber}` : '',
        converting !== '—' ? `Converting ${converting}` : '',
      ]
        .filter(Boolean)
        .join(' · ') || '—',
      debit: flat.amount,
      credit: null,
      affectsBalance: false,
      recordedBy: String(p.recordedBy ?? '').trim() || '—',
      detailKind: 'bankCheque',
      detailRow: {
        id: p.id,
        chequeId: c.id,
        chequeDate: converting,
        amount: flat.amount,
        chequeNumber: chequeNumber || '—',
        chequeDeposited: false,
        customerName,
        billNumber,
        paymentDate: receivedDate || '—',
      },
    });
    return null;
  });

  for (const e of Array.isArray(cashBookEntries) ? cashBookEntries : []) {
    if (e.cancelled) continue;
    const category = String(e.category ?? '').trim();
    if (category === 'company_cheque') {
      appendPendingIncomingChequeEntry(entries, e, {
        type: 'Company cheque',
        detailKind: 'companyCheque',
        idPrefix: 'chq:company',
      });
      continue;
    }
    if (
      category === 'owner_share' &&
      String(e.ownerShareDirection ?? '').trim() === 'from_owner' &&
      String(e.paymentMethod ?? '').trim() === 'cheque'
    ) {
      appendPendingIncomingChequeEntry(entries, e, {
        type: 'Owner cheque',
        detailKind: 'ownerCheque',
        idPrefix: 'chq:owner',
      });
    }
  }
}

function appendPendingIncomingChequeEntry(entries, e, { type, detailKind, idPrefix }) {
  if (e.chequeDeposited) return;
  const amount = Math.max(0, Number(e.amount) || 0);
  if (amount <= 0) return;
  const receivedDate = String(e.date ?? '').slice(0, 10);
  const chequeNumber = String(e.chequeNumber ?? '').trim();
  const converting = String(e.chequeDate ?? e.date ?? '').slice(0, 10) || '—';
  entries.push({
    id: `${idPrefix}:${e.id}`,
    kind: 'cheque_in',
    date: receivedDate,
    sortAt: e.createdAt || `${receivedDate}T12:00:00`,
    type,
    details: cashBookEntryDetail(e),
    debit: amount,
    credit: null,
    affectsBalance: false,
    recordedBy: String(e.recordedBy ?? '').trim() || '—',
    detailKind,
    detailRow: {
      id: e.id,
      chequeDate: converting,
      amount,
      chequeNumber: chequeNumber || '—',
      chequeDeposited: false,
      receivedDate: receivedDate || '—',
      description: String(e.description ?? '').trim() || '—',
      ownerShareDirection: String(e.ownerShareDirection ?? '').trim() || undefined,
    },
  });
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
export function buildCashBookSourceEntries(payments, cashBookEntries, promotions = []) {
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

  appendPendingChequeEntries(entries, payments, cashBookEntries);

  for (const e of Array.isArray(cashBookEntries) ? cashBookEntries : []) {
    if (e.cancelled) continue;
    const date = String(e.date ?? '').slice(0, 10);
    const category = String(e.category ?? '').trim();
    if (category === 'company_cheque') continue;
    if (
      category === 'owner_share' &&
      String(e.ownerShareDirection ?? '').trim() === 'from_owner' &&
      String(e.paymentMethod ?? '').trim() === 'cheque'
    ) {
      continue;
    }
    const amt = Math.max(0, Number(e.amount) || 0);
    if (category === 'owner_share') {
      const direction = String(e.ownerShareDirection ?? '').trim();
      const isFromOwner = direction === 'from_owner';
      entries.push({
        id: isFromOwner ? `in:owner:${e.id}` : `out:owner:${e.id}`,
        kind: isFromOwner ? 'owner_in' : 'owner_out',
        date,
        sortAt: e.createdAt || `${date}T12:00:00`,
        type: isFromOwner ? 'Owner contribution' : 'Owner withdrawal',
        details: cashBookEntryDetail(e),
        debit: isFromOwner ? amt : null,
        credit: isFromOwner ? null : amt,
        recordedBy: String(e.recordedBy ?? '').trim() || '—',
        detailKind: 'expense',
        detailRow: e,
      });
      continue;
    }
    const isBankDeposit = category === 'bank_deposit';
    entries.push({
      id: `out:${e.id}`,
      kind: isBankDeposit ? 'bank_deposit' : 'expense',
      date,
      sortAt: e.createdAt || `${date}T12:00:00`,
      type: CASH_BOOK_CATEGORY_LABELS[category] || category || 'Expense',
      details: cashBookEntryDetail(e),
      debit: null,
      credit: amt,
      recordedBy: String(e.recordedBy ?? '').trim() || '—',
      detailKind: 'expense',
      detailRow: e,
    });
  }

  for (const promo of Array.isArray(promotions) ? promotions : []) {
    const type = String(promo.type ?? '').trim();
    if (type !== 'invoice_discount' && type !== 'target_promotion') continue;
    const amt = Math.max(0, Number(promo.discountAmount) || 0);
    if (amt <= 0) continue;
    const date = String(promo.date ?? '').slice(0, 10);
    const customerName = String(promo.customerName ?? '').trim() || '—';
    const label = type === 'invoice_discount' ? 'Invoice discount' : 'Target promotion';
    entries.push({
      id: `out:promo:${promo.id}`,
      kind: 'promotion_out',
      date,
      sortAt: promo.createdAt || `${date}T12:00:00`,
      type: label,
      details: [
        customerName !== '—' ? customerName : '',
        type === 'invoice_discount' && promo.invoiceNumber ? `Invoice ${promo.invoiceNumber}` : '',
        String(promo.reason ?? '').trim(),
      ]
        .filter(Boolean)
        .join(' · ') || '—',
      debit: null,
      credit: amt,
      recordedBy: String(promo.enteredBy ?? '').trim() || '—',
      detailKind: 'promotion',
      detailRow: promo,
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
    if (row.kind === 'cheque_in') continue;
    count += 1;
    debit += Number(row.debit) || 0;
    credit += Number(row.credit) || 0;
  }
  const closing = ledgerRows.length > 0 ? Number(ledgerRows[ledgerRows.length - 1].balance) || 0 : 0;
  const opening =
    ledgerRows.length > 0 && ledgerRows[0].kind === 'starting' ? Number(ledgerRows[0].balance) || 0 : 0;
  return { debit, credit, closing, opening, count, netInPeriod: roundMoney(debit - credit) };
}
