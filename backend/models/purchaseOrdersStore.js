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
  const t = String(item?.paymentType ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (t === 'cash') return 'cash';
  if (t === 'bank_transfer' || t === 'banktransfer' || t === 'transfer') return 'bank_transfer';
  return 'cheque';
}

function isPoCashPayment(c) {
  return normalizePaymentType(c) === 'cash';
}

function isPoBankTransferPayment(c) {
  return normalizePaymentType(c) === 'bank_transfer';
}

function attachBankAccountFields(entry, item) {
  const bankAccountId = String(item.bankAccountId ?? '').trim();
  if (bankAccountId) entry.bankAccountId = bankAccountId;
  const snap = item.bankAccount;
  if (snap && typeof snap === 'object' && String(snap.id ?? '').trim()) {
    entry.bankAccount = bankAccountSnapshot(snap);
  }
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
    const bankAccountId = String(item.bankAccountId ?? '').trim();

    if (paymentType === 'bank_transfer') {
      if (!chequeNumber && !chequeDate && amount <= 0 && !bankAccountId) continue;
      const entry = { paymentType: 'bank_transfer' };
      if (amount > 0) entry.amount = amount;
      if (chequeNumber) entry.chequeNumber = chequeNumber;
      if (chequeDate) entry.chequeDate = chequeDate;
      attachBankAccountFields(entry, item);
      out.push(entry);
      continue;
    }

    if (!chequeNumber && !chequeDate && amount <= 0 && !bankAccountId) continue;
    const entry = { paymentType: 'cheque', chequeNumber, chequeDate };
    if (amount > 0) entry.amount = amount;
    attachBankAccountFields(entry, item);
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
      error: `${labelPrefix}: enter at least one payment (cheque, cash, or bank transfer).`,
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

    const chequeDate = String(c.chequeDate ?? '').trim().slice(0, 10);
    const bankAccountId = String(c.bankAccountId ?? '').trim();
    const acct = bankAccountById?.get?.(bankAccountId);

    if (isPoBankTransferPayment(c)) {
      c.paymentType = 'bank_transfer';
      if (!chequeDate || !/^\d{4}-\d{2}-\d{2}$/.test(chequeDate)) {
        return { ok: false, error: `${labelPrefix} ${i + 1}: enter a valid transfer date.` };
      }
      if (!bankAccountId) {
        return { ok: false, error: `${labelPrefix} ${i + 1}: select a bank account for this transfer.` };
      }
      if (!acct) {
        return { ok: false, error: `${labelPrefix} ${i + 1}: invalid bank account.` };
      }
      c.chequeDate = chequeDate;
      c.chequeNumber = String(c.chequeNumber ?? '').trim();
      if (!c.chequeNumber) delete c.chequeNumber;
      c.bankAccountId = bankAccountId;
      c.bankAccount = bankAccountSnapshot(acct);
      continue;
    }

    c.paymentType = 'cheque';
    const chequeNumber = String(c.chequeNumber ?? '').trim();
    if (!chequeNumber) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: enter a cheque number.` };
    }
    if (!chequeDate || !/^\d{4}-\d{2}-\d{2}$/.test(chequeDate)) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: enter a valid converting date.` };
    }
    c.chequeNumber = chequeNumber;
    c.chequeDate = chequeDate;
    if (!bankAccountId) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: select a bank account for this cheque.` };
    }
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
function poLineItems(po) {
  if (!po || typeof po !== 'object') return [];
  if (Array.isArray(po.items) && po.items.length > 0) {
    return po.items
      .map((item) => ({
        product: String(item?.product ?? '').trim(),
        quantity: toNonNegNumber(item?.quantity),
        unitPrice: toNonNegMoney(item?.unitPrice),
        lineTotal:
          item?.lineTotal != null && item.lineTotal !== ''
            ? toNonNegMoney(item.lineTotal)
            : lineTotal(item?.quantity, item?.unitPrice),
      }))
      .filter((item) => item.product);
  }
  const product = String(po.product ?? '').trim();
  if (!product) return [];
  return [
    {
      product,
      quantity: toNonNegNumber(po.quantity),
      unitPrice: toNonNegMoney(po.unitPrice),
      lineTotal:
        po.lineTotal != null && po.lineTotal !== ''
          ? toNonNegMoney(po.lineTotal)
          : lineTotal(po.quantity, po.unitPrice),
    },
  ];
}

function findLastUnitPrice(records, distributorId, product) {
  const distId = String(distributorId ?? '').trim();
  const productKey = String(product ?? '').trim().toLowerCase();
  if (!distId || !productKey) return null;

  const matches = [];
  for (const r of records) {
    if (isPurchaseOrderCancelled(r)) continue;
    if (String(r.distributorId ?? '').trim() !== distId) continue;
    for (const item of poLineItems(r)) {
      if (item.product.toLowerCase() !== productKey) continue;
      if (!(item.unitPrice > 0)) continue;
      matches.push({ date: r.date, createdAt: r.createdAt, unitPrice: item.unitPrice });
    }
  }
  matches.sort((a, b) => {
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
    if (isPurchaseOrderCancelled(r)) continue;
    for (const item of poLineItems(r)) {
      const product = item.product;
      if (!product) continue;
      const key = product.toLowerCase();
      if (map[key] != null) continue;
      if (!(item.unitPrice > 0)) continue;
      map[key] = { product, unitPrice: item.unitPrice };
    }
  }

  const out = {};
  for (const { product, unitPrice } of Object.values(map)) {
    out[product] = unitPrice;
  }
  return out;
}

function isPurchaseOrderCancelled(row) {
  return Boolean(row?.cancelled);
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

/** Converting / clearing date, moved forward when the cheque is on hold. */
function effectivePoChequeDate(c) {
  const stored = String(c?.chequeDate ?? '').trim().slice(0, 10);
  if (String(c?.chequeAction ?? '').trim() === 'hold') {
    const hold = String(c?.holdUntil ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(hold)) return hold;
  }
  return stored;
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim().slice(0, 10));
}

/**
 * Keep returned cheques and replacement settlements when a purchase order is edited.
 * Also keeps a hold if the same cheque is saved again.
 */
function preserveChequeDispositions(previousCheques, nextCheques) {
  const next = (Array.isArray(nextCheques) ? nextCheques : []).map((c) =>
    c && typeof c === 'object' ? { ...c } : c,
  );
  const prev = Array.isArray(previousCheques) ? previousCheques : [];
  const keys = new Set(next.map((c) => poChequeMatchKey(c)).filter(Boolean));

  for (const ch of next) {
    if (!ch || typeof ch !== 'object' || ch.chequeAction) continue;
    const key = poChequeMatchKey(ch);
    if (!key) continue;
    const old = prev.find(
      (p) => p && poChequeMatchKey(p) === key && String(p.chequeAction ?? '').trim() === 'hold',
    );
    if (!old) continue;
    ch.chequeAction = 'hold';
    ch.holdUntil = old.holdUntil;
    if (old.chequeActionAt) ch.chequeActionAt = old.chequeActionAt;
    if (old.chequeActionBy) ch.chequeActionBy = old.chequeActionBy;
  }

  for (const old of prev) {
    if (!old || typeof old !== 'object') continue;
    if (!old.chequeReturned && !old.settlementOfCheque) continue;
    const key = poChequeMatchKey(old);
    if (key && keys.has(key)) continue;
    next.push({ ...old });
    if (key) keys.add(key);
  }
  return next;
}

/**
 * Hold, return, or settle a cheque issued on a purchase order.
 * Shared-batch copies of the same cheque are updated together.
 * The replacement payment is stored once, on the purchase order that was selected.
 * @returns {{ ok: boolean, error?: string, updated?: number, po?: object, cashSettlement?: object|null }}
 */
function resolveIssuedPurchaseCheque(records, opts, bankAccountById) {
  const poId = String(opts?.poId ?? '').trim();
  const recordedBy = String(opts?.recordedBy ?? '').trim();
  const action = String(opts?.action ?? '').trim();
  if (!poId) return { ok: false, error: 'Purchase order id is required' };
  if (!recordedBy) return { ok: false, error: 'recordedBy (username) is required' };
  if (action !== 'hold' && action !== 'return' && action !== 'settle_today') {
    return { ok: false, error: 'Choose hold, return, or settle today' };
  }

  const targetKey = poChequeMatchKey({
    chequeNumber: opts.chequeNumber,
    chequeDate: opts.chequeDate,
    bankAccountId: opts.bankAccountId,
    amount: opts.amount,
    paymentType: 'cheque',
  });
  const parts = targetKey.split('|');
  if (!parts[0] || !parts[1] || !parts[2] || !(Number(parts[3]) > 0)) {
    return { ok: false, error: 'chequeNumber, chequeDate, bankAccountId, and amount are required' };
  }

  const idx = records.findIndex((r) => r.id === poId);
  if (idx < 0) return { ok: false, error: 'Purchase order not found' };
  const po = records[idx];
  if (isPurchaseOrderCancelled(po)) {
    return { ok: false, error: 'This purchase order is cancelled' };
  }

  const batchId = String(po.batchId ?? '').trim();
  const mode = String(po.chequeMode ?? '').trim();
  const poIdsToTouch = new Set([poId]);
  if (mode === 'shared' && batchId) {
    for (const r of records) {
      const id = String(r.id ?? '').trim();
      if (id && String(r.batchId ?? '').trim() === batchId && !isPurchaseOrderCancelled(r)) {
        poIdsToTouch.add(id);
      }
    }
  }

  const now = new Date().toISOString();
  let settlement = null;

  if (action === 'hold') {
    const holdUntil = String(opts.holdUntil ?? '').trim().slice(0, 10);
    if (!isYmd(holdUntil)) {
      return { ok: false, error: 'Enter the hold ending date' };
    }
    const today = String(opts.today ?? '').trim().slice(0, 10);
    if (isYmd(today) && holdUntil <= today) {
      return { ok: false, error: 'Hold ending date must be after today' };
    }
    opts._holdUntil = holdUntil;
  } else {
    const method = String(opts.settlementMethod ?? '').trim().toLowerCase();
    if (action === 'settle_today' && method !== 'cash' && method !== 'bank_transfer') {
      return { ok: false, error: 'Settle today with cash or a bank transfer' };
    }
    if (method !== 'cash' && method !== 'bank_transfer' && method !== 'cheque') {
      return { ok: false, error: 'Choose how this cheque is settled' };
    }
    const amount = toNonNegMoney(opts.amount);
    const settlementDate = String(opts.settlementDate ?? opts.today ?? '').trim().slice(0, 10);
    if (method === 'cash') {
      if (!isYmd(settlementDate)) return { ok: false, error: 'Settlement date is required' };
      settlement = { paymentType: 'cash', amount, settlementOfCheque: true };
    } else if (method === 'bank_transfer') {
      if (!isYmd(settlementDate)) return { ok: false, error: 'Settlement date is required' };
      const bankAccountId = String(opts.settlementBankAccountId ?? '').trim();
      const acct = bankAccountById?.get?.(bankAccountId);
      if (!bankAccountId || !acct) {
        return { ok: false, error: 'Select a bank account for this transfer' };
      }
      settlement = {
        paymentType: 'bank_transfer',
        amount,
        chequeDate: settlementDate,
        bankAccountId,
        bankAccount: bankAccountSnapshot(acct),
        settlementOfCheque: true,
      };
      const reference = String(opts.settlementReference ?? '').trim();
      if (reference) settlement.chequeNumber = reference;
    } else {
      const chequeNumber = String(opts.settlementChequeNumber ?? '').trim();
      const chequeDate = String(opts.settlementChequeDate ?? '').trim().slice(0, 10);
      const bankAccountId = String(opts.settlementBankAccountId ?? '').trim();
      const acct = bankAccountById?.get?.(bankAccountId);
      if (!chequeNumber) return { ok: false, error: 'Enter the new cheque number' };
      if (!isYmd(chequeDate)) return { ok: false, error: 'Enter a converting date for the new cheque' };
      if (!bankAccountId || !acct) {
        return { ok: false, error: 'Select a bank account for the new cheque' };
      }
      settlement = {
        paymentType: 'cheque',
        chequeNumber,
        chequeDate,
        amount,
        bankAccountId,
        bankAccount: bankAccountSnapshot(acct),
        settlementOfCheque: true,
      };
    }
    settlement.settledAt = now;
    settlement.settledBy = recordedBy;
    settlement.replacesChequeNumber = parts[0];
  }

  let updated = 0;
  let sawMatch = false;
  for (const id of poIdsToTouch) {
    const i = records.findIndex((r) => r.id === id);
    if (i < 0) continue;
    const row = records[i];
    const cheques = Array.isArray(row.cheques) ? row.cheques : [];
    let touched = false;
    for (const ch of cheques) {
      if (!ch || ch.cancelled || ch.chequeReturned) continue;
      if (poChequeMatchKey(ch) !== targetKey) continue;
      if (normalizePaymentType(ch) !== 'cheque') continue;
      sawMatch = true;
      if (action === 'hold') {
        ch.chequeAction = 'hold';
        ch.holdUntil = opts._holdUntil;
        ch.chequeActionAt = now;
        ch.chequeActionBy = recordedBy;
      } else {
        ch.chequeReturned = true;
        ch.chequeReturnedAt = now;
        ch.chequeReturnedBy = recordedBy;
        ch.chequeAction = action;
        ch.chequeActionAt = now;
        ch.chequeActionBy = recordedBy;
        ch.settlementMethod = settlement.paymentType;
        if (settlement.chequeNumber) ch.settlementChequeNumber = settlement.chequeNumber;
        if (settlement.chequeDate) ch.settlementChequeDate = settlement.chequeDate;
        if (settlement.bankAccountId) ch.settlementBankAccountId = settlement.bankAccountId;
        delete ch.holdUntil;
      }
      touched = true;
      updated += 1;
    }
    if (id === poId && settlement) {
      cheques.push(settlement);
      touched = true;
    }
    if (touched) {
      records[i] = { ...row, cheques, updatedAt: now, updatedBy: recordedBy };
    }
  }

  if (!sawMatch || updated === 0) {
    return { ok: false, error: 'Cheque not found, or it was already returned or settled' };
  }

  const saved = records.find((r) => r.id === poId) || records[idx];
  let cashSettlement = null;
  if (settlement && settlement.paymentType === 'cash') {
    const product =
      poLineItems(saved)
        .map((item) => item.product)
        .filter(Boolean)
        .join(', ') || String(saved.product ?? '').trim();
    const description = [
      saved.poNumber ? `PO ${saved.poNumber}` : 'Purchase order',
      saved.distributorName,
      product,
      `Cheque #${parts[0]} ${action === 'settle_today' ? 'settled today' : 'returned'} · cash`,
    ]
      .filter(Boolean)
      .join(' · ');
    cashSettlement = {
      poId,
      poNumber: saved.poNumber || '',
      batchId: batchId || '',
      date: String(opts.settlementDate ?? opts.today ?? '').trim().slice(0, 10),
      amount: settlement.amount,
      description,
    };
  }

  return { ok: true, updated, po: saved, cashSettlement };
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

/**
 * Cancel a purchase order (admin). Per-product cheques are cancelled immediately.
 * Shared-batch cheques are cancelled only when this is the last active PO in the batch.
 * @returns {{ ok: boolean, error?: string, po?: object, cancelledAt?: string, shouldCancelCashBook?: boolean, batchId?: string|null, chequeMode?: string }}
 */
function cancelPurchaseOrder(records, opts) {
  const poId = String(opts?.poId ?? '').trim();
  const cancelledBy = String(opts?.cancelledBy ?? '').trim();
  if (!poId) return { ok: false, error: 'Purchase order id is required' };
  if (!cancelledBy) return { ok: false, error: 'cancelledBy (username) is required' };

  const idx = records.findIndex((r) => r.id === poId);
  if (idx < 0) return { ok: false, error: 'Purchase order not found' };

  const po = records[idx];
  if (isPurchaseOrderCancelled(po)) {
    return { ok: false, error: 'Purchase order is already cancelled' };
  }

  const cancelledAt = new Date().toISOString();
  const batchId = String(po.batchId ?? '').trim();
  const mode = String(po.chequeMode ?? '').trim();
  const batchRows = batchId
    ? records.filter((r) => String(r.batchId ?? '').trim() === batchId)
    : [po];
  const lastInBatch = batchRows.every(
    (r) => String(r.id) === poId || isPurchaseOrderCancelled(r),
  );
  const shouldCancelCheques = mode !== 'shared' || lastInBatch;

  const poIdsToTouchCheques = new Set([poId]);
  if (shouldCancelCheques && mode === 'shared' && batchId) {
    for (const r of batchRows) {
      const id = String(r.id ?? '').trim();
      if (id) poIdsToTouchCheques.add(id);
    }
  }

  if (shouldCancelCheques) {
    for (const id of poIdsToTouchCheques) {
      const i = records.findIndex((r) => r.id === id);
      if (i < 0) continue;
      const row = records[i];
      const cheques = Array.isArray(row.cheques) ? row.cheques.map((c) => (c && typeof c === 'object' ? { ...c } : c)) : [];
      let touched = false;
      for (const ch of cheques) {
        if (!ch || typeof ch !== 'object' || ch.cancelled || isPoCashPayment(ch)) continue;
        ch.cancelled = true;
        ch.cancelledAt = cancelledAt;
        ch.cancelledBy = cancelledBy;
        touched = true;
      }
      if (touched) {
        records[i] = { ...row, cheques, updatedAt: cancelledAt, updatedBy: cancelledBy };
      }
    }
  }

  const current = records[idx];
  records[idx] = {
    ...current,
    cancelled: true,
    cancelledAt,
    cancelledBy,
    updatedAt: cancelledAt,
    updatedBy: cancelledBy,
  };

  return {
    ok: true,
    po: records[idx],
    cancelledAt,
    lastInBatch,
    batchId: batchId || null,
    chequeMode: mode,
    shouldCancelCashBook: mode !== 'shared' || lastInBatch,
  };
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
  cancelPurchaseOrder,
  resolveIssuedPurchaseCheque,
  preserveChequeDispositions,
  effectivePoChequeDate,
  isPurchaseOrderCancelled,
  isPoCashPayment,
  isPoBankTransferPayment,
  normalizePaymentType,
  poLineItems,
  PURCHASE_ORDERS_FILE,
};
