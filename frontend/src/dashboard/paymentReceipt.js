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

export function latestPaymentReceiptNumber(payments) {
  const list = Array.isArray(payments) ? payments : [];
  if (list.length === 0) return '';
  const sorted = [...list].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );
  for (const p of sorted) {
    const n = String(p.billNumber ?? '').trim();
    if (n) return n;
  }
  return '';
}

/** Next receipt # from the most recently recorded payment. */
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
  return {
    billId: String(row.billId ?? row.id ?? '').trim(),
    invoiceNumber: String(row.invoiceNumber ?? '').trim(),
    date: String(row.billDate ?? row.date ?? '').trim(),
    details: String(row.details ?? '').trim(),
    billTotal,
    appliedAmount,
    remainingAfter,
    settled,
    taggedOnly: Boolean(row.taggedOnly),
  };
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
