const BILL_INVOICE_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Bill-date prefix: 2-digit year + 3-letter month, e.g. 2026-10-01 → 26OCT_ */
export function billInvoicePrefixFromDate(dateStr) {
  let year;
  let month;
  const match = String(dateStr ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    const today = new Date();
    year = today.getFullYear();
    month = today.getMonth() + 1;
  }
  return `${String(year).slice(-2)}${BILL_INVOICE_MONTHS[month - 1]}_`;
}

/** Increment trailing digits; keeps prefix and zero-padding width (e.g. 26OCT_009 → 26OCT_010). */
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

/** Highest trailing invoice sequence across every bill, ignoring the date prefix. */
export function latestBillInvoiceSequence(bills) {
  let best = null;
  for (const bill of Array.isArray(bills) ? bills : []) {
    const n = normalizeBillInvoiceNumber(bill.invoiceNumber);
    const match = n.match(/(\d+)$/);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (!Number.isFinite(num)) continue;
    if (!best || num > best.num) best = { num, width: match[1].length };
  }
  return best;
}

/** Highest invoice # across every bill, so the next number follows all users. */
export function latestBillInvoiceNumber(bills) {
  const best = latestBillInvoiceSequence(bills);
  if (!best) return '';
  return String(best.num).padStart(best.width, '0');
}

/** Next invoice # for a bill date: 26OCT_778899 (year + month + next sequence). */
export function suggestNextBillInvoiceNumber(bills, dateStr) {
  const prefix = billInvoicePrefixFromDate(dateStr);
  const best = latestBillInvoiceSequence(bills);
  const width = best ? best.width : 3;
  let num = best ? best.num + 1 : 1;
  let next = `${prefix}${String(num).padStart(width, '0')}`;
  let guard = 0;
  while (isBillInvoiceNumberTaken(bills, next) && guard < 1000) {
    num += 1;
    next = `${prefix}${String(num).padStart(Math.max(width, String(num).length), '0')}`;
    guard += 1;
  }
  return next;
}

/** Use a server suggestion only when it already matches this bill date. */
export function resolveSuggestedBillInvoiceNumber(serverValue, bills, dateStr) {
  const suggested = normalizeBillInvoiceNumber(serverValue);
  const prefix = billInvoicePrefixFromDate(dateStr);
  if (suggested.toUpperCase().startsWith(prefix)) return suggested;
  return suggestNextBillInvoiceNumber(bills, dateStr);
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
