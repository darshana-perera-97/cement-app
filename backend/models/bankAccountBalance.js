const { toNonNegMoney } = require('./customersStore');
const { poLineItems } = require('./purchaseOrdersStore');
const { getPaymentCheques } = require('./paymentCheques');
const { cdmPortion, onlineTransferPortion, isPaymentCreditActive } = require('./paymentOtherMethods');

function todayYmdUtc() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeAsOfDate(asOf) {
  const s = String(asOf ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return todayYmdUtc();
}

/** Unique PO outgoing cheques (shared batch cheques counted once). */
function collectPurchaseOrderOutgoingCheques(purchaseOrders) {
  const seen = new Set();
  const rows = [];
  for (const po of Array.isArray(purchaseOrders) ? purchaseOrders : []) {
    if (po?.cancelled) continue;
    const cheques = Array.isArray(po.cheques) ? po.cheques : [];
    const mode = String(po.chequeMode ?? '').trim();
    const batchId = String(po.batchId ?? '').trim();
    const poId = String(po.id ?? '').trim();
    for (let i = 0; i < cheques.length; i++) {
      const c = cheques[i];
      if (!c || typeof c !== 'object') continue;
      if (c.cancelled) continue;
      if (c.chequeReturned) continue;
      if (String(c.paymentType ?? '').trim().toLowerCase() === 'cash') continue;
      const bankAccountId = String(c.bankAccountId ?? '').trim();
      const amount = toNonNegMoney(c.amount);
      if (!bankAccountId || amount <= 0) continue;
      const paymentType =
        String(c.paymentType ?? '').trim().toLowerCase() === 'bank_transfer'
          ? 'bank_transfer'
          : 'cheque';
      const chequeNumber = String(c.chequeNumber ?? '').trim();
      const chequeDate = String(c.chequeDate ?? '').trim().slice(0, 10);
      const dedupeKey =
        mode === 'shared' && batchId
          ? `shared:${batchId}:${paymentType}:${chequeNumber}:${chequeDate}:${amount}:${bankAccountId}`
          : `po:${poId}:${i}:${paymentType}:${chequeNumber}:${chequeDate}:${amount}:${bankAccountId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const distributorId = String(po.distributorId ?? '').trim();
      const distributorName = String(po.distributorName ?? '').trim();
      rows.push({
        bankAccountId,
        amount,
        paymentType,
        chequeNumber,
        chequeDate,
        poId,
        batchId: batchId || undefined,
        product:
          poLineItems(po)
            .map((item) => item.product)
            .filter(Boolean)
            .join(', ') || undefined,
        source: 'purchase_order',
        ...(distributorId ? { distributorId } : {}),
        ...(distributorName ? { distributorName } : {}),
      });
    }
  }
  return rows;
}

function sumDepositsByAccount(cashBookEntries) {
  const totals = {};
  for (const row of Array.isArray(cashBookEntries) ? cashBookEntries : []) {
    if (String(row.category ?? '').trim() !== 'bank_deposit') continue;
    const amt = toNonNegMoney(row.amount);
    if (amt <= 0) continue;
    const ids = Array.isArray(row.bankAccountIds) ? row.bankAccountIds : [];
    for (const rawId of ids) {
      const id = String(rawId ?? '').trim();
      if (!id) continue;
      totals[id] = (totals[id] || 0) + amt;
    }
  }
  return totals;
}

function sumDepositedPaymentChequesByAccount(payments) {
  const totals = {};
  for (const p of Array.isArray(payments) ? payments : []) {
    const lines = getPaymentCheques(p);
    for (const c of lines) {
      if (!c.chequeDeposited || c.chequeReturned) continue;
      const bankAccountId = String(c.chequeDepositedBankAccountId ?? '').trim();
      if (!bankAccountId) continue;
      const amt = toNonNegMoney(c.amount);
      if (amt <= 0) continue;
      totals[bankAccountId] = (totals[bankAccountId] || 0) + amt;
    }
  }
  return totals;
}

function sumApprovedOtherMethodsByAccount(payments) {
  const totals = {};
  const add = (bankAccountId, amount) => {
    const id = String(bankAccountId ?? '').trim();
    const amt = toNonNegMoney(amount);
    if (!id || amt <= 0) return;
    totals[id] = (totals[id] || 0) + amt;
  };
  for (const p of Array.isArray(payments) ? payments : []) {
    if (!isPaymentCreditActive(p)) continue;
    add(p.cdmBankAccountId, cdmPortion(p));
    add(p.onlineTransferBankAccountId, onlineTransferPortion(p));
  }
  return totals;
}

function sumDepositedCompanyChequesByAccount(cashBookEntries) {
  const totals = {};
  for (const row of Array.isArray(cashBookEntries) ? cashBookEntries : []) {
    const category = String(row.category ?? '').trim();
    const isCompany = category === 'company_cheque';
    const isOwnerCheque =
      category === 'owner_share' &&
      String(row.ownerShareDirection ?? '').trim() === 'from_owner' &&
      String(row.paymentMethod ?? '').trim() === 'cheque';
    if (!isCompany && !isOwnerCheque) continue;
    if (!row.chequeDeposited) continue;
    const bankAccountId = String(row.chequeDepositedBankAccountId ?? '').trim();
    if (!bankAccountId) continue;
    const amt = toNonNegMoney(row.amount);
    if (amt <= 0) continue;
    totals[bankAccountId] = (totals[bankAccountId] || 0) + amt;
  }
  return totals;
}

/**
 * Running bank balance per account (may be negative).
 * Credits: cash-book deposits + deposited customer/company cheques + approved CDM / online transfers.
 * Cleared PO cheques / bank transfers: converting or transfer date (chequeDate) <= asOf.
 * Pending PO cheques / bank transfers: date > asOf.
 */
function computeBankAccountBalances({
  bankAccounts,
  cashBookEntries,
  payments,
  purchaseOrders,
  asOf,
}) {
  const asOfDate = normalizeAsOfDate(asOf);
  const accounts = Array.isArray(bankAccounts) ? bankAccounts : [];
  const deposits = sumDepositsByAccount(cashBookEntries);
  const incomingCheques = sumDepositedPaymentChequesByAccount(payments);
  const incomingOther = sumApprovedOtherMethodsByAccount(payments);
  const companyCheques = sumDepositedCompanyChequesByAccount(cashBookEntries);
  const outgoing = collectPurchaseOrderOutgoingCheques(purchaseOrders);

  const clearedOutgoing = {};
  const pendingOutgoing = {};

  for (const row of outgoing) {
    const id = row.bankAccountId;
    const amt = row.amount;
    const converting = row.chequeDate;
    if (converting && converting <= asOfDate) {
      clearedOutgoing[id] = (clearedOutgoing[id] || 0) + amt;
    } else {
      pendingOutgoing[id] = (pendingOutgoing[id] || 0) + amt;
    }
  }

  const byAccountId = {};
  for (const a of accounts) {
    const id = String(a.id ?? '').trim();
    if (!id) continue;
    const depositTotal = deposits[id] || 0;
    const otherTotal = incomingOther[id] || 0;
    const incomingTotal = (incomingCheques[id] || 0) + (companyCheques[id] || 0) + otherTotal;
    const cleared = clearedOutgoing[id] || 0;
    const pending = pendingOutgoing[id] || 0;
    const balance = Math.round((depositTotal + incomingTotal - cleared) * 100) / 100;
    byAccountId[id] = {
      bankAccountId: id,
      balance,
      pendingOutgoing: Math.round(pending * 100) / 100,
      clearedOutgoing: Math.round(cleared * 100) / 100,
      deposits: Math.round(depositTotal * 100) / 100,
      incomingCheques: Math.round(incomingTotal * 100) / 100,
      incomingOther: Math.round(otherTotal * 100) / 100,
    };
  }

  return { asOfDate, byAccountId, outgoingCheques: outgoing };
}

module.exports = {
  collectPurchaseOrderOutgoingCheques,
  computeBankAccountBalances,
  normalizeAsOfDate,
};
