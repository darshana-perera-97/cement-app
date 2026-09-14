import { formatProductNameWithCode } from './brandTheme';

/** Product lines on a PO. Shared whole-order POs store `items`; older rows are one product. */
export function poLineItems(po) {
  if (!po || typeof po !== 'object') return [];
  if (Array.isArray(po.items) && po.items.length > 0) {
    return po.items
      .map((item) => ({
        product: String(item?.product ?? '').trim(),
        quantity: Number(item?.quantity) || 0,
        unitPrice: Number(item?.unitPrice) || 0,
        lineTotal:
          item?.lineTotal != null && item.lineTotal !== ''
            ? Number(item.lineTotal) || 0
            : (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0),
      }))
      .filter((item) => item.product);
  }
  const product = String(po.product ?? '').trim();
  if (!product) return [];
  return [
    {
      product,
      quantity: Number(po.quantity) || 0,
      unitPrice: Number(po.unitPrice) || 0,
      lineTotal: Number(po.lineTotal ?? po.totalAmount) || 0,
    },
  ];
}

export function poProductSummary(po) {
  const items = poLineItems(po);
  if (items.length === 0) return '—';
  return items.map((item) => formatProductNameWithCode(item.product) || item.product).join(', ');
}

export function poTotalQuantity(po) {
  return poLineItems(po).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

export function poTotalAmount(po) {
  const fromItems = poLineItems(po).reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0);
  if (fromItems > 0) return fromItems;
  return Number(po?.lineTotal ?? po?.totalAmount) || 0;
}

export function poSelectionIds(po) {
  if (Array.isArray(po?.groupedPoIds) && po.groupedPoIds.length > 0) {
    return po.groupedPoIds.map((id) => String(id).trim()).filter(Boolean);
  }
  const id = String(po?.id ?? '').trim();
  return id ? [id] : [];
}

/**
 * Show whole-order payment batches that were saved as one PO per product as a single row.
 * New shared POs already have `items` and are left as-is.
 */
export function groupSharedPurchaseOrders(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const batchMembers = new Map();
  for (const r of list) {
    if (String(r?.chequeMode ?? '').trim() !== 'shared') continue;
    if (Array.isArray(r.items) && r.items.length > 0) continue;
    const batchId = String(r.batchId ?? '').trim();
    if (!batchId) continue;
    if (!batchMembers.has(batchId)) batchMembers.set(batchId, []);
    batchMembers.get(batchId).push(r);
  }

  const used = new Set();
  const out = [];
  for (const r of list) {
    const id = String(r?.id ?? '').trim();
    if (id && used.has(id)) continue;
    const batchId = String(r?.batchId ?? '').trim();
    const members = batchId ? batchMembers.get(batchId) : null;
    if (members && members.length > 1) {
      for (const m of members) {
        const mid = String(m.id ?? '').trim();
        if (mid) used.add(mid);
      }
      out.push(combineSharedBatchPos(members));
      continue;
    }
    if (id) used.add(id);
    out.push(r);
  }
  return out;
}

function combineSharedBatchPos(members) {
  const sorted = [...members].sort((a, b) =>
    String(a.poNumber || '').localeCompare(String(b.poNumber || ''), undefined, { numeric: true }),
  );
  const first = sorted[0];
  const items = sorted.flatMap((p) => poLineItems(p));
  const quantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const totalAmount = items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0);
  return {
    ...first,
    items,
    quantity,
    lineTotal: totalAmount,
    totalAmount,
    product: items.map((item) => item.product).filter(Boolean).join(', '),
    groupedPoIds: sorted.map((p) => p.id).filter(Boolean),
    cancelled: sorted.every((p) => p.cancelled),
  };
}

/** Product lines for a PO PDF (own `items`, or older shared-batch siblings). */
export function pdfProductLines(po, allRows) {
  if (Array.isArray(po?.items) && po.items.length > 0) return poLineItems(po);
  const batchId = String(po?.batchId ?? '').trim();
  if (String(po?.chequeMode ?? '').trim() === 'shared' && batchId) {
    const list = (Array.isArray(allRows) ? allRows : []).filter((r) => {
      if (String(r.batchId ?? '').trim() !== batchId) return false;
      if (r.id === po.id) return true;
      return !r.cancelled;
    });
    if (!list.some((r) => r.id === po.id) && po) list.push(po);
    list.sort((a, b) =>
      String(a.poNumber || '').localeCompare(String(b.poNumber || ''), undefined, { numeric: true }),
    );
    const lines = list.flatMap((r) => poLineItems(r));
    if (lines.length > 0) return lines;
  }
  return poLineItems(po);
}
