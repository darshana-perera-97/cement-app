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
        chequeDeposited: !!c?.chequeDeposited,
        chequeDepositedAt: String(c?.chequeDepositedAt ?? '').trim(),
        chequeDepositedBy: String(c?.chequeDepositedBy ?? '').trim(),
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
    },
  ];
}

export function chequePortion(p) {
  const fromArray = getPaymentCheques(p).reduce((s, c) => s + c.amount, 0);
  if (fromArray > 0) return fromArray;
  return Math.max(0, Number(p.chequeAmount) || 0);
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
