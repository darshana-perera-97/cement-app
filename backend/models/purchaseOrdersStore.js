const fs = require('fs').promises;
const path = require('path');
const { toNonNegNumber } = require('./stocksStore');
const { toNonNegMoney } = require('./customersStore');

const PURCHASE_ORDERS_FILE = path.join(__dirname, '..', 'data', 'purchaseOrders.json');

async function readPurchaseOrders() {
  try {
    const raw = await fs.readFile(PURCHASE_ORDERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writePurchaseOrders(records) {
  await fs.mkdir(path.dirname(PURCHASE_ORDERS_FILE), { recursive: true });
  await fs.writeFile(PURCHASE_ORDERS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function lineTotal(quantity, unitPrice) {
  const q = toNonNegNumber(quantity);
  const u = toNonNegMoney(unitPrice);
  return Math.round(q * u * 100) / 100;
}

/** Next PO-nnnn after the highest existing number; defaults to PO-0001. */
function nextSuggestedPoNumber(records) {
  let max = 0;
  for (const r of records) {
    const raw = String(r.poNumber ?? '').trim();
    if (!raw) continue;
    const m = /^PO-(\d+)$/i.exec(raw);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
      continue;
    }
    if (/^\d+$/.test(raw)) {
      max = Math.max(max, parseInt(raw, 10));
    }
  }
  return `PO-${String(max + 1).padStart(4, '0')}`;
}

function bankAccountSnapshot(account) {
  if (!account || typeof account !== 'object') return null;
  const id = String(account.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    nickName: String(account.nickName ?? '').trim(),
    bank: String(account.bank ?? '').trim(),
    accountNumber: String(account.accountNumber ?? '').trim(),
    accountType: String(account.accountType ?? '').trim(),
  };
}

function normalizePaymentType(item) {
  const t = String(item?.paymentType ?? '').trim().toLowerCase();
  if (t === 'cash') return 'cash';
  return 'cheque';
}

function isPoCashPayment(c) {
  return normalizePaymentType(c) === 'cash';
}

function parseCheques(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const paymentType = normalizePaymentType(item);
    const amountRaw = String(item.amount ?? '').trim();
    const amount = amountRaw ? toNonNegMoney(amountRaw) : 0;

    if (paymentType === 'cash') {
      if (amount <= 0) continue;
      out.push({ paymentType: 'cash', amount });
      continue;
    }

    const chequeNumber = String(item.chequeNumber ?? '').trim();
    const chequeDate = String(item.chequeDate ?? '').trim().slice(0, 10);
    if (!chequeNumber && !chequeDate && amount <= 0) continue;
    const entry = { paymentType: 'cheque', chequeNumber, chequeDate };
    if (amount > 0) entry.amount = amount;
    const bankAccountId = String(item.bankAccountId ?? '').trim();
    if (bankAccountId) entry.bankAccountId = bankAccountId;
    const snap = item.bankAccount;
    if (snap && typeof snap === 'object' && String(snap.id ?? '').trim()) {
      entry.bankAccount = bankAccountSnapshot(snap);
    }
    out.push(entry);
  }
  return out;
}

/**
 * Validate PO cheque lines for create/update (amount + bank account required).
 * @returns {{ ok: boolean, error?: string, cheques?: object[] }}
 */
function validatePoCheques(raw, bankAccountById, labelPrefix = 'Payment') {
  const cheques = parseCheques(raw);
  if (cheques.length === 0) {
    return {
      ok: false,
      error: `${labelPrefix}: enter at least one payment (cheque or cash).`,
    };
  }
  for (let i = 0; i < cheques.length; i++) {
    const c = cheques[i];
    const amount = toNonNegMoney(c.amount);
    if (amount <= 0) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: amount must be greater than 0.` };
    }
    c.amount = amount;

    if (isPoCashPayment(c)) {
      c.paymentType = 'cash';
      continue;
    }

    c.paymentType = 'cheque';
    const chequeNumber = String(c.chequeNumber ?? '').trim();
    const chequeDate = String(c.chequeDate ?? '').trim().slice(0, 10);
    if (!chequeNumber) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: enter a cheque number.` };
    }
    if (!chequeDate || !/^\d{4}-\d{2}-\d{2}$/.test(chequeDate)) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: enter a valid converting date.` };
    }
    c.chequeNumber = chequeNumber;
    c.chequeDate = chequeDate;
    const bankAccountId = String(c.bankAccountId ?? '').trim();
    if (!bankAccountId) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: select a bank account for this cheque.` };
    }
    const acct = bankAccountById?.get?.(bankAccountId);
    if (!acct) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: invalid bank account.` };
    }
    c.bankAccountId = bankAccountId;
    c.bankAccount = bankAccountSnapshot(acct);
  }
  return { ok: true, cheques };
}

/**
 * Last non-zero unit price for distributor + product (case-insensitive product match).
 * Prefers most recent by date, then createdAt.
 */
function findLastUnitPrice(records, distributorId, product) {
  const distId = String(distributorId ?? '').trim();
  const productKey = String(product ?? '').trim().toLowerCase();
  if (!distId || !productKey) return null;

  const matches = records
    .filter((r) => {
      if (String(r.distributorId ?? '').trim() !== distId) return false;
      if (String(r.product ?? '').trim().toLowerCase() !== productKey) return false;
      const price = toNonNegMoney(r.unitPrice);
      return price > 0;
    })
    .sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

  if (matches.length === 0) return null;
  return toNonNegMoney(matches[0].unitPrice);
}

/** Map of product name → last unit price for a distributor. */
function lastPricesByProduct(records, distributorId) {
  const distId = String(distributorId ?? '').trim();
  const map = {};
  if (!distId) return map;

  const sorted = [...records]
    .filter((r) => String(r.distributorId ?? '').trim() === distId)
    .sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

  for (const r of sorted) {
    const product = String(r.product ?? '').trim();
    if (!product) continue;
    const key = product.toLowerCase();
    if (map[key] != null) continue;
    const price = toNonNegMoney(r.unitPrice);
    if (price <= 0) continue;
    map[key] = { product, unitPrice: price };
  }

  const out = {};
  for (const { product, unitPrice } of Object.values(map)) {
    out[product] = unitPrice;
  }
  return out;
}

function poChequeMatchKey(c) {
  if (isPoCashPayment(c)) return '';
  return [
    String(c?.chequeNumber ?? '').trim(),
    String(c?.chequeDate ?? '').trim().slice(0, 10),
    String(c?.bankAccountId ?? '').trim(),
    toNonNegMoney(c?.amount),
  ].join('|');
}

/**
 * Mark a PO-issued cheque as cancelled (manager/admin). Shared-batch cheques cancel on all POs in the batch.
 * @returns {{ ok: boolean, error?: string, updated?: number, cancelledAt?: string }}
 */
function cancelIssuedCheque(records, opts) {
  const poId = String(opts?.poId ?? '').trim();
  const cancelledBy = String(opts?.cancelledBy ?? '').trim();
  if (!poId) return { ok: false, error: 'Purchase order id is required' };
  if (!cancelledBy) return { ok: false, error: 'cancelledBy (username) is required' };

  const targetKey = poChequeMatchKey({
    chequeNumber: opts.chequeNumber,
    chequeDate: opts.chequeDate,
    bankAccountId: opts.bankAccountId,
    amount: opts.amount,
  });
  const parts = targetKey.split('|');
  if (!parts[0] || !parts[1] || !parts[2] || !(Number(parts[3]) > 0)) {
    return { ok: false, error: 'chequeNumber, chequeDate, bankAccountId, and amount are required' };
  }

  const idx = records.findIndex((r) => r.id === poId);
  if (idx < 0) return { ok: false, error: 'Purchase order not found' };

  const po = records[idx];
  const batchId = String(po.batchId ?? '').trim();
  const mode = String(po.chequeMode ?? '').trim();
  const cancelledAt = new Date().toISOString();

  const poIdsToTouch = new Set([poId]);
  if (mode === 'shared' && batchId) {
    for (const r of records) {
      const id = String(r.id ?? '').trim();
      if (id && String(r.batchId ?? '').trim() === batchId) poIdsToTouch.add(id);
    }
  }

  let updated = 0;
  for (const id of poIdsToTouch) {
    const i = records.findIndex((r) => r.id === id);
    if (i < 0) continue;
    const row = records[i];
    const cheques = Array.isArray(row.cheques) ? row.cheques : [];
    let touched = false;
    for (const ch of cheques) {
      if (!ch || ch.cancelled) continue;
      if (poChequeMatchKey(ch) !== targetKey) continue;
      ch.cancelled = true;
      ch.cancelledAt = cancelledAt;
      ch.cancelledBy = cancelledBy;
      touched = true;
      updated += 1;
    }
    if (touched) {
      records[i] = { ...row, cheques, updatedAt: cancelledAt, updatedBy: cancelledBy };
    }
  }

  if (updated === 0) {
    return { ok: false, error: 'Cheque not found or already cancelled' };
  }

  return { ok: true, updated, cancelledAt };
}

module.exports = {
  readPurchaseOrders,
  writePurchaseOrders,
  lineTotal,
  nextSuggestedPoNumber,
  parseCheques,
  validatePoCheques,
  bankAccountSnapshot,
  findLastUnitPrice,
  lastPricesByProduct,
  cancelIssuedCheque,
  isPoCashPayment,
  normalizePaymentType,
  PURCHASE_ORDERS_FILE,
};
