const { toNonNegMoney } = require('./customersStore');

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function newCdmId() {
  return `cdm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function newOnlineTransferId() {
  return `ot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function findBankAccount(bankAccounts, id) {
  const want = String(id ?? '').trim();
  if (!want) return null;
  return (
    (Array.isArray(bankAccounts) ? bankAccounts : []).find(
      (a) => String(a?.id ?? '').trim() === want,
    ) || null
  );
}

function normalizeStoredCdmDeposit(d, legacyPayment) {
  const amount = toNonNegMoney(d?.amount);
  const line = {
    id: String(d?.id ?? '').trim() || (legacyPayment ? '_legacy' : newCdmId()),
    amount,
    cdmNumber: String(d?.cdmNumber ?? '').trim(),
    bankAccountId: String(d?.bankAccountId ?? d?.cdmBankAccountId ?? '').trim(),
  };
  const snap = d?.bankAccount || d?.cdmBankAccount;
  if (snap && typeof snap === 'object') {
    line.bankAccount = bankAccountSnapshot(snap);
    if (!line.bankAccountId && line.bankAccount?.id) line.bankAccountId = line.bankAccount.id;
  }
  return line;
}

function normalizeStoredOnlineTransfer(t, legacyPayment) {
  const amount = toNonNegMoney(t?.amount);
  const line = {
    id: String(t?.id ?? '').trim() || (legacyPayment ? '_legacy' : newOnlineTransferId()),
    amount,
    reference: String(t?.reference ?? t?.onlineTransferReference ?? '').trim(),
    bankAccountId: String(t?.bankAccountId ?? t?.onlineTransferBankAccountId ?? '').trim(),
  };
  const snap = t?.bankAccount || t?.onlineTransferBankAccount;
  if (snap && typeof snap === 'object') {
    line.bankAccount = bankAccountSnapshot(snap);
    if (!line.bankAccountId && line.bankAccount?.id) line.bankAccountId = line.bankAccount.id;
  }
  return line;
}

/** All CDM deposits on a payment (supports legacy single-CDM fields). */
function getPaymentCdmDeposits(p) {
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.cdmDeposits) && p.cdmDeposits.length > 0) {
    return p.cdmDeposits
      .map((d) => normalizeStoredCdmDeposit(d, false))
      .filter((d) => d.amount > 0);
  }
  const amount = toNonNegMoney(p.cdmAmount);
  if (amount <= 0) return [];
  return [
    normalizeStoredCdmDeposit(
      {
        id: '_legacy',
        amount,
        cdmNumber: p.cdmNumber,
        bankAccountId: p.cdmBankAccountId,
        bankAccount: p.cdmBankAccount,
      },
      true,
    ),
  ];
}

/** All online transfers on a payment (supports legacy single-transfer fields). */
function getPaymentOnlineTransfers(p) {
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.onlineTransfers) && p.onlineTransfers.length > 0) {
    return p.onlineTransfers
      .map((t) => normalizeStoredOnlineTransfer(t, false))
      .filter((t) => t.amount > 0);
  }
  const amount = toNonNegMoney(p.onlineTransferAmount);
  if (amount <= 0) return [];
  return [
    normalizeStoredOnlineTransfer(
      {
        id: '_legacy',
        amount,
        reference: p.onlineTransferReference,
        bankAccountId: p.onlineTransferBankAccountId,
        bankAccount: p.onlineTransferBankAccount,
      },
      true,
    ),
  ];
}

function cdmPortion(p) {
  const deposits = getPaymentCdmDeposits(p);
  if (deposits.length > 0) {
    return roundMoney(deposits.reduce((s, d) => s + d.amount, 0));
  }
  return toNonNegMoney(p?.cdmAmount);
}

function onlineTransferPortion(p) {
  const transfers = getPaymentOnlineTransfers(p);
  if (transfers.length > 0) {
    return roundMoney(transfers.reduce((s, t) => s + t.amount, 0));
  }
  return toNonNegMoney(p?.onlineTransferAmount);
}

function emptyOtherMethodsParse(error) {
  return {
    cdmAmount: 0,
    cdmNumber: '',
    cdmBankAccountId: '',
    cdmBankAccount: null,
    cdmDeposits: [],
    onlineTransferAmount: 0,
    onlineTransferReference: '',
    onlineTransferBankAccountId: '',
    onlineTransferBankAccount: null,
    onlineTransfers: [],
    error,
  };
}

function parseCdmDepositsFromBody(body) {
  const rawList = Array.isArray(body?.cdmDeposits) ? body.cdmDeposits : [];
  const parsed = [];
  if (rawList.length > 0) {
    for (let i = 0; i < rawList.length; i++) {
      const raw = rawList[i] || {};
      const amount = toNonNegMoney(raw.amount);
      if (amount <= 0) continue;
      const cdmNumber = String(raw.cdmNumber ?? '').trim();
      const bankAccountId = String(raw.bankAccountId ?? raw.cdmBankAccountId ?? '').trim();
      if (!cdmNumber) {
        return { deposits: [], error: `CDM deposit ${i + 1}: CDM number is required.` };
      }
      if (!bankAccountId) {
        return { deposits: [], error: `CDM deposit ${i + 1}: select a bank account.` };
      }
      parsed.push({
        id: String(raw.id ?? '').trim(),
        amount,
        cdmNumber,
        bankAccountId,
      });
    }
    return { deposits: parsed };
  }

  const amount = toNonNegMoney(body?.cdmAmount ?? 0);
  if (amount <= 0) return { deposits: [] };
  const cdmNumber = String(body?.cdmNumber ?? '').trim();
  const bankAccountId = String(body?.cdmBankAccountId ?? '').trim();
  if (!cdmNumber) {
    return { deposits: [], error: 'CDM number is required when CDM deposit amount is greater than 0.' };
  }
  if (!bankAccountId) {
    return { deposits: [], error: 'Select a bank account when CDM deposit amount is greater than 0.' };
  }
  return {
    deposits: [{ amount, cdmNumber, bankAccountId }],
  };
}

function parseOnlineTransfersFromBody(body) {
  const rawList = Array.isArray(body?.onlineTransfers) ? body.onlineTransfers : [];
  const parsed = [];
  if (rawList.length > 0) {
    for (let i = 0; i < rawList.length; i++) {
      const raw = rawList[i] || {};
      const amount = toNonNegMoney(raw.amount);
      if (amount <= 0) continue;
      const reference = String(raw.reference ?? raw.onlineTransferReference ?? '').trim();
      const bankAccountId = String(raw.bankAccountId ?? raw.onlineTransferBankAccountId ?? '').trim();
      if (!reference) {
        return {
          transfers: [],
          error: `Online transfer ${i + 1}: reference number is required.`,
        };
      }
      if (!bankAccountId) {
        return { transfers: [], error: `Online transfer ${i + 1}: select a bank account.` };
      }
      parsed.push({
        id: String(raw.id ?? '').trim(),
        amount,
        reference,
        bankAccountId,
      });
    }
    return { transfers: parsed };
  }

  const amount = toNonNegMoney(body?.onlineTransferAmount ?? 0);
  if (amount <= 0) return { transfers: [] };
  const reference = String(body?.onlineTransferReference ?? '').trim();
  const bankAccountId = String(body?.onlineTransferBankAccountId ?? '').trim();
  if (!reference) {
    return {
      transfers: [],
      error: 'Online transfer reference number is required when online transfer amount is greater than 0.',
    };
  }
  if (!bankAccountId) {
    return { transfers: [], error: 'Select a bank account when online transfer amount is greater than 0.' };
  }
  return {
    transfers: [{ amount, reference, bankAccountId }],
  };
}

/**
 * Parse CDM deposits and online transfers from POST/PATCH body.
 * Accepts `cdmDeposits` / `onlineTransfers` arrays and/or legacy single fields.
 */
function parseOtherPaymentMethodsFromBody(body) {
  const cdm = parseCdmDepositsFromBody(body);
  if (cdm.error) return emptyOtherMethodsParse(cdm.error);
  const online = parseOnlineTransfersFromBody(body);
  if (online.error) return emptyOtherMethodsParse(online.error);

  const cdmAmount = roundMoney(cdm.deposits.reduce((s, d) => s + d.amount, 0));
  const onlineTransferAmount = roundMoney(online.transfers.reduce((s, t) => s + t.amount, 0));
  const firstCdm = cdm.deposits[0];
  const firstOnline = online.transfers[0];

  return {
    cdmAmount,
    cdmNumber: firstCdm?.cdmNumber || '',
    cdmBankAccountId: firstCdm?.bankAccountId || '',
    cdmDeposits: cdm.deposits,
    onlineTransferAmount,
    onlineTransferReference: firstOnline?.reference || '',
    onlineTransferBankAccountId: firstOnline?.bankAccountId || '',
    onlineTransfers: online.transfers,
  };
}

function storageId(rawId, makeId) {
  const id = String(rawId ?? '').trim();
  if (!id || id === '_legacy') return makeId();
  return id;
}

/**
 * Resolve CDM / online shop bank accounts and attach snapshots.
 * Call after parseOtherPaymentMethodsFromBody (or with equivalent amounts + ids).
 */
function resolveOtherMethodBankAccounts(parsed, bankAccounts) {
  if (!parsed || parsed.error) return parsed;
  const next = { ...parsed, cdmDeposits: [], onlineTransfers: [] };

  const sourceDeposits =
    Array.isArray(parsed.cdmDeposits) && parsed.cdmDeposits.length > 0
      ? parsed.cdmDeposits
      : parsed.cdmAmount > 0
        ? [
            {
              amount: parsed.cdmAmount,
              cdmNumber: parsed.cdmNumber,
              bankAccountId: parsed.cdmBankAccountId,
            },
          ]
        : [];

  for (let i = 0; i < sourceDeposits.length; i++) {
    const d = sourceDeposits[i];
    const acct = findBankAccount(bankAccounts, d.bankAccountId);
    if (!acct) {
      return emptyOtherMethodsParse(
        sourceDeposits.length > 1
          ? `CDM deposit ${i + 1}: select a valid bank account.`
          : 'Select a valid bank account for CDM deposit.',
      );
    }
    next.cdmDeposits.push({
      id: String(d.id ?? '').trim(),
      amount: toNonNegMoney(d.amount),
      cdmNumber: String(d.cdmNumber ?? '').trim(),
      bankAccountId: String(acct.id).trim(),
      bankAccount: bankAccountSnapshot(acct),
    });
  }

  const sourceTransfers =
    Array.isArray(parsed.onlineTransfers) && parsed.onlineTransfers.length > 0
      ? parsed.onlineTransfers
      : parsed.onlineTransferAmount > 0
        ? [
            {
              amount: parsed.onlineTransferAmount,
              reference: parsed.onlineTransferReference,
              bankAccountId: parsed.onlineTransferBankAccountId,
            },
          ]
        : [];

  for (let i = 0; i < sourceTransfers.length; i++) {
    const t = sourceTransfers[i];
    const acct = findBankAccount(bankAccounts, t.bankAccountId);
    if (!acct) {
      return emptyOtherMethodsParse(
        sourceTransfers.length > 1
          ? `Online transfer ${i + 1}: select a valid bank account.`
          : 'Select a valid bank account for online transfer.',
      );
    }
    next.onlineTransfers.push({
      id: String(t.id ?? '').trim(),
      amount: toNonNegMoney(t.amount),
      reference: String(t.reference ?? t.onlineTransferReference ?? '').trim(),
      bankAccountId: String(acct.id).trim(),
      bankAccount: bankAccountSnapshot(acct),
    });
  }

  next.cdmAmount = roundMoney(next.cdmDeposits.reduce((s, d) => s + d.amount, 0));
  if (next.cdmDeposits.length > 0) {
    next.cdmNumber = next.cdmDeposits[0].cdmNumber;
    next.cdmBankAccountId = next.cdmDeposits[0].bankAccountId;
    next.cdmBankAccount = next.cdmDeposits[0].bankAccount;
  } else {
    next.cdmNumber = '';
    next.cdmBankAccountId = '';
    next.cdmBankAccount = null;
  }

  next.onlineTransferAmount = roundMoney(next.onlineTransfers.reduce((s, t) => s + t.amount, 0));
  if (next.onlineTransfers.length > 0) {
    next.onlineTransferReference = next.onlineTransfers[0].reference;
    next.onlineTransferBankAccountId = next.onlineTransfers[0].bankAccountId;
    next.onlineTransferBankAccount = next.onlineTransfers[0].bankAccount;
  } else {
    next.onlineTransferReference = '';
    next.onlineTransferBankAccountId = '';
    next.onlineTransferBankAccount = null;
  }

  return next;
}

function applyLegacyCdmFields(row, deposits) {
  const total = roundMoney((deposits || []).reduce((s, d) => s + toNonNegMoney(d.amount), 0));
  if (total <= 0) {
    delete row.cdmAmount;
    delete row.cdmNumber;
    delete row.cdmBankAccountId;
    delete row.cdmBankAccount;
    return;
  }
  const first = deposits[0];
  row.cdmAmount = total;
  row.cdmNumber = String(first?.cdmNumber ?? '').trim();
  if (first?.bankAccountId) row.cdmBankAccountId = first.bankAccountId;
  else delete row.cdmBankAccountId;
  if (first?.bankAccount) row.cdmBankAccount = first.bankAccount;
  else delete row.cdmBankAccount;
}

function applyLegacyOnlineTransferFields(row, transfers) {
  const total = roundMoney((transfers || []).reduce((s, t) => s + toNonNegMoney(t.amount), 0));
  if (total <= 0) {
    delete row.onlineTransferAmount;
    delete row.onlineTransferReference;
    delete row.onlineTransferBankAccountId;
    delete row.onlineTransferBankAccount;
    return;
  }
  const first = transfers[0];
  row.onlineTransferAmount = total;
  row.onlineTransferReference = String(first?.reference ?? '').trim();
  if (first?.bankAccountId) row.onlineTransferBankAccountId = first.bankAccountId;
  else delete row.onlineTransferBankAccountId;
  if (first?.bankAccount) row.onlineTransferBankAccount = first.bankAccount;
  else delete row.onlineTransferBankAccount;
}

function attachOtherPaymentMethodsToRow(row, parsed) {
  const deposits = (Array.isArray(parsed.cdmDeposits) ? parsed.cdmDeposits : [])
    .filter((d) => toNonNegMoney(d.amount) > 0)
    .map((d) => {
      const line = {
        id: storageId(d.id, newCdmId),
        amount: toNonNegMoney(d.amount),
        cdmNumber: String(d.cdmNumber ?? '').trim(),
        bankAccountId: String(d.bankAccountId ?? '').trim(),
      };
      if (d.bankAccount) line.bankAccount = d.bankAccount;
      return line;
    });
  const transfers = (Array.isArray(parsed.onlineTransfers) ? parsed.onlineTransfers : [])
    .filter((t) => toNonNegMoney(t.amount) > 0)
    .map((t) => {
      const line = {
        id: storageId(t.id, newOnlineTransferId),
        amount: toNonNegMoney(t.amount),
        reference: String(t.reference ?? t.onlineTransferReference ?? '').trim(),
        bankAccountId: String(t.bankAccountId ?? '').trim(),
      };
      if (t.bankAccount) line.bankAccount = t.bankAccount;
      return line;
    });

  if (deposits.length > 0) row.cdmDeposits = deposits;
  else delete row.cdmDeposits;
  applyLegacyCdmFields(row, deposits);

  if (transfers.length > 0) row.onlineTransfers = transfers;
  else delete row.onlineTransfers;
  applyLegacyOnlineTransferFields(row, transfers);
}

function pickOverrideBankAccountId(line, index, bodyLines, singleOverride, onlyOne) {
  const match =
    (Array.isArray(bodyLines) ? bodyLines : []).find(
      (x) => String(x?.id ?? '').trim() && String(x.id).trim() === String(line.id ?? '').trim(),
    ) || (Array.isArray(bodyLines) ? bodyLines[index] : null);
  const fromLine = String(match?.bankAccountId ?? match?.cdmBankAccountId ?? match?.onlineTransferBankAccountId ?? '').trim();
  if (fromLine) return fromLine;
  if (onlyOne && singleOverride) return singleOverride;
  return String(line.bankAccountId ?? '').trim();
}

/** Apply manager bank-account choices when approving a pending CDM / online payment. */
function resolveApprovalBankAccounts(existing, body, bankAccounts) {
  const deposits = getPaymentCdmDeposits(existing);
  const transfers = getPaymentOnlineTransfers(existing);
  const bodyCdm = Array.isArray(body?.cdmDeposits) ? body.cdmDeposits : [];
  const bodyOnline = Array.isArray(body?.onlineTransfers) ? body.onlineTransfers : [];
  const singleCdm = String(body?.cdmBankAccountId ?? '').trim();
  const singleOnline = String(body?.onlineTransferBankAccountId ?? '').trim();

  return resolveOtherMethodBankAccounts(
    {
      cdmDeposits: deposits.map((d, i) => ({
        id: d.id,
        amount: d.amount,
        cdmNumber: d.cdmNumber,
        bankAccountId: pickOverrideBankAccountId(d, i, bodyCdm, singleCdm, deposits.length === 1),
      })),
      onlineTransfers: transfers.map((t, i) => ({
        id: t.id,
        amount: t.amount,
        reference: t.reference,
        bankAccountId: pickOverrideBankAccountId(t, i, bodyOnline, singleOnline, transfers.length === 1),
      })),
    },
    bankAccounts,
  );
}

function paymentRequiresApproval(parsed) {
  return parsed.cdmAmount > 0 || parsed.onlineTransferAmount > 0;
}

function normalizeApprovalStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'approved' || s === 'rejected') return s;
  return 'pending';
}

function isPaymentApprovalPending(p) {
  return !!p?.requiresApproval && normalizeApprovalStatus(p.approvalStatus) === 'pending';
}

function isPaymentCreditActive(p) {
  if (!p?.requiresApproval) return true;
  return normalizeApprovalStatus(p.approvalStatus) === 'approved';
}

function attachApprovalMetaToRow(row, parsed, existing = null) {
  if (!paymentRequiresApproval(parsed)) {
    delete row.requiresApproval;
    delete row.approvalStatus;
    delete row.approvedBy;
    delete row.approvedAt;
    delete row.rejectedBy;
    delete row.rejectedAt;
    return;
  }
  row.requiresApproval = true;
  const prevStatus = existing ? normalizeApprovalStatus(existing.approvalStatus) : 'pending';
  if (prevStatus === 'approved') {
    row.approvalStatus = 'approved';
    return;
  }
  if (prevStatus === 'rejected') {
    row.approvalStatus = 'rejected';
    return;
  }
  row.approvalStatus = 'pending';
}

module.exports = {
  cdmPortion,
  onlineTransferPortion,
  getPaymentCdmDeposits,
  getPaymentOnlineTransfers,
  parseOtherPaymentMethodsFromBody,
  resolveOtherMethodBankAccounts,
  resolveApprovalBankAccounts,
  attachOtherPaymentMethodsToRow,
  paymentRequiresApproval,
  normalizeApprovalStatus,
  isPaymentApprovalPending,
  isPaymentCreditActive,
  attachApprovalMetaToRow,
};
