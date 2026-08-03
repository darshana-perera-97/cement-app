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
