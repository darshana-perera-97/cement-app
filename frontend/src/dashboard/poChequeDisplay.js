function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** PO outgoing cheques — deduped like backend bank balance. */
export function collectPoOutgoingCheques(purchaseOrders) {
  const seen = new Set();
  const rows = [];
  for (const po of Array.isArray(purchaseOrders) ? purchaseOrders : []) {
    const cheques = Array.isArray(po.cheques) ? po.cheques : [];
    const mode = String(po.chequeMode ?? '').trim();
    const batchId = String(po.batchId ?? '').trim();
    const poId = String(po.id ?? '').trim();
    for (let i = 0; i < cheques.length; i++) {
      const c = cheques[i];
      if (!c || typeof c !== 'object') continue;
      if (c.cancelled) continue;
      if (c.chequeReturned) continue;
      const bankAccountId = String(c.bankAccountId ?? '').trim();
      const amount = Math.max(0, Number(c.amount) || 0);
      if (!bankAccountId || amount <= 0) continue;
      const chequeNumber = String(c.chequeNumber ?? '').trim();
      const chequeDate = String(c.chequeDate ?? '').trim().slice(0, 10);
      const dedupeKey =
        mode === 'shared' && batchId
          ? `shared:${batchId}:${chequeNumber}:${chequeDate}:${amount}:${bankAccountId}`
          : `po:${poId}:${i}:${chequeNumber}:${chequeDate}:${amount}:${bankAccountId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        bankAccountId,
        amount,
        chequeNumber,
        chequeDate,
        bankAccount: c.bankAccount,
        poId,
        product: String(po.product ?? '').trim() || '—',
        distributorName: String(po.distributorName ?? '').trim() || '—',
        sortAt: po.createdAt || `${chequeDate}T12:00:00`,
      });
    }
  }
  return rows;
}

/** PO cheques not yet converted (converting date after asOf, or no date). */
export function buildPendingPoOutgoingRows(purchaseOrders, bankAccounts, asOf = todayYmdLocal()) {
  const rows = [];
  for (const c of collectPoOutgoingCheques(purchaseOrders)) {
    const converting = String(c.chequeDate ?? '').slice(0, 10);
    if (converting && converting <= asOf) continue;
    rows.push({
      rowKey: `po:${c.poId}:${c.chequeNumber}:${c.chequeDate}:${c.bankAccountId}`,
      poId: c.poId,
      product: c.product,
      distributorName: c.distributorName,
      chequeNumber: c.chequeNumber || '—',
      chequeDate: converting || '—',
      bankLabel: formatPoChequeWithBank(c, bankAccounts),
      amount: c.amount,
      sortAt: c.sortAt,
    });
  }
  rows.sort((a, b) => {
    const d = a.chequeDate.localeCompare(b.chequeDate);
    if (d !== 0) return d;
    return a.rowKey.localeCompare(b.rowKey);
  });
  return rows;
}

function bankNameLabel(account) {
  if (!account || typeof account !== 'object') return '';
  const bank = String(account.bank ?? '').trim();
  if (bank) return bank;
  return String(account.nickName ?? '').trim();
}

/** Resolve bank label from a PO cheque row (snapshot or account id lookup). */
export function poChequeBankLabel(c, bankAccounts) {
  const snap = c?.bankAccount;
  if (snap && typeof snap === 'object') {
    const label = bankNameLabel(snap);
    if (label) return label;
  }
  const id = String(c?.bankAccountId ?? '').trim();
  if (id && Array.isArray(bankAccounts)) {
    const a = bankAccounts.find((x) => x.id === id);
    if (a) return bankNameLabel(a);
  }
  return '';
}

export function isPoCashPayment(c) {
  return String(c?.paymentType ?? '').trim().toLowerCase() === 'cash';
}

/** e.g. "Commercial Bank · #123456" or "Cash" */
export function formatPoChequeWithBank(c, bankAccounts) {
  if (isPoCashPayment(c)) return 'Cash';
  const num = String(c?.chequeNumber ?? '').trim();
  const bank = poChequeBankLabel(c, bankAccounts);
  if (bank && num) return `${bank} · #${num}`;
  if (num) return `#${num}`;
  if (bank) return bank;
  return '—';
}

export function formatPoChequesList(cheques, bankAccounts) {
  const list = Array.isArray(cheques) ? cheques : [];
  if (list.length === 0) return '—';
  return list.map((c) => formatPoChequeWithBank(c, bankAccounts)).join(', ');
}
