const fs = require('fs').promises;
const path = require('path');

const PAYMENTS_FILE = path.join(__dirname, 'data', 'payments.json');

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

/** 1–3 digits → padded 3 chars (e.g. 1 → "001"). Invalid → null */
function normalizePaymentBillNumber(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 3) return null;
  const n = parseInt(digits, 10);
  if (Number.isNaN(n) || n < 0 || n > 999) return null;
  return String(n).padStart(3, '0');
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
  PAYMENTS_FILE,
};
