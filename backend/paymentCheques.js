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
  const returned = !!c?.chequeReturned;
  const line = {
    id: String(c?.id ?? '').trim() || (legacyPayment ? '_legacy' : newChequeId()),
    amount,
    chequeDate,
    chequeNumber,
    chequeDeposited: deposited,
    chequeDepositedAt: String(c?.chequeDepositedAt ?? '').trim(),
    chequeDepositedBy: String(c?.chequeDepositedBy ?? '').trim(),
    chequeReturned: returned,
    chequeReturnedAt: String(c?.chequeReturnedAt ?? '').trim(),
    chequeReturnedBy: String(c?.chequeReturnedBy ?? '').trim(),
  };
  const bankAccountId = String(c?.chequeDepositedBankAccountId ?? '').trim();
  if (bankAccountId) line.chequeDepositedBankAccountId = bankAccountId;
  const snap = c?.chequeDepositedBankAccount;
  if (snap && typeof snap === 'object') {
    line.chequeDepositedBankAccount = {
      id: String(snap.id ?? '').trim(),
      nickName: String(snap.nickName ?? '').trim(),
      bank: String(snap.bank ?? '').trim(),
      accountNumber: String(snap.accountNumber ?? '').trim(),
      accountType: String(snap.accountType ?? '').trim(),
    };
  }
  const note = String(c?.chequeDepositedNote ?? '').trim();
  if (note) line.chequeDepositedNote = note;
  const returnNote = String(c?.chequeReturnedNote ?? '').trim();
  if (returnNote) line.chequeReturnedNote = returnNote;
  return line;
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

function applyDepositMetaToChequeLine(ch, { recordedBy, depositedAt, bankAccountId, bankAccount, note }) {
  ch.chequeDeposited = true;
  ch.chequeDepositedAt = depositedAt;
  ch.chequeDepositedBy = recordedBy;
  if (bankAccountId) ch.chequeDepositedBankAccountId = bankAccountId;
  if (bankAccount) ch.chequeDepositedBankAccount = bankAccount;
  if (note) ch.chequeDepositedNote = note;
}

function applyReturnMetaToChequeLine(ch, { recordedBy, returnedAt, note }) {
  ch.chequeReturned = true;
  ch.chequeReturnedAt = returnedAt;
  ch.chequeReturnedBy = recordedBy;
  if (note) ch.chequeReturnedNote = note;
}

/**
 * Mark one cheque on a payment as returned (bounced).
 * @returns {{ payment: object, error?: string, cheque?: object }}
 */
function markChequeReturnedOnPayment(payment, opts) {
  const recordedBy = String(opts?.recordedBy ?? '').trim();
  if (!recordedBy) return { payment, error: 'recordedBy (username) is required' };
  const returnedAt = String(opts?.returnedAt ?? '').trim() || new Date().toISOString();
  const note = String(opts?.note ?? '').trim();
  const chequeId = String(opts?.chequeId ?? '').trim();

  const p = { ...payment };
  const chequeLines = getPaymentCheques(p);
  if (chequeLines.length === 0) {
    return { payment: p, error: 'This payment has no cheque' };
  }

  if (Array.isArray(p.cheques) && p.cheques.length > 0) {
    const targetId = chequeId || (p.cheques.length === 1 ? String(p.cheques[0].id || '') : '');
    if (!targetId) {
      return { payment: p, error: 'chequeId is required when a payment has multiple cheques' };
    }
    const chIdx = p.cheques.findIndex((c) => String(c.id) === targetId);
    if (chIdx < 0) {
      return { payment: p, error: 'Cheque not found on this payment' };
    }
    const ch = { ...p.cheques[chIdx] };
    if (ch.chequeReturned) {
      return { payment: p, error: 'This cheque is already marked as returned' };
    }
    applyReturnMetaToChequeLine(ch, { recordedBy, returnedAt, note });
    p.cheques = [...p.cheques];
    p.cheques[chIdx] = ch;
    applyLegacyChequeFields(p, getPaymentCheques(p));
    return { payment: p, cheque: ch };
  }

  if (p.chequeReturned) {
    return { payment: p, error: 'This cheque is already marked as returned' };
  }
  p.chequeReturned = true;
  p.chequeReturnedAt = returnedAt;
  p.chequeReturnedBy = recordedBy;
  if (note) p.chequeReturnedNote = note;
  return {
    payment: p,
    cheque: normalizeStoredCheque(
      {
        id: '_legacy',
        amount: p.chequeAmount,
        chequeDate: p.chequeDate,
        chequeNumber: p.chequeNumber,
        chequeReturned: true,
        chequeReturnedAt: returnedAt,
        chequeReturnedBy: recordedBy,
        chequeReturnedNote: note,
      },
      true,
    ),
  };
}

/**
 * Mark one cheque on a payment as deposited.
 * @returns {{ payment: object, error?: string }}
 */
function markChequeDepositedOnPayment(payment, opts) {
  const recordedBy = String(opts?.recordedBy ?? '').trim();
  if (!recordedBy) return { payment, error: 'recordedBy (username) is required' };
  const depositedAt = String(opts?.depositedAt ?? '').trim() || new Date().toISOString();
  const bankAccountId = String(opts?.bankAccountId ?? '').trim();
  const bankAccount = opts?.bankAccount ?? null;
  const note = String(opts?.note ?? '').trim();
  const chequeId = String(opts?.chequeId ?? '').trim();

  const p = { ...payment };
  const chequeLines = getPaymentCheques(p);
  if (chequeLines.length === 0) {
    return { payment: p, error: 'This payment has no cheque' };
  }

  if (Array.isArray(p.cheques) && p.cheques.length > 0) {
    const targetId = chequeId || (p.cheques.length === 1 ? String(p.cheques[0].id || '') : '');
    if (!targetId) {
      return { payment: p, error: 'chequeId is required when a payment has multiple cheques' };
    }
    const chIdx = p.cheques.findIndex((c) => String(c.id) === targetId);
    if (chIdx < 0) {
      return { payment: p, error: 'Cheque not found on this payment' };
    }
    const ch = { ...p.cheques[chIdx] };
    if (ch.chequeDeposited) {
      return { payment: p, error: 'This cheque is already marked as deposited' };
    }
    applyDepositMetaToChequeLine(ch, { recordedBy, depositedAt, bankAccountId, bankAccount, note });
    p.cheques = [...p.cheques];
    p.cheques[chIdx] = ch;
    applyLegacyChequeFields(p, getPaymentCheques(p));
    return { payment: p };
  }

  if (p.chequeDeposited) {
    return { payment: p, error: 'This cheque is already marked as deposited' };
  }
  p.chequeDeposited = true;
  p.chequeDepositedAt = depositedAt;
  p.chequeDepositedBy = recordedBy;
  if (bankAccountId) p.chequeDepositedBankAccountId = bankAccountId;
  if (bankAccount) p.chequeDepositedBankAccount = bankAccount;
  if (note) p.chequeDepositedNote = note;
  return { payment: p };
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
        chequeReturned: p.chequeReturned,
        chequeReturnedAt: p.chequeReturnedAt,
        chequeReturnedBy: p.chequeReturnedBy,
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
    if (prev?.chequeDeposited || prev?.chequeReturned) {
      const kept = {
        id: prev.id,
        amount: prev.amount,
        chequeDate: prev.chequeDate,
        chequeNumber: prev.chequeNumber,
        chequeDeposited: !!prev.chequeDeposited,
        chequeDepositedAt: prev.chequeDepositedAt,
        chequeDepositedBy: prev.chequeDepositedBy,
        chequeReturned: !!prev.chequeReturned,
        chequeReturnedAt: prev.chequeReturnedAt,
        chequeReturnedBy: prev.chequeReturnedBy,
      };
      if (prev.chequeDepositedBankAccountId) kept.chequeDepositedBankAccountId = prev.chequeDepositedBankAccountId;
      if (prev.chequeDepositedBankAccount) kept.chequeDepositedBankAccount = prev.chequeDepositedBankAccount;
      if (prev.chequeDepositedNote) kept.chequeDepositedNote = prev.chequeDepositedNote;
      if (prev.chequeReturnedNote) kept.chequeReturnedNote = prev.chequeReturnedNote;
      stored.push(kept);
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
    if (ch.chequeReturned) {
      return { cheques: [], error: 'Cannot remove a cheque that is already marked as returned.' };
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
    delete payment.chequeDepositedBankAccountId;
    delete payment.chequeDepositedBankAccount;
    delete payment.chequeDepositedNote;
    return;
  }
  const first = storedCheques[0];
  payment.chequeDate = first.chequeDate;
  payment.chequeNumber = first.chequeNumber;
  if (storedCheques.length === 1) {
    payment.chequeDeposited = first.chequeDeposited;
    payment.chequeDepositedAt = first.chequeDepositedAt;
    payment.chequeDepositedBy = first.chequeDepositedBy;
    if (first.chequeDepositedBankAccountId) {
      payment.chequeDepositedBankAccountId = first.chequeDepositedBankAccountId;
    } else {
      delete payment.chequeDepositedBankAccountId;
    }
    if (first.chequeDepositedBankAccount) {
      payment.chequeDepositedBankAccount = first.chequeDepositedBankAccount;
    } else {
      delete payment.chequeDepositedBankAccount;
    }
    if (first.chequeDepositedNote) payment.chequeDepositedNote = first.chequeDepositedNote;
    else delete payment.chequeDepositedNote;
  } else {
    delete payment.chequeDeposited;
    delete payment.chequeDepositedAt;
    delete payment.chequeDepositedBy;
    delete payment.chequeDepositedBankAccountId;
    delete payment.chequeDepositedBankAccount;
    delete payment.chequeDepositedNote;
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
  bankAccountSnapshot,
  markChequeDepositedOnPayment,
  markChequeReturnedOnPayment,
};
