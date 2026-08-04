/** Increment trailing digits; keeps prefix and zero-padding width (e.g. INV009 → INV010). */
export function incrementBillInvoiceNumber(last) {
  const s = String(last ?? '').trim();
  if (!s) return '001';
  const match = s.match(/^(.*?)(\d+)$/);
  if (!match) return `${s}1`;
  const prefix = match[1];
  const numStr = match[2];
  const next = String(parseInt(numStr, 10) + 1);
  return `${prefix}${next.padStart(numStr.length, '0')}`;
}

export function normalizeBillInvoiceNumber(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function latestBillInvoiceNumber(bills) {
  const list = Array.isArray(bills) ? bills : [];
  if (list.length === 0) return '';
  const sorted = [...list].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );
  for (const bill of sorted) {
    const n = normalizeBillInvoiceNumber(bill.invoiceNumber);
    if (n) return n;
  }
  return '';
}

/** Next invoice # from the most recently recorded bill. */
export function suggestNextBillInvoiceNumber(bills) {
  return incrementBillInvoiceNumber(latestBillInvoiceNumber(bills));
}

export function isBillInvoiceNumberTaken(bills, invoiceNumber, excludeBillId = null) {
  const norm = normalizeBillInvoiceNumber(invoiceNumber).toLowerCase();
  if (!norm) return false;
  const exclude = String(excludeBillId ?? '').trim();
  for (const bill of Array.isArray(bills) ? bills : []) {
    if (exclude && bill.id === exclude) continue;
    if (normalizeBillInvoiceNumber(bill.invoiceNumber).toLowerCase() === norm) return true;
  }
  return false;
}

export const BILL_INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 \-._/]*$/;
