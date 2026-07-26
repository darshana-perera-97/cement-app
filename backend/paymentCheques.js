const { toNonNegMoney } = require('./customersStore');

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function newChequeId() {
  return `chq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** One cheque line on a payment (stored or synthesized from legacy fields). */
function normalizeStoredCheque(c, legacyPayment) {
  const amount = toNonNegMoney(c?.amount);
  const chequeDate = String(c?.chequeDate ?? '').trim().slice(0, 10);
  const chequeNumber = String(c?.chequeNumber ?? '').trim();
  const deposited = !!c?.chequeDeposited;
  return {
    id: String(c?.id ?? '').trim() || (legacyPayment ? '_legacy' : newChequeId()),
    amount,
    chequeDate,
    chequeNumber,
    chequeDeposited: deposited,
    chequeDepositedAt: String(c?.chequeDepositedAt ?? '').trim(),
    chequeDepositedBy: String(c?.chequeDepositedBy ?? '').trim(),
  };
}

/** All cheques on a payment (supports legacy single-cheque fields). */
function getPaymentCheques(p) {
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.cheques) && p.cheques.length > 0) {
    return p.cheques
      .map((c) => normalizeStoredCheque(c, false))
      .filter((c) => c.amount > 0);
  }
  const amount = toNonNegMoney(p.chequeAmount);
  if (amount <= 0) return [];
  return [
    normalizeStoredCheque(
      {
        id: '_legacy',
        amount,
        chequeDate: p.chequeDate,
        chequeNumber: p.chequeNumber,
        chequeDeposited: p.chequeDeposited,
        chequeDepositedAt: p.chequeDepositedAt,
        chequeDepositedBy: p.chequeDepositedBy,
      },
      true,
    ),
  ];
}

function sumChequeAmounts(cheques) {
  return Math.round(cheques.reduce((s, c) => s + c.amount, 0) * 100) / 100;
}

/**
 * Parse cheque lines from POST body: `cheques` array and/or legacy single fields.
 * @returns {{ cheques: object[], error?: string }}
 */
function parseChequesFromBody(body) {
  const rawList = Array.isArray(body?.cheques) ? body.cheques : [];
  const parsed = [];

  if (rawList.length > 0) {
    for (let i = 0; i < rawList.length; i++) {
      const raw = rawList[i] || {};
      const amount = toNonNegMoney(raw.amount);
      if (amount <= 0) continue;
      const chequeDate = String(raw.chequeDate ?? '').trim().slice(0, 10);
      const chequeNumber = String(raw.chequeNumber ?? '').trim();
      if (!chequeDate || !YMD_RE.test(chequeDate)) {
        return { cheques: [], error: `Cheque ${i + 1}: a valid cheque date is required.` };
      }
      if (!chequeNumber) {
        return { cheques: [], error: `Cheque ${i + 1}: cheque number is required.` };
      }
      parsed.push({
        id: String(raw.id ?? '').trim(),
        amount,
        chequeDate,
        chequeNumber,
      });
    }
    return { cheques: parsed };
  }

  const amount = toNonNegMoney(body?.chequeAmount ?? 0);
  if (amount <= 0) return { cheques: [] };
  const chequeDate = String(body?.chequeDate ?? '').trim().slice(0, 10);
  const chequeNumber = String(body?.chequeNumber ?? '').trim();
  if (!chequeDate || !YMD_RE.test(chequeDate)) {
    return { cheques: [], error: 'Cheque date is required when cheque amount is greater than 0.' };
  }
  if (!chequeNumber) {
    return { cheques: [], error: 'Cheque number is required when cheque amount is greater than 0.' };
  }
  return { cheques: [{ amount, chequeDate, chequeNumber }] };
}

function buildChequesForStorage(parsedCheques) {
  return parsedCheques.map((c) => ({
    id: newChequeId(),
    amount: c.amount,
    chequeDate: c.chequeDate,
    chequeNumber: c.chequeNumber,
    chequeDeposited: false,
    chequeDepositedAt: '',
    chequeDepositedBy: '',
  }));
}

/**
 * Merge edited cheque lines with existing payment data, preserving deposit status.
 * @returns {{ cheques: object[], error?: string }}
 */
function buildChequesForUpdate(parsedCheques, existingPayment) {
  const existing = getPaymentCheques(existingPayment);
  const byId = new Map(existing.map((c) => [c.id, c]));
  const stored = [];

  for (const parsed of parsedCheques) {
    let id = String(parsed.id ?? '').trim();
    let prev = id && byId.has(id) ? byId.get(id) : null;
    if (!prev && !id && existing.length === 1) {
      prev = existing[0];
      id = prev.id;
    }
    if (prev?.chequeDeposited) {
      stored.push({
        id: prev.id,
        amount: prev.amount,
        chequeDate: prev.chequeDate,
        chequeNumber: prev.chequeNumber,
        chequeDeposited: true,
        chequeDepositedAt: prev.chequeDepositedAt,
        chequeDepositedBy: prev.chequeDepositedBy,
      });
      byId.delete(prev.id);
      continue;
    }
    stored.push({
      id: prev?.id || newChequeId(),
      amount: parsed.amount,
      chequeDate: parsed.chequeDate,
      chequeNumber: parsed.chequeNumber,
      chequeDeposited: false,
      chequeDepositedAt: '',
      chequeDepositedBy: '',
    });
    if (prev?.id) byId.delete(prev.id);
  }

  for (const ch of byId.values()) {
    if (ch.chequeDeposited) {
      return { cheques: [], error: 'Cannot remove a cheque that is already marked as deposited.' };
    }
  }

  return { cheques: stored };
}

/** Mirror first cheque + total on payment for older clients. */
function applyLegacyChequeFields(payment, storedCheques) {
  const total = sumChequeAmounts(storedCheques);
  payment.chequeAmount = total;
  if (storedCheques.length === 0) {
    payment.chequeDate = '';
    payment.chequeNumber = '';
    delete payment.chequeDeposited;
    delete payment.chequeDepositedAt;
    delete payment.chequeDepositedBy;
    return;
  }
  const first = storedCheques[0];
  payment.chequeDate = first.chequeDate;
  payment.chequeNumber = first.chequeNumber;
  if (storedCheques.length === 1) {
    payment.chequeDeposited = first.chequeDeposited;
    payment.chequeDepositedAt = first.chequeDepositedAt;
    payment.chequeDepositedBy = first.chequeDepositedBy;
  } else {
    delete payment.chequeDeposited;
    delete payment.chequeDepositedAt;
    delete payment.chequeDepositedBy;
  }
}

function chequeDepositQueueItem(payment, cheque) {
  return {
    id: payment.id,
    chequeId: cheque.id,
    customerName: payment.customerName,
    billNumber: payment.billNumber,
    chequeNumber: cheque.chequeNumber,
    chequeDate: cheque.chequeDate,
    chequeAmount: cheque.amount,
    date: payment.date,
    createdAt: payment.createdAt,
  };
}

module.exports = {
  YMD_RE,
  newChequeId,
  getPaymentCheques,
  sumChequeAmounts,
  parseChequesFromBody,
  buildChequesForStorage,
  buildChequesForUpdate,
  applyLegacyChequeFields,
  chequeDepositQueueItem,
};
