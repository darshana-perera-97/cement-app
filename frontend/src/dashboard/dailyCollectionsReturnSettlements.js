function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function sumAmounts(rows) {
  return round2((rows || []).reduce((sum, row) => sum + (Number(row?.amount) || 0), 0));
}

export function chequeNumberWithBank(row) {
  const bank = String(row?.chequeBank ?? '').trim();
  const num = String(row?.chequeNumber ?? '').trim();
  const chequeNo = !num || num === '—' ? '' : num.replace(/^#/, '');
  if (bank && chequeNo) return `${bank} ${chequeNo}`;
  if (chequeNo) return chequeNo;
  if (bank) return bank;
  return '—';
}

/** True when every invoice label on the row is a return-cheque settlement. */
export function isReturnChequeSettlementLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '—') return false;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^return cheque\b/i.test(part));
}

function detailBits(parts) {
  const bits = (parts || []).map((part) => String(part ?? '').trim()).filter((part) => part && part !== '—');
  return bits.join(' · ') || '—';
}

export function cashInvoicesExcludingReturnSettlements(label) {
  const parts = String(label ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part !== '—' && !/^return cheque\b/i.test(part));
  return parts.join(', ') || '—';
}

export function withoutReturnChequeSettlements(rows) {
  return (rows || []).filter(
    (row) => row?.isReturnDeduction || !isReturnChequeSettlementLabel(row?.invoiceNumber),
  );
}

/**
 * Payments that only settle returned cheques, taken out of the method lists.
 * Bounce deductions stay with the cheque list.
 */
export function collectReturnChequeSettlementRows({
  cashRows = [],
  chequeRows = [],
  cdmRows = [],
  bankTransferRows = [],
} = {}) {
  const out = [];
  for (const row of cashRows) {
    if (!isReturnChequeSettlementLabel(row?.invoiceNumber)) continue;
    out.push({
      customerName: row.customerName,
      returnCheque: row.invoiceNumber,
      method: 'Cash',
      reference: '—',
      amount: Number(row.amount) || 0,
      recordedBy: row.recordedBy,
    });
  }
  for (const row of chequeRows) {
    if (row?.isReturnDeduction || !isReturnChequeSettlementLabel(row?.invoiceNumber)) continue;
    out.push({
      customerName: row.customerName,
      returnCheque: row.invoiceNumber,
      method: 'Cheque',
      reference: detailBits([chequeNumberWithBank(row), row.chequeDate]),
      amount: Number(row.amount) || 0,
      recordedBy: row.recordedBy,
    });
  }
  for (const row of cdmRows) {
    if (!isReturnChequeSettlementLabel(row?.invoiceNumber)) continue;
    out.push({
      customerName: row.customerName,
      returnCheque: row.invoiceNumber,
      method: 'CDM deposit',
      reference: detailBits([row.cdmNumber, row.cdmDate, row.bankAccount]),
      amount: Number(row.amount) || 0,
      recordedBy: row.recordedBy,
    });
  }
  for (const row of bankTransferRows) {
    if (!isReturnChequeSettlementLabel(row?.invoiceNumber)) continue;
    out.push({
      customerName: row.customerName,
      returnCheque: row.invoiceNumber,
      method: 'Bank transfer',
      reference: detailBits([row.reference, row.transferDate, row.bankAccount]),
      amount: Number(row.amount) || 0,
      recordedBy: row.recordedBy,
    });
  }
  const methodOrder = { Cash: 0, Cheque: 1, 'CDM deposit': 2, 'Bank transfer': 3 };
  out.sort((a, b) => {
    const byShop = String(a.customerName || '').localeCompare(String(b.customerName || ''));
    if (byShop !== 0) return byShop;
    const byMethod = (methodOrder[a.method] ?? 9) - (methodOrder[b.method] ?? 9);
    if (byMethod !== 0) return byMethod;
    return String(a.returnCheque || '').localeCompare(String(b.returnCheque || ''));
  });
  return out;
}
