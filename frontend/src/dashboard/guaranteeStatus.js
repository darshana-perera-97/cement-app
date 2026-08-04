import { buildChequeTableRows, depositQueueRowKey } from './paymentCheques';

/** Pending vs deposited customer cheques for bank guarantee tracking. */
export function buildGuaranteeChequeMetrics(payments) {
  let pendingTotal = 0;
  let completedTotal = 0;
  const pendingRows = [];

  buildChequeTableRows(payments, (p, c, flat) => {
    if (c.chequeReturned) return null;
    if (c.chequeDeposited) {
      completedTotal += flat.amount;
      return null;
    }
    pendingTotal += flat.amount;
    pendingRows.push({
      id: p.id,
      chequeId: c.id,
      rowKey: depositQueueRowKey({ id: p.id, chequeId: c.id }),
      customerName: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
      chequeNumber: flat.chequeNumber,
      chequeDate: flat.chequeDate,
      amount: flat.amount,
    });
    return null;
  });

  pendingRows.sort((a, b) => {
    const d = String(a.chequeDate || '').localeCompare(String(b.chequeDate || ''));
    if (d !== 0) return d;
    return a.rowKey.localeCompare(b.rowKey);
  });

  return { pendingTotal, completedTotal, pendingRows };
}

export function computeGuaranteeStatus(
  guarantees,
  payments,
  { poPendingOutgoing = 0, poPendingCount = 0 } = {},
) {
  const totalGuarantee = (Array.isArray(guarantees) ? guarantees : []).reduce(
    (sum, g) => sum + Math.max(0, Number(g.amount) || 0),
    0,
  );
  const { pendingTotal: incomingPending, completedTotal, pendingRows } = buildGuaranteeChequeMetrics(payments);
  const pendingTotal = incomingPending + Math.max(0, Number(poPendingOutgoing) || 0);
  const available = Math.max(0, totalGuarantee - pendingTotal);
  const utilizationPct =
    totalGuarantee > 0 ? Math.min(100, Math.round((pendingTotal / totalGuarantee) * 1000) / 10) : 0;
  const overLimit = totalGuarantee > 0 && pendingTotal > totalGuarantee;
  const pendingChequeCount = pendingRows.length + Math.max(0, Number(poPendingCount) || 0);

  return {
    totalGuarantee,
    pendingTotal,
    incomingPendingTotal: incomingPending,
    poPendingOutgoingTotal: Math.max(0, Number(poPendingOutgoing) || 0),
    completedTotal,
    available,
    utilizationPct,
    overLimit,
    pendingRows,
    pendingChequeCount,
    hasGuarantee: totalGuarantee > 0,
  };
}

/** Whether a pending cheque can be issued (marked deposited) within guarantee capacity. */
export function canIssueChequeUnderGuarantee(row, status) {
  if (!status.hasGuarantee) return false;
  if (!row || row.amount <= 0) return false;
  if (status.overLimit) return true;
  let cumulative = status.poPendingOutgoingTotal || 0;
  for (const r of status.pendingRows) {
    cumulative += r.amount;
    if (r.rowKey === row.rowKey) {
      return cumulative <= status.totalGuarantee;
    }
  }
  return false;
}
