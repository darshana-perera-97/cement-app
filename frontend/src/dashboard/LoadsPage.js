import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { canEditDetails, getUsername } from '../auth';
import { useBagProducts } from './BagProductsContext';
import { productToBrandKey } from './brandTheme';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  MobileRowCard,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTdMuted,
  stickyFirstThTransparent,
  stickyTheadTransparent,
  useTablePagination,
  modalPanelClass4xl,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import { formatPoChequeWithBank, formatPoChequesList } from './poChequeDisplay';

const apiBase = getApiBase();

const DEFAULT_MARGIN_PER_BAG = 70;

const emptyBrandFields = (brands) =>
  Object.fromEntries(
    brands.flatMap((b) => [
      [`${b.key}Bags`, ''],
      [`${b.key}Cost`, ''],
      [`${b.key}CutOffPrice`, ''],
      [`${b.key}Invoice`, ''],
      [`${b.key}Cheque`, ''],
      [`${b.key}ConvertingDate`, ''],
    ]),
  );

const emptyForm = (brands) => ({
  date: new Date().toISOString().slice(0, 10),
  stockId: '',
  vehicleNumber: '',
  transportCostPerBag: '',
  doorStockTransportCostPerBag: '',
  marginPerBag: String(DEFAULT_MARGIN_PER_BAG),
  ...emptyBrandFields(brands),
});

function formatAmount(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** Aggregate selected POs into per-brand bags / cost / cheque / converting date + vehicle. */
function aggregateFromPurchaseOrders(selectedPos, lastCutOffs, prevForm = {}, brands = []) {
  const brandAgg = {};
  for (const b of brands) {
    brandAgg[b.key] = { bags: 0, cost: 0, cheques: [], convertingDate: '' };
  }
  let vehicleNumber = '';
  for (const po of selectedPos) {
    const key = productToBrandKey(po.product, brands);
    if (!key || !brandAgg[key]) continue;
    brandAgg[key].bags += Number(po.quantity) || 0;
    brandAgg[key].cost += Number(po.lineTotal ?? po.totalAmount) || 0;
    const cheques = Array.isArray(po.cheques) ? po.cheques : [];
    for (const c of cheques) {
      const label = formatPoChequeWithBank(c);
      if (label && label !== '—' && !brandAgg[key].cheques.includes(label)) {
        brandAgg[key].cheques.push(label);
      }
      const conv = String(c.chequeDate || '').trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(conv) && !brandAgg[key].convertingDate) {
        brandAgg[key].convertingDate = conv;
      }
    }
    if (!vehicleNumber) {
      vehicleNumber = String(po.vehicleNumber || '').trim();
    }
  }

  const activeKeys = brands.map((b) => b.key).filter((k) => brandAgg[k].bags > 0 || brandAgg[k].cost > 0);
  const next = { ...emptyBrandFields(brands) };
  for (const key of activeKeys) {
    const agg = brandAgg[key];
    next[`${key}Bags`] = formatAmount(agg.bags) || String(agg.bags || '');
    next[`${key}Cost`] = formatAmount(agg.cost);
    next[`${key}Cheque`] = agg.cheques.join(', ');
    const prevCut = String(prevForm[`${key}CutOffPrice`] ?? '').trim();
    const last = lastCutOffs && lastCutOffs[key] != null ? lastCutOffs[key] : null;
    next[`${key}CutOffPrice`] = prevCut || (last != null ? formatAmount(last) : '');
    next[`${key}Invoice`] = String(prevForm[`${key}Invoice`] ?? '');
    const prevConv = String(prevForm[`${key}ConvertingDate`] ?? '').trim();
    next[`${key}ConvertingDate`] = agg.convertingDate || prevConv || '';
  }
  return { fields: next, activeKeys, vehicleNumber };
}

/** Next ID after the highest existing STK-nnnn (or plain number); defaults to STK-0001. */
function nextSuggestedStockId(records) {
  let max = 0;
  for (const r of records) {
    const raw = String(r.stockId ?? '').trim();
    if (!raw) continue;
    const m = /^STK-(\d+)$/i.exec(raw);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
      continue;
    }
    if (/^\d+$/.test(raw)) {
      max = Math.max(max, parseInt(raw, 10));
    }
  }
  const next = max + 1;
  return `STK-${String(next).padStart(4, '0')}`;
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

/** Bags ≥ 1 means invoice + cheque must be filled for that brand (any letters/digits in those fields). */
function brandNeedsInvoiceCheque(bagsValue) {
  const n = Number(bagsValue);
  return Number.isFinite(n) && n >= 1;
}

function formFromLoad(row, brands) {
  const f = {
    date: String(row.date ?? '').slice(0, 10),
    stockId: String(row.stockId ?? ''),
    vehicleNumber: String(row.vehicleNumber ?? '').trim(),
    transportCostPerBag: String(row.transportCostPerBag ?? ''),
    doorStockTransportCostPerBag: String(row.doorStockTransportCostPerBag ?? ''),
    marginPerBag: String(row.marginPerBag ?? DEFAULT_MARGIN_PER_BAG),
    ...emptyBrandFields(brands),
  };
  for (const b of brands) {
    f[`${b.key}Bags`] = String(row[`${b.key}Bags`] ?? '');
    f[`${b.key}Cost`] = String(row[`${b.key}Cost`] ?? '');
    f[`${b.key}CutOffPrice`] = String(row[`${b.key}CutOffPrice`] ?? '');
    f[`${b.key}Invoice`] = String(row[`${b.key}Invoice`] ?? '');
    f[`${b.key}Cheque`] = String(row[`${b.key}Cheque`] ?? '');
    f[`${b.key}ConvertingDate`] = String(row[`${b.key}ConvertingDate`] ?? '').slice(0, 10);
  }
  return f;
}

export default function LoadsPage() {
  const { brands } = useBagProducts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(() => emptyForm([]));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detailRow, setDetailRow] = useState(null);
  const [editingLoadId, setEditingLoadId] = useState('');
  const [lorryNumbers, setLorryNumbers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [lastCutOffPrices, setLastCutOffPrices] = useState({});
  const [selectedPoIds, setSelectedPoIds] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/stocks`);
      if (!res.ok) throw new Error('Failed to load stocks');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLorries = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/lorries`);
      if (!res.ok) throw new Error('Failed to load lorries');
      const data = await res.json();
      const numbers = (Array.isArray(data) ? data : [])
        .map((l) => String(l.number ?? '').trim())
        .filter(Boolean);
      setLorryNumbers(numbers);
    } catch {
      setLorryNumbers([]);
    }
  }, []);

  const loadPurchaseOrders = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/purchase-orders`);
      if (!res.ok) throw new Error('Failed to load purchase orders');
      const data = await res.json();
      setPurchaseOrders(Array.isArray(data) ? data : []);
    } catch {
      setPurchaseOrders([]);
    }
  }, []);

  const loadLastCutOffPrices = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/stocks/last-cut-off-prices`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setLastCutOffPrices(data.prices && typeof data.prices === 'object' ? data.prices : {});
    } catch {
      setLastCutOffPrices({});
    }
  }, []);

  useEffect(() => {
    load();
    loadLorries();
  }, [load, loadLorries]);

  // Fill empty cut-off fields once last prices arrive (e.g. after PO selection).
  useEffect(() => {
    if (!modalOpen || Object.keys(lastCutOffPrices).length === 0) return;
    setForm((f) => {
      let changed = false;
      const next = { ...f };
      for (const b of brands) {
        const hasBrand =
          brandNeedsInvoiceCheque(next[`${b.key}Bags`]) || Number(next[`${b.key}Cost`]) > 0;
        if (!hasBrand) continue;
        if (String(next[`${b.key}CutOffPrice`] ?? '').trim()) continue;
        const last = lastCutOffPrices[b.key];
        if (last == null) continue;
        next[`${b.key}CutOffPrice`] = formatAmount(last);
        changed = true;
      }
      return changed ? next : f;
    });
  }, [lastCutOffPrices, modalOpen, brands]);

  const usedPoIds = useMemo(() => {
    const used = new Set();
    for (const row of rows) {
      if (editingLoadId && row.id === editingLoadId) continue;
      const ids = Array.isArray(row.purchaseOrderIds) ? row.purchaseOrderIds : [];
      for (const id of ids) {
        const sid = String(id || '').trim();
        if (sid) used.add(sid);
      }
    }
    return used;
  }, [rows, editingLoadId]);

  const selectablePurchaseOrders = useMemo(() => {
    return purchaseOrders
      .filter((po) => {
        if (po?.cancelled) return false;
        const id = String(po.id || '').trim();
        if (!id) return false;
        if (selectedPoIds.includes(id)) return true;
        return !usedPoIds.has(id);
      })
      .slice()
      .sort((a, b) => {
        const da = String(a.date || '');
        const db = String(b.date || '');
        if (da !== db) return db.localeCompare(da);
        return String(b.poNumber || '').localeCompare(String(a.poNumber || ''));
      });
  }, [purchaseOrders, usedPoIds, selectedPoIds]);

  const selectedPos = useMemo(() => {
    const set = new Set(selectedPoIds);
    return purchaseOrders.filter((po) => set.has(String(po.id)));
  }, [purchaseOrders, selectedPoIds]);

  const hasDoorStockPo = useMemo(() => selectedPos.some((po) => po.doorStock), [selectedPos]);

  const activeBrands = useMemo(() => {
    if (selectedPoIds.length > 0) {
      const keys = new Set();
      for (const po of selectedPos) {
        const key = productToBrandKey(po.product, brands);
        if (key) keys.add(key);
      }
      // Also include brands that still have bags in the form (after edits)
      for (const b of brands) {
        if (brandNeedsInvoiceCheque(form[`${b.key}Bags`]) || Number(form[`${b.key}Cost`]) > 0) {
          keys.add(b.key);
        }
      }
      return brands.filter((b) => keys.has(b.key));
    }
    // Edit without POs: show brands that already have data
    if (editingLoadId) {
      return brands.filter(
        (b) => brandNeedsInvoiceCheque(form[`${b.key}Bags`]) || Number(form[`${b.key}Cost`]) > 0,
      );
    }
    return [];
  }, [selectedPoIds, selectedPos, form, editingLoadId, brands]);

  const applyPosToForm = useCallback(
    (poIds, prevForm) => {
      const set = new Set(poIds);
      const selected = purchaseOrders.filter((po) => set.has(String(po.id)));
      const { fields, vehicleNumber } = aggregateFromPurchaseOrders(
        selected,
        lastCutOffPrices,
        prevForm,
        brands,
      );
      return {
        ...fields,
        vehicleNumber: vehicleNumber || String(prevForm.vehicleNumber || ''),
      };
    },
    [purchaseOrders, lastCutOffPrices, brands],
  );

  const vehicleSelectOptions = useMemo(() => {
    const current = String(form.vehicleNumber ?? '').trim();
    if (current && !lorryNumbers.includes(current)) {
      return [current, ...lorryNumbers];
    }
    return lorryNumbers;
  }, [lorryNumbers, form.vehicleNumber]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      const costParts = brands.map((b) => String(r[`${b.key}Cost`] ?? ''));
      const bagParts = brands.map((b) => String(r[`${b.key}Bags`] ?? ''));
      const invParts = brands.map((b) => String(r[`${b.key}Invoice`] ?? ''));
      const chqParts = brands.map((b) => String(r[`${b.key}Cheque`] ?? ''));
      return rowMatchesQuery(search, [
        r.date,
        r.stockId,
        r.vehicleNumber,
        r.addedBy,
        String(r.totalAmount ?? ''),
        ...bagParts,
        ...costParts,
        ...invParts,
        ...chqParts,
      ]);
    });
  }, [rows, search, dateFrom, dateTo, brands]);

  const filteredTotals = useMemo(() => {
    const t = { totalAmount: 0 };
    for (const b of brands) {
      t[`${b.key}Bags`] = 0;
      t[`${b.key}Cost`] = 0;
    }
    for (const r of filteredRows) {
      for (const b of brands) {
        t[`${b.key}Bags`] += Number(r[`${b.key}Bags`]) || 0;
        t[`${b.key}Cost`] += Number(r[`${b.key}Cost`]) || 0;
      }
      t.totalAmount += Number(r.totalAmount) || 0;
    }
    return t;
  }, [filteredRows, brands]);

  const pagination = useTablePagination(filteredRows.length, [search, dateFrom, dateTo]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openModal = () => {
    setEditingLoadId('');
    setSelectedPoIds([]);
    setForm({
      ...emptyForm(brands),
      stockId: nextSuggestedStockId(rows),
    });
    setSaveError(null);
    loadLorries();
    loadPurchaseOrders();
    loadLastCutOffPrices();
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSaveError(null);
    setEditingLoadId('');
    setSelectedPoIds([]);
  };

  const openEditModal = (row) => {
    if (!row || !row.id) return;
    setEditingLoadId(String(row.id));
    const linkedIds = Array.isArray(row.purchaseOrderIds)
      ? row.purchaseOrderIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    setSelectedPoIds(linkedIds);
    setForm(formFromLoad(row, brands));
    setSaveError(null);
    loadLorries();
    loadPurchaseOrders();
    loadLastCutOffPrices();
    setModalOpen(true);
  };

  const handleFormChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const togglePoSelection = (poId) => {
    const id = String(poId || '').trim();
    if (!id) return;
    setSelectedPoIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const nextHasDoorStock = purchaseOrders
        .filter((po) => next.includes(String(po.id)))
        .some((po) => po.doorStock);
      setForm((f) => {
        const applied = applyPosToForm(next, f);
        return {
          ...f,
          ...applied,
          // Keep date/stockId/incentive fields
          date: f.date,
          stockId: f.stockId,
          transportCostPerBag: nextHasDoorStock ? '' : f.transportCostPerBag,
          doorStockTransportCostPerBag: nextHasDoorStock ? f.doorStockTransportCostPerBag : '',
          marginPerBag: f.marginPerBag,
        };
      });
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    if (!editingLoadId && selectedPoIds.length === 0) {
      setSaveError('Select at least one purchase order.');
      return;
    }
    const missingRefs = [];
    for (const b of brands) {
      if (!brandNeedsInvoiceCheque(form[`${b.key}Bags`])) continue;
      const inv = String(form[`${b.key}Invoice`] ?? '').trim();
      const chq = String(form[`${b.key}Cheque`] ?? '').trim();
      if (!inv) missingRefs.push(`${b.label} invoice number`);
      if (!chq) missingRefs.push(`${b.label} cheque number`);
    }
    if (missingRefs.length > 0) {
      setSaveError(
        `When bags are 1 or more for a brand, invoice and cheque numbers are required. Missing: ${missingRefs.join(', ')}.`,
      );
      return;
    }
    const resolvedVehicle = String(form.vehicleNumber || '').trim();
    if (!resolvedVehicle) {
      setSaveError(
        lorryNumbers.length === 0
          ? 'Add a lorry under Shop → Lorries before recording a load.'
          : 'Select a lorry.',
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const isEditing = Boolean(editingLoadId);
      const res = await fetch(
        isEditing ? `${apiBase}/api/stocks/${encodeURIComponent(editingLoadId)}` : `${apiBase}/api/stocks`,
        {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing ? { updatedBy: username } : { addedBy: username }),
          date: form.date,
          stockId: form.stockId.trim(),
          vehicleNumber: resolvedVehicle,
          purchaseOrderIds: selectedPoIds,
          ...Object.fromEntries(
            brands.flatMap((b) => [
              [`${b.key}Bags`, form[`${b.key}Bags`]],
              [`${b.key}Cost`, form[`${b.key}Cost`]],
              [`${b.key}CutOffPrice`, form[`${b.key}CutOffPrice`]],
              [`${b.key}Invoice`, form[`${b.key}Invoice`]],
              [`${b.key}Cheque`, form[`${b.key}Cheque`]],
              [`${b.key}ConvertingDate`, form[`${b.key}ConvertingDate`]],
            ]),
          ),
          transportCostPerBag: hasDoorStockPo ? '' : form.transportCostPerBag,
          ...(hasDoorStockPo ? { doorStockTransportCostPerBag: form.doorStockTransportCostPerBag } : {}),
          marginPerBag: form.marginPerBag,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      await load();
      closeModal();
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Track stock loads, vehicles, bags, and costs per brand.</p>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
        >
          Add a Stock
        </button>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !loading && rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} load${rows.length === 1 ? '' : 's'}. Footer totals reflect the filtered rows.`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Stock ID, vehicle, invoice, cheque, bags, costs…"
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          From date
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          To date
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      <div className="space-y-3">
      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            No stock loads yet. Use &quot;Add a Stock&quot; to create a record.
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            No loads match your search or filters.
          </p>
        ) : (
          pagedRows.map((r) => {
            const brandBags = brands.map((b) => `${b.label}: ${r[`${b.key}Bags`] ?? 0}`).join(' · ');
            return (
              <MobileRowCard
                key={r.id}
                title={r.stockId || `Load #${r.id}`}
                subtitle={`${r.date} · ${r.vehicleNumber || '—'}`}
                onClick={() => setDetailRow(r)}
                fields={[
                  { label: 'Total', value: money(r.totalAmount) },
                  { label: 'Added by', value: r.addedBy || '—' },
                  { label: 'Bags by brand', value: brandBags },
                  {
                    label: brands.slice(0, 2).map((b) => b.label).join(' / ') || 'Bags',
                    value: brands.slice(0, 2).map((b) => r[`${b.key}Bags`] ?? 0).join(' / ') || '—',
                  },
                  ...(brands.length > 2
                    ? [
                        {
                          label: brands.slice(2, 4).map((b) => b.label).join(' / '),
                          value: brands.slice(2, 4).map((b) => r[`${b.key}Bags`] ?? 0).join(' / '),
                        },
                      ]
                    : []),
                ]}
              />
            );
          })
        )}
      </div>
      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[1680px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyTheadTransparent}>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th
                rowSpan={2}
                className={`whitespace-nowrap px-3 py-3 align-bottom ${stickyFirstThTransparent}`}
              >
                Date
              </th>
              <th rowSpan={2} className="whitespace-nowrap px-3 py-3 align-bottom">
                Stock ID
              </th>
              <th rowSpan={2} className="whitespace-nowrap px-3 py-3 align-bottom">
                Vehicle No.
              </th>
              {brands.map((b) => (
                <th
                  key={b.key}
                  colSpan={4}
                  className={`px-2 py-2 text-center font-bold tracking-wide ${b.ledger.head}`}
                >
                  {b.label}
                </th>
              ))}
              <th rowSpan={2} className="whitespace-nowrap border-l border-slate-100 px-3 py-3 align-bottom text-right">
                Total
              </th>
              <th rowSpan={2} className="whitespace-nowrap px-3 py-3 align-bottom">
                Added by
              </th>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] font-semibold uppercase text-slate-400">
              {brands.map((b) => (
                <Fragment key={b.key}>
                  <th className={`px-2 py-2 text-center ${b.ledger.sub}`}>Bags</th>
                  <th className={`px-2 py-2 text-center ${b.ledger.sub}`}>Cost</th>
                  <th className={`px-2 py-2 text-center ${b.ledger.sub}`}>Invoice</th>
                  <th className={`px-2 py-2 text-center ${b.ledger.sub}`}>Cheque</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={21} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={21} className="px-4 py-10 text-center text-slate-500">
                  No stock loads yet. Use &quot;Add a Stock&quot; to create a record.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={21} className="px-4 py-10 text-center text-slate-500">
                  No loads match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => {
                const rowLine = 'border-b border-slate-100/90';
                return (
                  <tr
                    key={r.id}
                    {...detailRowAttrs(() => setDetailRow(r))}
                    aria-label={`Load ${r.stockId ?? r.id ?? ''} details`}
                  >
                    <td
                      className={`whitespace-nowrap px-3 py-3 font-medium ${rowLine} bg-slate-50/70 text-slate-800 ${stickyFirstTdMuted}`}
                    >
                      {r.date}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 ${rowLine} bg-slate-50/70`}>{r.stockId}</td>
                    <td className={`whitespace-nowrap px-3 py-3 ${rowLine} bg-slate-50/70`}>
                      {r.vehicleNumber}
                    </td>
                    {brands.map((b) => {
                      const inv = String(r[`${b.key}Invoice`] ?? '').trim();
                      const chq = String(r[`${b.key}Cheque`] ?? '').trim();
                      return (
                        <Fragment key={b.key}>
                          <td
                            className={`px-2 py-3 text-center tabular-nums transition-colors hover:brightness-[0.98] ${rowLine} ${b.ledger.cellLead}`}
                          >
                            {r[`${b.key}Bags`] ?? 0}
                          </td>
                          <td
                            className={`px-2 py-3 text-right tabular-nums transition-colors hover:brightness-[0.98] ${rowLine} ${b.ledger.cell} text-slate-900`}
                          >
                            {money(r[`${b.key}Cost`])}
                          </td>
                          <td
                            className={`max-w-[7rem] truncate px-2 py-3 text-xs text-slate-700 ${rowLine} ${b.ledger.cell}`}
                            title={inv || undefined}
                          >
                            {inv || '—'}
                          </td>
                          <td
                            className={`max-w-[7rem] truncate px-2 py-3 text-xs text-slate-700 ${rowLine} ${b.ledger.cell}`}
                            title={chq || undefined}
                          >
                            {chq || '—'}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td
                      className={`border-l border-slate-100 px-3 py-3 text-right font-semibold text-slate-900 tabular-nums ${rowLine} bg-white`}
                    >
                      {money(r.totalAmount)}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 text-slate-600 ${rowLine} bg-white`}>
                      {r.addedBy}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && filteredRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
                <td colSpan={3} className={`bg-slate-100/80 px-3 py-3 ${stickyFirstTdMuted}`}>
                  Totals (filtered)
                </td>
                {brands.map((b) => (
                  <Fragment key={b.key}>
                    <td
                      className={`px-2 py-3 text-center tabular-nums ${b.ledger.cellLead} brightness-[1.02]`}
                    >
                      {filteredTotals[`${b.key}Bags`]}
                    </td>
                    <td className={`px-2 py-3 text-right tabular-nums text-slate-900 ${b.ledger.cell} brightness-[1.02]`}>
                      {money(filteredTotals[`${b.key}Cost`])}
                    </td>
                    <td className={`px-2 py-3 ${b.ledger.cell} brightness-[1.02]`} />
                    <td className={`px-2 py-3 ${b.ledger.cell} brightness-[1.02]`} />
                  </Fragment>
                ))}
                <td className="border-l border-slate-200 bg-indigo-50/60 px-3 py-3 text-right text-indigo-900 tabular-nums">
                  {money(filteredTotals.totalAmount)}
                </td>
                <td className="bg-slate-50/90 px-3 py-3" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {!loading && rows.length > 0 ? (
        <TablePaginationBar
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalCount={filteredRows.length}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      ) : null}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="loads-modal-title">
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={closeModal} />
          <div className={modalPanelClass4xl}>
            <h2 id="loads-modal-title" className="text-lg font-bold text-slate-900">
              {editingLoadId ? 'Edit stock load' : 'Add a stock load'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">Recorded as user: {getUsername() || '—'}</p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-600">
                  Date
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => handleFormChange('date', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Stock ID
                  <input
                    type="text"
                    required
                    value={form.stockId}
                    onChange={(e) => handleFormChange('stockId', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                    placeholder="STK-0001"
                    autoComplete="off"
                  />
                  <span className="mt-1 block text-xs font-normal text-slate-400">
                    Suggested next ID — you can edit before saving.
                  </span>
                </label>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Purchase orders
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Select one or more POs. Bags and cost are applied only to each PO&apos;s product.
                  Vehicle and cheque are filled from the selection (you can still edit them). Enter
                  invoice no. and cut-off price per product.
                </p>
                {selectablePurchaseOrders.length === 0 ? (
                  <p className="mt-3 text-sm text-amber-800">
                    No available purchase orders. Create POs under Purchase Order first
                    {usedPoIds.size > 0 ? ' (some may already be linked to other loads).' : '.'}
                  </p>
                ) : (
                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded-xl bg-white p-2 ring-1 ring-slate-200/80">
                    {selectablePurchaseOrders.map((po) => {
                      const id = String(po.id);
                      const checked = selectedPoIds.includes(id);
                      const productName = String(po.product || '').trim() || '—';
                      const brandKey = productToBrandKey(po.product, brands);
                      const brandLabel = brands.find((b) => b.key === brandKey)?.label;
                      const showMappedBrand =
                        brandLabel &&
                        brandLabel.trim().toLowerCase() !== productName.toLowerCase();
                      return (
                        <label
                          key={id}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 transition ${
                            checked ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePoSelection(id)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="min-w-0 flex-1 text-sm text-slate-800">
                            <span className="font-semibold tabular-nums">{po.poNumber || id}</span>
                            <span className="text-slate-400"> · </span>
                            <span className="tabular-nums text-slate-600">{po.date || '—'}</span>
                            <span className="mt-0.5 block text-xs font-normal text-slate-500">
                              {productName}
                              {showMappedBrand ? ` (${brandLabel})` : ''}
                              {' · '}
                              {Number(po.quantity) || 0} bags
                              {' · '}
                              {money(po.lineTotal ?? po.totalAmount)}
                              {Array.isArray(po.cheques) && po.cheques.length > 0 ? (
                                <>
                                  {' · '}
                                  {formatPoChequesList(po.cheques)}
                                </>
                              ) : null}
                              {po.doorStock ? (
                                <>
                                  {' · '}
                                  <span className="font-medium text-indigo-700">Door step</span>
                                </>
                              ) : null}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {selectedPoIds.length > 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {selectedPoIds.length} PO{selectedPoIds.length === 1 ? '' : 's'} selected
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="col-span-full block text-sm font-medium text-slate-600 sm:col-span-2">
                  Vehicle / lorry number
                  <select
                    required
                    value={form.vehicleNumber}
                    onChange={(e) => handleFormChange('vehicleNumber', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                    disabled={lorryNumbers.length === 0 && !form.vehicleNumber}
                  >
                    <option value="">
                      {lorryNumbers.length === 0 ? 'No lorries — add under Shop' : 'Select lorry…'}
                    </option>
                    {vehicleSelectOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-400">
                    Filled from selected PO when available — you can change it.
                  </span>
                </label>
              </div>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Incentive pricing</p>
                <p className="mt-1 text-xs text-slate-500">
                  Used on the Incentive page to calculate transport, margin, and unloading price per bag.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {!hasDoorStockPo ? (
                    <label className="block text-sm font-medium text-slate-600">
                      Transport cost per bag (LKR)
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.transportCostPerBag}
                        onChange={(e) => handleFormChange('transportCostPerBag', e.target.value)}
                        className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                        placeholder="0"
                      />
                    </label>
                  ) : null}
                  {hasDoorStockPo ? (
                    <label className="block text-sm font-medium text-slate-600">
                      Door step transport cost per bag (LKR)
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.doorStockTransportCostPerBag}
                        onChange={(e) => handleFormChange('doorStockTransportCostPerBag', e.target.value)}
                        className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                        placeholder="0"
                      />
                      <span className="mt-1 block text-xs font-normal text-slate-400">
                        Added to transport per bag for incentive calculations on door step POs.
                      </span>
                    </label>
                  ) : null}
                  <label className="block text-sm font-medium text-slate-600">
                    Margin per bag (LKR)
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.marginPerBag}
                      onChange={(e) => handleFormChange('marginPerBag', e.target.value)}
                      className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                    />
                    <span className="mt-1 block text-xs font-normal text-slate-400">Default {DEFAULT_MARGIN_PER_BAG} LKR</span>
                  </label>
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Cement bags, cost, invoice & cheque (per brand)
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Only the product(s) from the selected POs are shown. Bags, cost, cheque, and converting
                  date come from those POs and stay editable. Enter{' '}
                  <span className="font-medium text-slate-700">invoice no.</span> and{' '}
                  <span className="font-medium text-slate-700">cut-off price</span> (cut-off loads last
                  price when available).
                </p>
                {activeBrands.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    Select purchase orders above to load brand lines.
                  </p>
                ) : (
                  <div className="mt-3 space-y-4">
                    {activeBrands.map((b) => {
                      const needRefs = brandNeedsInvoiceCheque(form[`${b.key}Bags`]);
                      const refRing = needRefs ? 'ring-amber-200' : 'ring-slate-200';
                      const lastCut = lastCutOffPrices[b.key];
                      return (
                        <div
                          key={b.key}
                          className="rounded-lg border border-slate-100 bg-white/90 p-3 shadow-sm ring-1 ring-slate-100/80"
                        >
                          <p className="mb-2 text-sm font-semibold text-slate-800">{b.label}</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            <label className="text-xs text-slate-500">
                              Bags
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={form[`${b.key}Bags`]}
                                onChange={(e) => handleFormChange(`${b.key}Bags`, e.target.value)}
                                className="mt-0.5 w-full rounded-lg border-0 bg-slate-50 px-2 py-2 text-sm tabular-nums ring-1 ring-slate-200"
                              />
                            </label>
                            <label className="text-xs text-slate-500">
                              Cost (LKR)
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={form[`${b.key}Cost`]}
                                onChange={(e) => handleFormChange(`${b.key}Cost`, e.target.value)}
                                className="mt-0.5 w-full rounded-lg border-0 bg-slate-50 px-2 py-2 text-sm tabular-nums ring-1 ring-slate-200"
                              />
                            </label>
                            <label className={`block text-xs ${needRefs ? 'font-medium text-slate-700' : 'text-slate-500'}`}>
                              Cheque no.{needRefs ? ' *' : ''}
                              <input
                                type="text"
                                inputMode="text"
                                value={form[`${b.key}Cheque`]}
                                onChange={(e) => handleFormChange(`${b.key}Cheque`, e.target.value)}
                                className={`mt-0.5 w-full rounded-lg border-0 bg-slate-50 px-2 py-2 text-sm ring-1 ${refRing} focus:outline-none focus:ring-2 focus:ring-indigo-500/35`}
                                autoComplete="off"
                                spellCheck={false}
                                aria-required={needRefs}
                              />
                            </label>
                            <label className="block text-xs font-medium text-slate-700">
                              Invoice no. *
                              <input
                                type="text"
                                required={needRefs}
                                inputMode="text"
                                value={form[`${b.key}Invoice`]}
                                onChange={(e) => handleFormChange(`${b.key}Invoice`, e.target.value)}
                                className="mt-0.5 w-full rounded-lg border-0 bg-amber-50/60 px-2 py-2 text-sm ring-1 ring-amber-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                                autoComplete="off"
                                spellCheck={false}
                              />
                            </label>
                            <label className="block text-xs font-medium text-slate-700">
                              Cut-off price (per bag)
                              {lastCut != null ? (
                                <span className="ml-1 font-normal text-indigo-600">(last)</span>
                              ) : null}
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={form[`${b.key}CutOffPrice`]}
                                onChange={(e) => handleFormChange(`${b.key}CutOffPrice`, e.target.value)}
                                className="mt-0.5 w-full rounded-lg border-0 bg-amber-50/60 px-2 py-2 text-sm tabular-nums ring-1 ring-amber-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                                placeholder={lastCut != null ? String(lastCut) : ''}
                              />
                            </label>
                            <label className="block text-xs text-slate-500">
                              Converting date
                              <input
                                type="date"
                                value={form[`${b.key}ConvertingDate`]}
                                onChange={(e) => handleFormChange(`${b.key}ConvertingDate`, e.target.value)}
                                className="mt-0.5 w-full rounded-lg border-0 bg-slate-50 px-2 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
                >
                  {saving ? 'Saving…' : editingLoadId ? 'Update record' : 'Save record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant="load"
        onClose={() => setDetailRow(null)}
        actions={
          detailRow?.id && canEditDetails() ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  openEditModal(detailRow);
                  setDetailRow(null);
                }}
                className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
              >
                Edit load
              </button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
