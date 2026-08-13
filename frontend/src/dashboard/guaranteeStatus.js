import { buildChequeTableRows, depositQueueRowKey } from './paymentCheques';

export const GUARANTEE_RENEWAL_WARN_DAYS = 30;

function toNonNegMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** Unique PO outgoing cheques (shared batch cheques counted once). Mirrors backend bankAccountBalance.js. */
export function collectPurchaseOrderOutgoingCheques(purchaseOrders) {
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
      const amount = toNonNegMoney(c.amount);
      if (!bankAccountId || amount <= 0) continue;
      const chequeNumber = String(c.chequeNumber ?? '').trim();
      const chequeDate = String(c.chequeDate ?? '').trim().slice(0, 10);
      const dedupeKey =
        mode === 'shared' && batchId
          ? `shared:${batchId}:${chequeNumber}:${chequeDate}:${amount}:${bankAccountId}`
          : `po:${poId}:${i}:${chequeNumber}:${chequeDate}:${amount}:${bankAccountId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const distributorId = String(po.distributorId ?? '').trim();
      const distributorName = String(po.distributorName ?? '').trim();
      rows.push({
        bankAccountId,
        amount,
        chequeNumber,
        chequeDate,
        poId,
        batchId: batchId || undefined,
        product: String(po.product ?? '').trim() || undefined,
        source: 'purchase_order',
        ...(distributorId ? { distributorId } : {}),
        ...(distributorName ? { distributorName } : {}),
      });
    }
  }
  return rows;
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetweenYmd(fromYmd, toYmd) {
  const from = String(fromYmd ?? '').slice(0, 10);
  const to = String(toYmd ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const t0 = new Date(
    parseInt(from.slice(0, 4), 10),
    parseInt(from.slice(5, 7), 10) - 1,
    parseInt(from.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(to.slice(0, 4), 10),
    parseInt(to.slice(5, 7), 10) - 1,
    parseInt(to.slice(8, 10), 10),
  ).getTime();
  return Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
}

/** Expiry status for a single guarantee expire date. */
export function getGuaranteeExpiryStatus(expireDate, asOfDate = '', { warnDays = GUARANTEE_RENEWAL_WARN_DAYS } = {}) {
  const exp = String(expireDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
    return { status: 'none', expireDate: '', daysUntil: null };
  }
  const asOf = String(asOfDate ?? '').slice(0, 10) || todayYmdLocal();
  const daysUntil = daysBetweenYmd(asOf, exp);
  if (daysUntil == null) return { status: 'none', expireDate: exp, daysUntil: null };
  if (daysUntil < 0) return { status: 'expired', expireDate: exp, daysUntil };
  if (daysUntil <= warnDays) return { status: 'near', expireDate: exp, daysUntil };
  return { status: 'ok', expireDate: exp, daysUntil };
}

function summarizeGuaranteeExpiries(guarantees, asOfDate) {
  let nearest = null;
  let expiringSoonCount = 0;
  let expiredCount = 0;
  let withExpiryCount = 0;

  for (const g of Array.isArray(guarantees) ? guarantees : []) {
    const info = getGuaranteeExpiryStatus(g.expireDate, asOfDate);
    if (info.status === 'none') continue;
    withExpiryCount += 1;
    if (info.status === 'expired') expiredCount += 1;
    if (info.status === 'near' || info.status === 'expired') expiringSoonCount += 1;
    if (!nearest || info.daysUntil < nearest.daysUntil) nearest = info;
  }

  return {
    nearestExpiry: nearest,
    expiringSoonCount,
    expiredCount,
    withExpiryCount,
    hasExpiryWarning: expiringSoonCount > 0,
  };
}

export function formatGuaranteeExpiryHint(expiryInfo) {
  if (!expiryInfo || expiryInfo.status === 'none') return '';
  const { status, expireDate, daysUntil } = expiryInfo;
  if (status === 'expired') {
    const daysAgo = Math.abs(daysUntil);
    return daysAgo === 0 ? `Expired ${expireDate}` : `Expired ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago (${expireDate})`;
  }
  if (status === 'near') {
    return daysUntil === 0
      ? `Expires today (${expireDate})`
      : `Expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'} (${expireDate})`;
  }
  return `Expires ${expireDate}`;
}

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
  { poPendingOutgoing = 0, poPendingCount = 0, asOfDate = '' } = {},
) {
  const totalGuarantee = (Array.isArray(guarantees) ? guarantees : []).reduce(
    (sum, g) => sum + Math.max(0, Number(g.amount) || 0),
    0,
  );
  const { pendingTotal: incomingPending, completedTotal, pendingRows } = buildGuaranteeChequeMetrics(payments);
  const pendingTotal = incomingPending + Math.max(0, Number(poPendingOutgoing) || 0);
  const available = totalGuarantee - pendingTotal;
  const utilizationPct =
    totalGuarantee > 0 ? Math.min(100, Math.round((pendingTotal / totalGuarantee) * 1000) / 10) : 0;
  const overLimit = totalGuarantee > 0 && pendingTotal > totalGuarantee;
  const pendingChequeCount = pendingRows.length + Math.max(0, Number(poPendingCount) || 0);
  const expirySummary = summarizeGuaranteeExpiries(guarantees, asOfDate);

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
    ...expirySummary,
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
    const rowDistId = String(row.distributorId ?? '').trim() || '__unassigned__';
    if (rowDistId !== distId) continue;
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
  asOfDate,
}) {
  const totalGuarantee = (Array.isArray(guarantees) ? guarantees : []).reduce(
    (sum, g) => sum + Math.max(0, Number(g.amount) || 0),
    0,
  );
  const pendingTotal = Math.max(0, Number(poPendingOutgoing) || 0);
  const available = totalGuarantee - pendingTotal;
  const utilizationPct =
    totalGuarantee > 0 ? Math.min(100, Math.round((pendingTotal / totalGuarantee) * 1000) / 10) : 0;
  const overLimit = totalGuarantee > 0 && pendingTotal > totalGuarantee;
  const expirySummary = summarizeGuaranteeExpiries(guarantees, asOfDate);

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
    ...expirySummary,
  };
}

/** Per-distributor guarantee vs PO outgoing cheques not yet converted. */
export function computeGuaranteeStatusByDistributor(guarantees, { outgoingCheques = [], asOfDate = '' } = {}) {
  const asOf = String(asOfDate ?? '').slice(0, 10);
  const byDistributor = new Map();

  for (const g of Array.isArray(guarantees) ? guarantees : []) {
    const rawId = String(g.distributorId ?? '').trim();
    const distributorId = rawId || '__unassigned__';
    const distributorName = rawId
      ? String(g.distributorName ?? '').trim() || rawId
      : 'Unassigned';
    if (!byDistributor.has(distributorId)) {
      byDistributor.set(distributorId, { distributorId, distributorName, guarantees: [] });
    }
    byDistributor.get(distributorId).guarantees.push(g);
  }

  for (const row of Array.isArray(outgoingCheques) ? outgoingCheques : []) {
    const rawId = String(row.distributorId ?? '').trim();
    const distributorId = rawId || '__unassigned__';
    if (byDistributor.has(distributorId)) continue;
    const distributorName = rawId ? String(row.distributorName ?? '').trim() || rawId : 'Unassigned';
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
        asOfDate: asOf,
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
