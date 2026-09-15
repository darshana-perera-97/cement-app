/** Expand a payment into one row per cheque (supports legacy single-cheque fields). */
export function getPaymentCheques(p) {
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.cheques) && p.cheques.length > 0) {
    return p.cheques
      .map((c) => ({
        id: String(c?.id ?? '').trim() || '_legacy',
        amount: Math.max(0, Number(c?.amount) || 0),
        chequeDate: String(c?.chequeDate ?? '').slice(0, 10),
        chequeNumber: String(c?.chequeNumber ?? '').trim(),
        chequeBank: String(c?.chequeBank ?? '').trim(),
        chequeBankCode: String(c?.chequeBankCode ?? '').trim(),
        chequeBranchCode: String(c?.chequeBranchCode ?? '').trim(),
        chequeDeposited: !!c?.chequeDeposited,
        chequeDepositedAt: String(c?.chequeDepositedAt ?? '').trim(),
        chequeDepositedBy: String(c?.chequeDepositedBy ?? '').trim(),
        chequeDepositedBankAccountId: String(c?.chequeDepositedBankAccountId ?? '').trim(),
        chequeDepositedBankAccount: c?.chequeDepositedBankAccount,
        chequeDepositedNote: String(c?.chequeDepositedNote ?? '').trim(),
        chequeReturned: !!c?.chequeReturned,
        chequeReturnedAt: String(c?.chequeReturnedAt ?? '').trim(),
        chequeReturnedBy: String(c?.chequeReturnedBy ?? '').trim(),
        chequeReturnedNote: String(c?.chequeReturnedNote ?? '').trim(),
      }))
      .filter((c) => c.amount > 0);
  }
  const amount = Math.max(0, Number(p.chequeAmount) || 0);
  if (amount <= 0) return [];
  return [
    {
      id: '_legacy',
      amount,
      chequeDate: String(p.chequeDate || p.date || '').slice(0, 10),
      chequeNumber: String(p.chequeNumber ?? '').trim(),
      chequeDeposited: !!p.chequeDeposited,
      chequeDepositedAt: String(p.chequeDepositedAt ?? '').trim(),
      chequeDepositedBy: String(p.chequeDepositedBy ?? '').trim(),
      chequeDepositedBankAccountId: String(p.chequeDepositedBankAccountId ?? '').trim(),
      chequeDepositedBankAccount: p.chequeDepositedBankAccount,
      chequeDepositedNote: String(p.chequeDepositedNote ?? '').trim(),
      chequeReturned: !!p.chequeReturned,
      chequeReturnedAt: String(p.chequeReturnedAt ?? '').trim(),
      chequeReturnedBy: String(p.chequeReturnedBy ?? '').trim(),
      chequeReturnedNote: String(p.chequeReturnedNote ?? '').trim(),
    },
  ];
}

export function chequePortion(p) {
  const fromArray = getPaymentCheques(p).reduce((s, c) => s + c.amount, 0);
  if (fromArray > 0) return fromArray;
  return Math.max(0, Number(p.chequeAmount) || 0);
}

/** Cash credited on a payment (physical cash from customer). */
export function cashPortion(p) {
  if (p.cashAmount !== undefined || p.chequeAmount !== undefined) {
    return Math.max(0, Number(p.cashAmount) || 0);
  }
  const total = Number(p.amount) || 0;
  if (total > 0) return total;
  return Math.max(0, Number(p.cashAmount) || 0);
}

function bankSnapFromLine(line) {
  const snap = line?.bankAccount || line?.cdmBankAccount || line?.onlineTransferBankAccount;
  return snap && typeof snap === 'object' ? snap : null;
}

/** All CDM deposits on a payment (supports legacy single-CDM fields). */
export function getPaymentCdmDeposits(p) {
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.cdmDeposits) && p.cdmDeposits.length > 0) {
    return p.cdmDeposits
      .map((d) => ({
        id: String(d?.id ?? '').trim() || '_legacy',
        amount: Math.max(0, Number(d?.amount) || 0),
        cdmNumber: String(d?.cdmNumber ?? '').trim(),
        bankAccountId: String(d?.bankAccountId ?? d?.cdmBankAccountId ?? '').trim(),
        bankAccount: bankSnapFromLine(d),
      }))
      .filter((d) => d.amount > 0);
  }
  const amount = Math.max(0, Number(p.cdmAmount) || 0);
  if (amount <= 0) return [];
  return [
    {
      id: '_legacy',
      amount,
      cdmNumber: String(p.cdmNumber ?? '').trim(),
      bankAccountId: String(p.cdmBankAccountId ?? '').trim(),
      bankAccount: p.cdmBankAccount,
    },
  ];
}

/** All online transfers on a payment (supports legacy single-transfer fields). */
export function getPaymentOnlineTransfers(p) {
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.onlineTransfers) && p.onlineTransfers.length > 0) {
    return p.onlineTransfers
      .map((t) => ({
        id: String(t?.id ?? '').trim() || '_legacy',
        amount: Math.max(0, Number(t?.amount) || 0),
        reference: String(t?.reference ?? t?.onlineTransferReference ?? '').trim(),
        bankAccountId: String(t?.bankAccountId ?? t?.onlineTransferBankAccountId ?? '').trim(),
        bankAccount: bankSnapFromLine(t),
      }))
      .filter((t) => t.amount > 0);
  }
  const amount = Math.max(0, Number(p.onlineTransferAmount) || 0);
  if (amount <= 0) return [];
  return [
    {
      id: '_legacy',
      amount,
      reference: String(p.onlineTransferReference ?? '').trim(),
      bankAccountId: String(p.onlineTransferBankAccountId ?? '').trim(),
      bankAccount: p.onlineTransferBankAccount,
    },
  ];
}

export function cdmPortion(p) {
  const fromArray = getPaymentCdmDeposits(p).reduce((s, d) => s + d.amount, 0);
  if (fromArray > 0) return fromArray;
  return Math.max(0, Number(p?.cdmAmount) || 0);
}

export function onlineTransferPortion(p) {
  const fromArray = getPaymentOnlineTransfers(p).reduce((s, t) => s + t.amount, 0);
  if (fromArray > 0) return fromArray;
  return Math.max(0, Number(p?.onlineTransferAmount) || 0);
}

/** Flat rows for bank / reports tables. */
export function buildChequeTableRows(payments, mapRow) {
  const rows = [];
  for (const p of payments) {
    const cheques = getPaymentCheques(p);
    if (cheques.length === 0) continue;
    for (const c of cheques) {
      const row = mapRow(p, c, {
        rowKey: cheques.length > 1 ? `${p.id}::${c.id}` : p.id,
        amount: c.amount,
        chequeDate: c.chequeDate,
        chequeNumber: c.chequeNumber || '—',
        chequeDeposited: c.chequeDeposited,
        chequeDepositedAt: c.chequeDepositedAt,
        chequeDepositedBy: c.chequeDepositedBy,
        chequeReturned: c.chequeReturned,
      });
      if (row != null) rows.push(row);
    }
  }
  return rows;
}

export function depositQueueRowKey(row) {
  if (row.chequeId && row.chequeId !== '_legacy') return `${row.id}::${row.chequeId}`;
  return row.id;
}

export function buildCustomerChequeRows(payments, customerId) {
  const cid = String(customerId ?? '').trim();
  const filtered = (Array.isArray(payments) ? payments : []).filter(
    (p) => String(p.customerId ?? '').trim() === cid,
  );
  return buildChequeTableRows(filtered, (p, c, flat) => ({
    rowKey: `${p.id}::${c.id}`,
    paymentId: p.id,
    chequeId: c.id,
    paymentDate: String(p.date ?? '').slice(0, 10),
    billNumber: p.billNumber != null ? String(p.billNumber) : '—',
    chequeNumber: flat.chequeNumber,
    chequeDate: flat.chequeDate,
    amount: flat.amount,
    chequeDeposited: flat.chequeDeposited,
    chequeDepositedAt: flat.chequeDepositedAt,
    chequeDepositedBy: flat.chequeDepositedBy,
    chequeReturned: flat.chequeReturned,
    chequeReturnedAt: flat.chequeReturnedAt,
    chequeReturnedBy: flat.chequeReturnedBy,
    sortAt: p.createdAt || `${p.date}T12:00:00`,
  })).sort((a, b) => {
    const d = String(b.chequeDate || '').localeCompare(String(a.chequeDate || ''));
    if (d !== 0) return d;
    return String(b.sortAt || '').localeCompare(String(a.sortAt || ''));
  });
}

export function chequeStatusBucket(row) {
  if (row.chequeReturned) return 'returned';
  if (row.chequeDeposited) return 'deposited';
  return 'pending';
}
