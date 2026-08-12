const { toNonNegMoney } = require('./customersStore');

function cdmPortion(p) {
  return toNonNegMoney(p?.cdmAmount);
}

function onlineTransferPortion(p) {
  return toNonNegMoney(p?.onlineTransferAmount);
}

/**
 * Parse CDM deposit and online transfer from POST/PATCH body.
 * @returns {{ cdmAmount: number, cdmNumber: string, onlineTransferAmount: number, onlineTransferReference: string, error?: string }}
 */
function parseOtherPaymentMethodsFromBody(body) {
  const cdmAmount = toNonNegMoney(body?.cdmAmount ?? 0);
  const cdmNumber = String(body?.cdmNumber ?? '').trim();
  const onlineTransferAmount = toNonNegMoney(body?.onlineTransferAmount ?? 0);
  const onlineTransferReference = String(body?.onlineTransferReference ?? '').trim();

  if (cdmAmount > 0 && !cdmNumber) {
    return {
      cdmAmount: 0,
      cdmNumber: '',
      onlineTransferAmount: 0,
      onlineTransferReference: '',
      error: 'CDM number is required when CDM deposit amount is greater than 0.',
    };
  }
  if (onlineTransferAmount > 0 && !onlineTransferReference) {
    return {
      cdmAmount: 0,
      cdmNumber: '',
      onlineTransferAmount: 0,
      onlineTransferReference: '',
      error: 'Online transfer reference number is required when online transfer amount is greater than 0.',
    };
  }

  return { cdmAmount, cdmNumber, onlineTransferAmount, onlineTransferReference };
}

function attachOtherPaymentMethodsToRow(row, parsed) {
  if (parsed.cdmAmount > 0) {
    row.cdmAmount = parsed.cdmAmount;
    row.cdmNumber = parsed.cdmNumber;
  } else {
    delete row.cdmAmount;
    delete row.cdmNumber;
  }
  if (parsed.onlineTransferAmount > 0) {
    row.onlineTransferAmount = parsed.onlineTransferAmount;
    row.onlineTransferReference = parsed.onlineTransferReference;
  } else {
    delete row.onlineTransferAmount;
    delete row.onlineTransferReference;
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
  attachOtherPaymentMethodsToRow,
  paymentRequiresApproval,
  normalizeApprovalStatus,
  isPaymentApprovalPending,
  isPaymentCreditActive,
  attachApprovalMetaToRow,
};
