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

function sumPoPendingForDistributor(outgoingCheques, distributorId, asOfDate) {
  const distId = String(distributorId ?? '').trim();
  if (!distId) return { total: 0, count: 0 };
  let total = 0;
  let count = 0;
  for (const row of Array.isArray(outgoingCheques) ? outgoingCheques : []) {
    if (String(row.distributorId ?? '').trim() !== distId) continue;
    const converting = String(row.chequeDate ?? '').slice(0, 10);
    if (converting && converting <= asOfDate) continue;
    const amount = Math.max(0, Number(row.amount) || 0);
    if (amount <= 0) continue;
    total += amount;
    count += 1;
  }
  return { total, count };
}

function buildDistributorGuaranteeStatus({
  distributorId,
  distributorName,
  guarantees,
  poPendingOutgoing,
  poPendingCount,
}) {
  const totalGuarantee = (Array.isArray(guarantees) ? guarantees : []).reduce(
    (sum, g) => sum + Math.max(0, Number(g.amount) || 0),
    0,
  );
  const pendingTotal = Math.max(0, Number(poPendingOutgoing) || 0);
  const available = Math.max(0, totalGuarantee - pendingTotal);
  const utilizationPct =
    totalGuarantee > 0 ? Math.min(100, Math.round((pendingTotal / totalGuarantee) * 1000) / 10) : 0;
  const overLimit = totalGuarantee > 0 && pendingTotal > totalGuarantee;

  return {
    distributorId,
    distributorName,
    totalGuarantee,
    pendingTotal,
    poPendingOutgoingTotal: pendingTotal,
    poPendingCount: Math.max(0, Number(poPendingCount) || 0),
    available,
    utilizationPct,
    overLimit,
    hasGuarantee: totalGuarantee > 0,
  };
}

/** Per-distributor guarantee vs PO outgoing cheques not yet converted. */
export function computeGuaranteeStatusByDistributor(guarantees, { outgoingCheques = [], asOfDate = '' } = {}) {
  const asOf = String(asOfDate ?? '').slice(0, 10);
  const byDistributor = new Map();

  for (const g of Array.isArray(guarantees) ? guarantees : []) {
    const distributorId = String(g.distributorId ?? '').trim();
    if (!distributorId) continue;
    const distributorName = String(g.distributorName ?? '').trim() || distributorId;
    if (!byDistributor.has(distributorId)) {
      byDistributor.set(distributorId, { distributorId, distributorName, guarantees: [] });
    }
    byDistributor.get(distributorId).guarantees.push(g);
  }

  for (const row of Array.isArray(outgoingCheques) ? outgoingCheques : []) {
    const distributorId = String(row.distributorId ?? '').trim();
    if (!distributorId || byDistributor.has(distributorId)) continue;
    const distributorName = String(row.distributorName ?? '').trim() || distributorId;
    byDistributor.set(distributorId, { distributorId, distributorName, guarantees: [] });
  }

  const statuses = [];
  for (const { distributorId, distributorName, guarantees: distGuarantees } of byDistributor.values()) {
    const { total, count } = sumPoPendingForDistributor(outgoingCheques, distributorId, asOf);
    statuses.push(
      buildDistributorGuaranteeStatus({
        distributorId,
        distributorName,
        guarantees: distGuarantees,
        poPendingOutgoing: total,
        poPendingCount: count,
      }),
    );
  }

  statuses.sort((a, b) => a.distributorName.localeCompare(b.distributorName));
  return statuses;
}

export function summarizeGuaranteesByDistributor(guarantees) {
  const byDistributor = new Map();
  for (const g of Array.isArray(guarantees) ? guarantees : []) {
    const distributorId = String(g.distributorId ?? '').trim();
    const key = distributorId || '__unassigned__';
    const distributorName = distributorId
      ? String(g.distributorName ?? '').trim() || distributorId
      : 'Unassigned';
    if (!byDistributor.has(key)) {
      byDistributor.set(key, { distributorId: distributorId || null, distributorName, total: 0, count: 0 });
    }
    const row = byDistributor.get(key);
    row.total += Math.max(0, Number(g.amount) || 0);
    row.count += 1;
  }
  return [...byDistributor.values()].sort((a, b) => {
    if (a.distributorId == null) return 1;
    if (b.distributorId == null) return -1;
    return a.distributorName.localeCompare(b.distributorName);
  });
}
