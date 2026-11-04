import { isCollector } from '../auth';
import { todayYmdLocal } from './collectionDayClose';

export const COLLECTOR_CASH_PRINT_TODAY_ONLY =
  'Cash collection invoices can only be printed on the day they were issued.';

/** Calendar day the receipt was issued (YYYY-MM-DD). */
export function paymentIssuedYmd(payment) {
  return String(payment?.date ?? '').slice(0, 10);
}

/**
 * Collectors may print a cash collection receipt only when it was issued today.
 * Other roles are unchanged.
 */
export function collectorMayPrintCashCollection(payment, today = todayYmdLocal()) {
  if (!isCollector()) return true;
  const issued = paymentIssuedYmd(payment);
  return Boolean(issued) && issued === today;
}

/** Increment trailing digits; keeps prefix and zero-padding width (e.g. REC009 → REC010). */
export function incrementPaymentReceiptNumber(last) {
  const s = String(last ?? '').trim();
  if (!s) return '001';
  const match = s.match(/^(.*?)(\d+)$/);
  if (!match) return `${s}1`;
  const prefix = match[1];
  const numStr = match[2];
  const next = String(parseInt(numStr, 10) + 1);
  return `${prefix}${next.padStart(numStr.length, '0')}`;
}

/** Highest receipt # across every payment, so the next number follows all users. */
export function latestPaymentReceiptNumber(payments) {
  let best = null;
  for (const p of Array.isArray(payments) ? payments : []) {
    const n = String(p.billNumber ?? '').trim();
    const match = n.match(/^(.*?)(\d+)$/);
    if (!match) continue;
    const num = parseInt(match[2], 10);
    if (!Number.isFinite(num)) continue;
    if (!best || num > best.num) {
      best = { prefix: match[1], num, width: match[2].length };
    }
  }
  if (!best) return '';
  return `${best.prefix}${String(best.num).padStart(best.width, '0')}`;
}

/** Next receipt # after the highest number already used by any user. */
export function suggestNextPaymentReceiptNumber(payments) {
  return incrementPaymentReceiptNumber(latestPaymentReceiptNumber(payments));
}

export function normalizePaymentReceiptInput(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

function invoiceEffectFromRow(row) {
  const appliedAmount = roundMoney(row.appliedAmount ?? row.cashAmount ?? row.amount);
  const billTotal = roundMoney(row.billTotal ?? row.totalAmount);
  const remainingAfter =
    row.remainingAfter == null || row.remainingAfter === ''
      ? billTotal > 0 && appliedAmount > 0
        ? Math.round(Math.max(0, billTotal - appliedAmount) * 100) / 100
        : null
      : Math.round(Math.max(0, Number(row.remainingAfter) || 0) * 100) / 100;
  const settled =
    row.settled === true ||
    (remainingAfter != null && remainingAfter <= 0.009) ||
    (billTotal > 0 && appliedAmount >= billTotal - 0.009);
  const billId = String(row.billId ?? row.id ?? '').trim();
  return {
    billId,
    invoiceNumber: String(row.invoiceNumber ?? '').trim(),
    date: String(row.billDate ?? row.date ?? '').trim(),
    details: String(row.details ?? '').trim(),
    billTotal,
    appliedAmount,
    remainingAfter,
    settled,
    taggedOnly: Boolean(row.taggedOnly),
    isReturnCheque:
      Boolean(row.isReturnCheque) || billId.startsWith('return-cheque:'),
  };
}

/** A settled return cheque, not a sales invoice. */
export function isReturnChequeEffect(inv) {
  if (!inv || typeof inv !== 'object') return false;
  if (inv.isReturnCheque) return true;
  const billId = String(inv.billId ?? inv.id ?? '').trim();
  if (billId.startsWith('return-cheque:')) return true;
  const details = String(inv.details ?? '').trim().toLowerCase();
  if (details === 'return cheque' || details.startsWith('return cheque')) return true;
  const num = String(inv.invoiceNumber ?? '').trim().toLowerCase();
  return num === 'return cheque' || num.startsWith('return cheque ') || num.startsWith('return #');
}

/** "Return cheque #123", or "Return cheque" when the cheque has no number. */
export function returnChequeSettleLabel(invoiceNumber) {
  const raw = String(invoiceNumber ?? '').trim();
  if (!raw || /^return cheque$/i.test(raw)) return 'Return cheque';
  let num = raw
    .replace(/^return cheque\s*/i, '')
    .replace(/^return\s*#\s*/i, '')
    .replace(/^rc\s+/i, '')
    .trim()
    .replace(/^#/, '')
    .trim();
  if (!num || /^return cheque$/i.test(num)) return 'Return cheque';
  return `Return cheque #${num}`;
}

/** Title on a printed receipt. Names a return cheque only when the receipt settles nothing else. */
export function receiptInvoiceTitle(inv, { onlyReturnCheque = false } = {}) {
  if (isReturnChequeEffect(inv)) {
    if (onlyReturnCheque) return returnChequeSettleLabel(inv?.invoiceNumber);
    const labeled = returnChequeSettleLabel(inv?.invoiceNumber);
    if (labeled === 'Return cheque') return 'Return cheque';
    return `#${labeled.slice('Return cheque #'.length)}`;
  }
  const num = String(inv?.invoiceNumber ?? '').trim();
  if (num) return num.toLowerCase() === 'opening' ? 'Opening balance' : `Invoice ${num}`;
  const details = String(inv?.details ?? '').trim();
  const invMatch = details.match(/^Inv\s+(.+?)(?:\s*·|$)/i);
  if (invMatch) {
    const extracted = invMatch[1].trim();
    if (extracted.toLowerCase() === 'opening') return 'Opening balance';
    return `Invoice ${extracted}`;
  }
  return 'Invoice';
}

/**
 * Outstanding on the invoice immediately before this payment was applied.
 * Remaining after the payment, plus the amount this receipt applied.
 */
export function remainingBeforePayment(inv) {
  if (!inv || inv.taggedOnly) return null;
  const applied = roundMoney(inv.appliedAmount);
  if (inv.remainingAfter == null || inv.remainingAfter === '') {
    const total = roundMoney(inv.billTotal);
    return total > 0 ? total : null;
  }
  const after = Math.round(Math.max(0, Number(inv.remainingAfter) || 0) * 100) / 100;
  return Math.round((after + applied) * 100) / 100;
}

/** Invoice total, with the pre-payment balance in brackets: "125,000.00 (40,000.00)". */
export function invoiceAmountWithPriorBalance(inv, formatAmount) {
  const total = roundMoney(inv?.billTotal);
  if (!(total > 0) || typeof formatAmount !== 'function') return '';
  const amount = formatAmount(total);
  const before = remainingBeforePayment(inv);
  if (before == null) return amount;
  return `${amount} (${formatAmount(before)})`;
}

/** Invoices this payment settled or applied to — for receipts and payment details. */
export function getPaymentReceiptInvoices(payment) {
  if (!payment || typeof payment !== 'object') return [];
  const affected = Array.isArray(payment.affectedInvoices) ? payment.affectedInvoices : [];
  if (affected.length > 0) {
    return affected.map(invoiceEffectFromRow).filter((x) => x.appliedAmount > 0 || x.billTotal > 0);
  }
  const allocations = Array.isArray(payment.billCashAllocations) ? payment.billCashAllocations : [];
  if (allocations.length > 0) {
    return allocations.map(invoiceEffectFromRow).filter((x) => x.appliedAmount > 0);
  }
  const tagged = Array.isArray(payment.appliedBills) ? payment.appliedBills : [];
  return tagged.map((b) =>
    invoiceEffectFromRow({
      ...b,
      appliedAmount: 0,
      billTotal: b.totalAmount,
      taggedOnly: true,
      settled: false,
      remainingAfter: null,
    }),
  );
}

function invoiceEffectLabel(inv) {
  if (isReturnChequeEffect(inv)) {
    const labeled = returnChequeSettleLabel(inv?.invoiceNumber);
    if (labeled === 'Return cheque') return 'Return cheque';
    return `#${labeled.slice('Return cheque #'.length)}`;
  }
  let label = String(inv?.invoiceNumber ?? '').trim();
  if (!label) {
    const details = String(inv?.details ?? '').trim();
    const invMatch = details.match(/^Inv\s+(.+?)(?:\s*·|$)/i);
    if (invMatch) label = invMatch[1].trim();
  }
  if (!label) return '';
  return label.toLowerCase() === 'opening' ? 'Opening' : label;
}

/** One entry per invoice this payment was applied to, with the amount applied. */
export function paymentInvoiceLines(payment) {
  const lines = [];
  const seen = new Map();
  for (const inv of getPaymentReceiptInvoices(payment)) {
    const label = invoiceEffectLabel(inv);
    if (!label) continue;
    const key = label.toLowerCase();
    const appliedAmount = roundMoney(inv.appliedAmount);
    const billDate = String(inv.date ?? '').slice(0, 10);
    const billAmount = roundMoney(inv.billTotal);
    const billId = String(inv.billId ?? '').trim();
    const returnCheque = isReturnChequeEffect(inv);
    const existing = seen.get(key);
    if (existing) {
      existing.appliedAmount = roundMoney(existing.appliedAmount + appliedAmount);
      if (returnCheque) existing.isReturnCheque = true;
      if (!existing.billId && billId) existing.billId = billId;
      if (!existing.billDate && /^\d{4}-\d{2}-\d{2}$/.test(billDate)) existing.billDate = billDate;
      if (!(existing.billAmount > 0) && billAmount > 0) existing.billAmount = billAmount;
      continue;
    }
    const line = {
      invoiceNumber: label,
      appliedAmount,
      billId,
      billDate: /^\d{4}-\d{2}-\d{2}$/.test(billDate) ? billDate : '',
      billAmount,
      isReturnCheque: returnCheque,
    };
    seen.set(key, line);
    lines.push(line);
  }
  if (lines.length > 0 && lines.every((line) => line.isReturnCheque)) {
    for (const line of lines) {
      line.invoiceNumber = returnChequeSettleLabel(line.invoiceNumber);
    }
  }
  return lines;
}

/** Comma-separated bill invoice numbers this payment was applied to. */
export function paymentInvoiceNumberLabel(payment) {
  return paymentInvoiceLines(payment)
    .map((line) => line.invoiceNumber)
    .join(', ');
}
