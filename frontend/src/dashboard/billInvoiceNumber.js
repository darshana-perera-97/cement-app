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

/** Highest invoice # across every bill, so the next number follows all users. */
export function latestBillInvoiceNumber(bills) {
  let best = null;
  for (const bill of Array.isArray(bills) ? bills : []) {
    const n = normalizeBillInvoiceNumber(bill.invoiceNumber);
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

/** Next invoice # after the highest number already used by any user. */
export function suggestNextBillInvoiceNumber(bills) {
  let next = incrementBillInvoiceNumber(latestBillInvoiceNumber(bills));
  let guard = 0;
  while (isBillInvoiceNumberTaken(bills, next) && guard < 1000) {
    next = incrementBillInvoiceNumber(next);
    guard += 1;
  }
  return next;
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
