const { toNonNegMoney } = require('./customersStore');

function cdmPortion(p) {
  return toNonNegMoney(p?.cdmAmount);
}

function onlineTransferPortion(p) {
  return toNonNegMoney(p?.onlineTransferAmount);
}

function emptyOtherMethodsParse(error) {
  return {
    cdmAmount: 0,
    cdmNumber: '',
    cdmBankAccountId: '',
    cdmBankAccount: null,
    onlineTransferAmount: 0,
    onlineTransferReference: '',
    onlineTransferBankAccountId: '',
    onlineTransferBankAccount: null,
    error,
  };
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

/**
 * Parse CDM deposit and online transfer from POST/PATCH body.
 * @returns {{ cdmAmount: number, cdmNumber: string, cdmBankAccountId: string, onlineTransferAmount: number, onlineTransferReference: string, onlineTransferBankAccountId: string, error?: string }}
 */
function parseOtherPaymentMethodsFromBody(body) {
  const cdmAmount = toNonNegMoney(body?.cdmAmount ?? 0);
  const cdmNumber = String(body?.cdmNumber ?? '').trim();
  const cdmBankAccountId = String(body?.cdmBankAccountId ?? '').trim();
  const onlineTransferAmount = toNonNegMoney(body?.onlineTransferAmount ?? 0);
  const onlineTransferReference = String(body?.onlineTransferReference ?? '').trim();
  const onlineTransferBankAccountId = String(body?.onlineTransferBankAccountId ?? '').trim();

  if (cdmAmount > 0 && !cdmNumber) {
    return emptyOtherMethodsParse('CDM number is required when CDM deposit amount is greater than 0.');
  }
  if (cdmAmount > 0 && !cdmBankAccountId) {
    return emptyOtherMethodsParse('Select a bank account when CDM deposit amount is greater than 0.');
  }
  if (onlineTransferAmount > 0 && !onlineTransferReference) {
    return emptyOtherMethodsParse(
      'Online transfer reference number is required when online transfer amount is greater than 0.',
    );
  }
  if (onlineTransferAmount > 0 && !onlineTransferBankAccountId) {
    return emptyOtherMethodsParse('Select a bank account when online transfer amount is greater than 0.');
  }

  return {
    cdmAmount,
    cdmNumber,
    cdmBankAccountId,
    onlineTransferAmount,
    onlineTransferReference,
    onlineTransferBankAccountId,
  };
}

/**
 * Resolve CDM / online shop bank accounts and attach snapshots.
 * Call after parseOtherPaymentMethodsFromBody (or with equivalent amounts + ids).
 */
function resolveOtherMethodBankAccounts(parsed, bankAccounts) {
  if (!parsed || parsed.error) return parsed;
  const next = { ...parsed };
  if (next.cdmAmount > 0) {
    const acct = findBankAccount(bankAccounts, next.cdmBankAccountId);
    if (!acct) {
      return emptyOtherMethodsParse('Select a valid bank account for CDM deposit.');
    }
    next.cdmBankAccountId = String(acct.id).trim();
    next.cdmBankAccount = bankAccountSnapshot(acct);
  } else {
    next.cdmBankAccountId = '';
    next.cdmBankAccount = null;
  }
  if (next.onlineTransferAmount > 0) {
    const acct = findBankAccount(bankAccounts, next.onlineTransferBankAccountId);
    if (!acct) {
      return emptyOtherMethodsParse('Select a valid bank account for online transfer.');
    }
    next.onlineTransferBankAccountId = String(acct.id).trim();
    next.onlineTransferBankAccount = bankAccountSnapshot(acct);
  } else {
    next.onlineTransferBankAccountId = '';
    next.onlineTransferBankAccount = null;
  }
  return next;
}

function attachOtherPaymentMethodsToRow(row, parsed) {
  if (parsed.cdmAmount > 0) {
    row.cdmAmount = parsed.cdmAmount;
    row.cdmNumber = parsed.cdmNumber;
    if (parsed.cdmBankAccountId) row.cdmBankAccountId = parsed.cdmBankAccountId;
    else delete row.cdmBankAccountId;
    if (parsed.cdmBankAccount) row.cdmBankAccount = parsed.cdmBankAccount;
    else delete row.cdmBankAccount;
  } else {
    delete row.cdmAmount;
    delete row.cdmNumber;
    delete row.cdmBankAccountId;
    delete row.cdmBankAccount;
  }
  if (parsed.onlineTransferAmount > 0) {
    row.onlineTransferAmount = parsed.onlineTransferAmount;
    row.onlineTransferReference = parsed.onlineTransferReference;
    if (parsed.onlineTransferBankAccountId) {
      row.onlineTransferBankAccountId = parsed.onlineTransferBankAccountId;
    } else {
      delete row.onlineTransferBankAccountId;
    }
    if (parsed.onlineTransferBankAccount) {
      row.onlineTransferBankAccount = parsed.onlineTransferBankAccount;
    } else {
      delete row.onlineTransferBankAccount;
    }
  } else {
    delete row.onlineTransferAmount;
    delete row.onlineTransferReference;
    delete row.onlineTransferBankAccountId;
    delete row.onlineTransferBankAccount;
  }
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
  parseOtherPaymentMethodsFromBody,
  resolveOtherMethodBankAccounts,
  attachOtherPaymentMethodsToRow,
  paymentRequiresApproval,
  normalizeApprovalStatus,
  isPaymentApprovalPending,
  isPaymentCreditActive,
  attachApprovalMetaToRow,
};
