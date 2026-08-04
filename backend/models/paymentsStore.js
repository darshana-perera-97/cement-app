const fs = require('fs').promises;
const path = require('path');

const PAYMENTS_FILE = path.join(__dirname, '..', 'data', 'payments.json');

async function readPayments() {
  try {
    const raw = await fs.readFile(PAYMENTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writePayments(records) {
  await fs.mkdir(path.dirname(PAYMENTS_FILE), { recursive: true });
  await fs.writeFile(PAYMENTS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function todayYmdLocal() {
  const dt = new Date();
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Alphanumeric receipt # (letters, digits, space, . _ - /); 1–40 chars. Invalid → null */
function normalizePaymentBillNumber(input) {
  const s = String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!s || s.length > 40) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 \-._/]*$/.test(s)) return null;
  return s;
}

function incrementPaymentReceiptNumber(last) {
  const s = String(last ?? '').trim();
  if (!s) return '001';
  const match = s.match(/^(.*?)(\d+)$/);
  if (!match) return `${s}1`;
  const prefix = match[1];
  const numStr = match[2];
  const next = String(parseInt(numStr, 10) + 1);
  return `${prefix}${next.padStart(numStr.length, '0')}`;
}

function latestPaymentReceiptNumber(payments) {
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

function nextPaymentReceiptNumber(payments) {
  return incrementPaymentReceiptNumber(latestPaymentReceiptNumber(payments));
}

/** Auto-assign when omitted; bumps until unused. */
function allocatePaymentReceiptNumber(payments, preferredNormalized) {
  let billNumber = preferredNormalized || nextPaymentReceiptNumber(payments);
  let guard = 0;
  while (isPaymentBillNumberTaken(payments, billNumber) && guard < 1000) {
    billNumber = incrementPaymentReceiptNumber(billNumber);
    guard += 1;
  }
  return billNumber;
}

function isPaymentBillNumberTaken(payments, billNumber, excludeId = null) {
  const skip = excludeId ? String(excludeId).trim() : '';
  return payments.some((p) => {
    if (skip && String(p.id || '').trim() === skip) return false;
    return String(p.billNumber || '').trim() === billNumber;
  });
}

module.exports = {
  readPayments,
  writePayments,
  todayYmdLocal,
  normalizePaymentBillNumber,
  isPaymentBillNumberTaken,
  nextPaymentReceiptNumber,
  allocatePaymentReceiptNumber,
  PAYMENTS_FILE,
};
