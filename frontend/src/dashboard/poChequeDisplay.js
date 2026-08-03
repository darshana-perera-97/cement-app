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
