import { poLineItems } from './poItems';

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Converting / clearing date, moved forward when the cheque is on hold. */
export function effectivePoChequeDate(c) {
  const stored = String(c?.chequeDate ?? '').trim().slice(0, 10);
  if (String(c?.chequeAction ?? '').trim() === 'hold') {
    const hold = String(c?.holdUntil ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(hold)) return hold;
  }
  return stored;
}

/** Issued purchase cheque that can still be held, returned, or settled. */
export function canActOnIssuedPoCheque(c) {
  if (!c || typeof c !== 'object') return false;
  if (c.cancelled || c.chequeReturned) return false;
  if (isPoCashPayment(c) || isPoBankTransferPayment(c)) return false;
  if (!String(c.chequeNumber ?? '').trim()) return false;
  if (!String(c.bankAccountId ?? '').trim()) return false;
  if (!(Number(c.amount) > 0)) return false;
  return true;
}

export function poChequeDispositionLabel(c) {
  const action = String(c?.chequeAction ?? '').trim();
  if (action === 'hold') {
    const hold = String(c?.holdUntil ?? '').trim().slice(0, 10);
    return hold ? `Held until ${hold}` : 'On hold';
  }
  if (c?.chequeReturned || action === 'return' || action === 'settle_today') {
    const method = String(c?.settlementMethod ?? '').trim();
    const how =
      method === 'cash'
        ? 'cash'
        : method === 'bank_transfer'
          ? 'bank transfer'
          : method === 'cheque'
            ? c.settlementChequeNumber
              ? `cheque #${c.settlementChequeNumber}`
              : 'another cheque'
            : '';
    const verb = action === 'settle_today' ? 'Settled today' : 'Returned';
    return how ? `${verb} · ${how}` : verb;
  }
  return '';
}

/** PO outgoing cheques — deduped like backend bank balance. */
export function collectPoOutgoingCheques(purchaseOrders) {
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
      if (isPoCashPayment(c)) continue;
      const bankAccountId = String(c.bankAccountId ?? '').trim();
      const amount = Math.max(0, Number(c.amount) || 0);
      if (!bankAccountId || amount <= 0) continue;
      const paymentType = isPoBankTransferPayment(c) ? 'bank_transfer' : 'cheque';
      const chequeNumber = String(c.chequeNumber ?? '').trim();
      const sourceChequeDate = String(c.chequeDate ?? '').trim().slice(0, 10);
      const chequeDate = effectivePoChequeDate(c);
      const dedupeKey =
        mode === 'shared' && batchId
          ? `shared:${batchId}:${paymentType}:${chequeNumber}:${sourceChequeDate}:${amount}:${bankAccountId}`
          : `po:${poId}:${i}:${paymentType}:${chequeNumber}:${sourceChequeDate}:${amount}:${bankAccountId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        bankAccountId,
        amount,
        paymentType,
        chequeNumber,
        chequeDate,
        sourceChequeDate,
        chequeAction: String(c.chequeAction ?? '').trim(),
        holdUntil: String(c.holdUntil ?? '').trim().slice(0, 10),
        bankAccount: c.bankAccount,
        poId,
        poNumber: String(po.poNumber ?? '').trim(),
        product: poLineItems(po)
          .map((item) => item.product)
          .filter(Boolean)
          .join(', ') || '—',
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
      rowKey: `po:${c.poId}:${c.paymentType || 'cheque'}:${c.chequeNumber}:${c.sourceChequeDate || converting}:${c.bankAccountId}`,
      poId: c.poId,
      poNumber: c.poNumber || '',
      product: c.product,
      distributorName: c.distributorName,
      paymentType: c.paymentType || 'cheque',
      chequeNumber: c.chequeNumber || (c.paymentType === 'bank_transfer' ? 'Bank transfer' : '—'),
      chequeDate: converting || '—',
      sourceChequeDate: c.sourceChequeDate || converting,
      bankAccountId: c.bankAccountId,
      chequeAction: c.chequeAction || '',
      holdUntil: c.holdUntil || '',
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

export function isPoBankTransferPayment(c) {
  return String(c?.paymentType ?? '').trim().toLowerCase() === 'bank_transfer';
}

/** User-facing Door step note; stored "Door stock" still displays as Door step. */
export function doorStepNotesText(row) {
  const notes = String(row?.notes ?? '').trim();
  if (/^door stock$/i.test(notes) || (!notes && row?.doorStock)) return 'Door step';
  return notes;
}

/** e.g. "Commercial Bank · #123456" or "Cash" or "Commercial Bank · Bank transfer" */
export function formatPoChequeWithBank(c, bankAccounts) {
  if (isPoCashPayment(c)) return 'Cash';
  const num = String(c?.chequeNumber ?? '').trim();
  const bank = poChequeBankLabel(c, bankAccounts);
  if (isPoBankTransferPayment(c)) {
    if (bank && num) return `${bank} · Bank transfer ${num}`;
    if (bank) return `${bank} · Bank transfer`;
    if (num) return `Bank transfer ${num}`;
    return 'Bank transfer';
  }
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
