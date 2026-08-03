import { inDateRange } from './tableToolbar';

export function compareTransactionsByDateAsc(a, b) {
  const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
  if (dateCmp !== 0) return dateCmp;
  const aSort = a.sortAt || `${a.date || ''}T12:00:00`;
  const bSort = b.sortAt || `${b.date || ''}T12:00:00`;
  return new Date(aSort).getTime() - new Date(bSort).getTime();
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function applyTxToBalance(balance, tx) {
  const amt = Number(tx.amount) || 0;
  if (tx.direction === 'credit') return roundMoney(balance - amt);
  return roundMoney(balance + amt);
}

/** Signed amount owed after all activity strictly before `beforeYmd` (YYYY-MM-DD). */
export function computeBalanceBeforeDate(transactions, beforeYmd) {
  if (!beforeYmd) return 0;
  let balance = 0;
  const sorted = [...transactions].sort(compareTransactionsByDateAsc);
  for (const tx of sorted) {
    if (String(tx.date || '') >= beforeYmd) break;
    balance = applyTxToBalance(balance, tx);
  }
  return balance;
}

/**
 * Chronological ledger with debit, credit, and running balance.
 * When `dateFrom` is set, prepends a starting-balance row for that period.
 */
export function buildCustomerLedgerRows(transactions, { dateFrom = '', dateTo = '' } = {}) {
  const sorted = [...transactions].sort(compareTransactionsByDateAsc);
  const rows = [];
  let balance = dateFrom ? computeBalanceBeforeDate(transactions, dateFrom) : 0;

  if (dateFrom) {
    rows.push({
      id: 'starting-balance',
      kind: 'starting',
      date: dateFrom,
      type: 'Starting balance',
      details: 'Balance brought forward before this period',
      debit: null,
      credit: null,
      balance,
    });
  }

  for (const tx of sorted) {
    if (!inDateRange(tx.date, dateFrom, dateTo)) continue;
    const debit = tx.direction === 'charge' ? Number(tx.amount) || 0 : null;
    const credit = tx.direction === 'credit' ? Number(tx.amount) || 0 : null;
    balance = applyTxToBalance(balance, tx);
    rows.push({
      id: `${tx.kind}-${tx.id}`,
      kind: tx.kind,
      date: tx.date,
      type: tx.type,
      details: tx.details,
      debit,
      credit,
      balance,
    });
  }

  return rows;
}
