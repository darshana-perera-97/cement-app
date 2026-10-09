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

function formatLedgerMoney(n) {
  return `LKR ${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0)}`;
}

function joinDetails(parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' · ');
}

function applicationDetail(app, tx) {
  const invoiceNumber = String(app?.invoiceNumber || '').trim();
  let label = 'Applied to invoice';
  if (app?.isReturnCheque) {
    label = invoiceNumber ? `Applied to return cheque ${invoiceNumber}` : 'Applied to return cheque';
  } else if (invoiceNumber === 'Opening') label = 'Applied to opening balance';
  else if (invoiceNumber) label = `Applied to invoice ${invoiceNumber}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(String(app?.date || ''))) {
    label = `Applied to invoice dated ${app.date}`;
  }
  let status = '';
  if (app?.settled) status = 'paid in full';
  else {
    const left = Number(app?.remainingAfter);
    if (Number.isFinite(left) && left > 0.009) status = `${formatLedgerMoney(left)} still due`;
  }
  return joinDetails([label, tx.paymentMethods, status, tx.entryNote]);
}

function invoiceLabel(app) {
  const invoiceNumber = String(app?.invoiceNumber || '').trim();
  if (invoiceNumber === 'Opening') return 'Opening';
  if (invoiceNumber) return invoiceNumber;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(app?.date || ''))) return String(app.date);
  return '';
}

function paymentSlice(tx, id, amount, details, invoiceNumber) {
  return {
    kind: 'payment',
    id,
    paymentId: tx.id,
    date: tx.date,
    sortAt: tx.sortAt,
    type: 'Payment',
    invoiceNumber: invoiceNumber || '',
    details,
    amount,
    direction: 'credit',
  };
}

/**
 * One ledger credit per invoice a payment was applied to.
 * Amounts still add up to the original payment, so the running balance is unchanged.
 * A returned cheque stays in that total and is reversed later by the returned-cheque charge.
 */
function expandPaymentForLedger(tx) {
  if (!tx || tx.kind !== 'payment' || !Array.isArray(tx.applications)) return [tx];
  const gross = roundMoney(Number(tx.amount) || 0);
  const net = roundMoney(Math.max(0, Number(tx.netCredit) || 0));
  if (gross <= 0) return [tx];
  if (tx.applications.length === 0 && net <= 0) return [tx];

  const slices = [];
  let unallocatedNet = roundMoney(Math.min(gross, net));
  tx.applications.forEach((app, index) => {
    if (unallocatedNet <= 0.009) return;
    const want = roundMoney(Number(app?.appliedAmount) || 0);
    const amt = roundMoney(Math.min(unallocatedNet, want));
    if (amt <= 0.009) return;
    unallocatedNet = roundMoney(unallocatedNet - amt);
    const billKey = String(app?.billId || index);
    slices.push(
      paymentSlice(tx, `${tx.id}::${billKey}`, amt, applicationDetail(app, tx), invoiceLabel(app)),
    );
  });

  if (unallocatedNet > 0.009) {
    slices.push(
      paymentSlice(
        tx,
        `${tx.id}::on-account`,
        unallocatedNet,
        joinDetails(['On account (not applied to an invoice)', tx.paymentMethods, tx.entryNote]),
        'On account',
      ),
    );
  }

  let leftover = roundMoney(gross - slices.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  const returned = roundMoney(Math.min(leftover, Math.max(0, Number(tx.returnedChequeAmount) || 0)));
  if (returned > 0.009) {
    slices.push(
      paymentSlice(
        tx,
        `${tx.id}::returned-cheques`,
        returned,
        tx.returnedChequeDetails || 'Cheque later returned',
      ),
    );
    leftover = roundMoney(leftover - returned);
  }
  if (leftover > 0.009) {
    slices.push(paymentSlice(tx, `${tx.id}::remainder`, leftover, tx.details || 'Payment'));
  }
  return slices.length ? slices : [tx];
}

/** Payments that covered more than one invoice become one row per invoice. */
export function expandCustomerLedgerTransactions(transactions) {
  const list = Array.isArray(transactions) ? transactions : [];
  const out = [];
  for (const tx of list) {
    for (const slice of expandPaymentForLedger(tx)) out.push(slice);
  }
  return out;
}

function displayInvoice(tx) {
  const explicit = String(tx?.invoiceNumber || '').trim();
  if (explicit) return explicit;
  if (tx?.kind === 'opening') return 'Opening';
  const match = String(tx?.details || '').match(/\bInvoice\s+([A-Za-z0-9][\w./-]*)/);
  if (match && match[1].toLowerCase() !== 'dated') return match[1];
  return '';
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
  const sorted = expandCustomerLedgerTransactions(transactions).sort(compareTransactionsByDateAsc);
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
  const sorted = expandCustomerLedgerTransactions(transactions).sort(compareTransactionsByDateAsc);
  const rows = [];
  let balance = dateFrom ? computeBalanceBeforeDate(transactions, dateFrom) : 0;

  if (dateFrom) {
    rows.push({
      id: 'starting-balance',
      kind: 'starting',
      date: dateFrom,
      type: 'Starting balance',
      invoice: '',
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
      invoice: displayInvoice(tx),
      details: tx.details,
      debit,
      credit,
      balance,
    });
  }

  return rows;
}
