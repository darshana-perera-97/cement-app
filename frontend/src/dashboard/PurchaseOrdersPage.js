import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername, isAdmin } from '../auth';
import { DEFAULT_SHOP_NAME } from '../shopConfig';
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
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
  modalPanelClass,
  modalPanelClass4xl,
  ModalBackdrop,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import { downloadPurchaseOrderPdf } from './purchaseOrderPdf';
import { formatPoChequeWithBank, formatPoChequesList } from './poChequeDisplay';

const apiBase = getApiBase();

function bankAccountOptionLabel(a) {
  const nick = String(a.nickName ?? '').trim() || 'Account';
  const detail = [a.bank, a.accountNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return detail ? `${nick} — ${detail}` : nick;
}

function distributorLocations(d) {
  if (!d) return [];
  if (Array.isArray(d.locations) && d.locations.length > 0) {
    return d.locations.map((l) => String(l ?? '').trim()).filter(Boolean);
  }
  const single = String(d.location ?? '').trim();
  return single ? [single] : [];
}

function distributorPrimaryLocation(d) {
  const locs = distributorLocations(d);
  return locs[0] || '';
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let lineKeySeq = 0;
function newKey(prefix) {
  lineKeySeq += 1;
  return `${prefix}-${lineKeySeq}`;
}

function newItemLine(overrides = {}) {
  return {
    key: newKey('item'),
    product: '',
    quantity: '',
    unitPrice: '',
    priceFromLast: false,
    cheques: [newChequeLine()],
    ...overrides,
  };
}

function newChequeLine(overrides = {}) {
  return {
    key: newKey('chq'),
    paymentType: 'cheque',
    chequeNumber: '',
    chequeDate: todayYmdLocal(),
    amount: '',
    amountManual: false,
    bankAccountId: '',
    ...overrides,
  };
}

function isPaymentLineCash(line) {
  return String(line?.paymentType ?? 'cheque').trim().toLowerCase() === 'cash';
}

function paymentLineHasChequeFields(line) {
  if (isPaymentLineCash(line)) return false;
  return Boolean(
    String(line?.chequeNumber ?? '').trim() ||
      String(line?.chequeDate ?? '').trim() ||
      String(line?.amount ?? '').trim() ||
      String(line?.bankAccountId ?? '').trim(),
  );
}

function formHasChequePayments(form) {
  const checkRows = (rows) =>
    (Array.isArray(rows) ? rows : []).some((r) => !isPaymentLineCash(r) && paymentLineHasChequeFields(r));
  if (form.chequePerProduct) {
    return (Array.isArray(form.items) ? form.items : []).some((item) => checkRows(item.cheques));
  }
  return checkRows(form.cheques);
}

/** Format a line/order total for the cheque amount input. */
function formatChequeAmount(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** Auto-fill the first cheque amount from a total unless the user edited it. */
function syncChequeAmounts(cheques, total) {
  const amount = formatChequeAmount(total);
  const list = Array.isArray(cheques) && cheques.length > 0 ? cheques : [newChequeLine()];
  return list.map((c, i) => {
    if (i !== 0 || c.amountManual) return c;
    return { ...c, amount };
  });
}

function itemLineTotal(item) {
  return (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0);
}

function itemsLineTotalSum(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + itemLineTotal(item), 0);
}

/** Parse UI payment rows into API payload entries; returns { ok, error, cheques }. */
function parsePaymentRows(rows, labelPrefix = 'Payment', validBankAccountIds = null) {
  const cheques = [];
  const bankIds = validBankAccountIds instanceof Set ? validBankAccountIds : null;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const paymentType = isPaymentLineCash(line) ? 'cash' : 'cheque';
    const amountRaw = String(line.amount || '').trim();

    if (paymentType === 'cash') {
      if (!amountRaw) continue;
      const amount = Number(amountRaw) || 0;
      if (amount <= 0) {
        return {
          ok: false,
          error: `${labelPrefix} ${i + 1}: enter a cash amount greater than 0.`,
          cheques: [],
        };
      }
      cheques.push({ paymentType: 'cash', amount });
      continue;
    }

    const chequeNumber = String(line.chequeNumber || '').trim();
    const chequeDate = String(line.chequeDate || '').trim();
    const bankAccountId = String(line.bankAccountId || '').trim();
    if (!chequeNumber && !chequeDate && !amountRaw && !bankAccountId) continue;
    if (!chequeNumber) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: enter a cheque number.`, cheques: [] };
    }
    if (!chequeDate || !/^\d{4}-\d{2}-\d{2}$/.test(chequeDate)) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: enter a valid converting date.`, cheques: [] };
    }
    if (!amountRaw) {
      return { ok: false, error: `${labelPrefix} ${i + 1}: enter an amount.`, cheques: [] };
    }
    const amount = Number(amountRaw) || 0;
    if (amount <= 0) {
      return {
        ok: false,
        error: `${labelPrefix} ${i + 1}: amount must be greater than 0.`,
        cheques: [],
      };
    }
    if (!bankAccountId) {
      return {
        ok: false,
        error: `${labelPrefix} ${i + 1}: select a bank account (cash out when converting date arrives).`,
        cheques: [],
      };
    }
    if (bankIds && !bankIds.has(bankAccountId)) {
      return {
        ok: false,
        error: `${labelPrefix} ${i + 1}: select a valid bank account from Shop.`,
        cheques: [],
      };
    }
    cheques.push({ paymentType: 'cheque', chequeNumber, chequeDate, amount, bankAccountId });
  }
  return { ok: true, error: null, cheques };
}

function PaymentLineFields({
  line,
  idx,
  bankAccounts,
  canRemove,
  onFieldChange,
  onRemove,
  compact = false,
}) {
  const isCash = isPaymentLineCash(line);
  const rowClass = compact
    ? 'flex flex-nowrap items-end gap-2 overflow-x-auto'
    : 'grid gap-2 sm:grid-cols-12 sm:items-end';
  const fieldGrow = compact ? 'min-w-[5.5rem] shrink-0 flex-1' : '';
  const typeClass = compact ? `block min-w-[5.5rem] shrink-0 text-sm ${fieldGrow}` : 'block min-w-0 text-sm sm:col-span-2';
  const bankClass = compact ? `block min-w-[8rem] shrink-0 text-sm ${fieldGrow}` : 'block min-w-0 text-sm sm:col-span-3';
  const chequeNumClass = compact
    ? `block min-w-[6rem] shrink-0 text-sm ${fieldGrow}`
    : `block text-sm ${canRemove ? 'sm:col-span-2' : 'sm:col-span-3'}`;
  const dateClass = compact ? `block min-w-[8rem] shrink-0 text-sm ${fieldGrow}` : 'block text-sm sm:col-span-2';
  const amountClass = compact ? `block min-w-[5.5rem] shrink-0 text-sm ${fieldGrow}` : 'block text-sm sm:col-span-2';
  const cashAmountClass = compact
    ? `block min-w-[6rem] shrink-0 text-sm flex-[2]`
    : `block text-sm ${canRemove ? 'sm:col-span-9' : 'sm:col-span-10'}`;
  return (
    <div
      className={`${rowClass} rounded-lg bg-white p-2 ring-1 ring-slate-200/70`}
    >
      <label className={typeClass}>
        <span className="text-xs font-medium text-slate-500">Type</span>
        <select
          value={line.paymentType || 'cheque'}
          onChange={(e) => onFieldChange('paymentType', e.target.value)}
          className={`${filterControl} mt-1 max-w-full`}
        >
          <option value="cheque">Cheque</option>
          <option value="cash">Cash</option>
        </select>
      </label>
      {isCash ? (
        <label className={cashAmountClass}>
          <span className="text-xs font-medium text-slate-500">Cash amount {idx + 1}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={line.amount}
            onChange={(e) => onFieldChange('amount', e.target.value)}
            placeholder="0.00"
            title="Deducted from the cash book on the PO date when saved."
            className={`${filterControl} mt-1`}
          />
        </label>
      ) : (
        <>
          <label className={bankClass}>
            <span className="text-xs font-medium text-slate-500">Bank account</span>
            <select
              title="Pending until converting date; then deducted from balance."
              value={line.bankAccountId || ''}
              onChange={(e) => onFieldChange('bankAccountId', e.target.value)}
              className={`${filterControl} mt-1 max-w-full`}
              disabled={bankAccounts.length === 0}
            >
              <option value="">
                {bankAccounts.length === 0 ? 'No accounts — add under Shop' : 'Select account…'}
              </option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {bankAccountOptionLabel(a)}
                </option>
              ))}
            </select>
          </label>
          <label className={chequeNumClass}>
            <span className="text-xs font-medium text-slate-500">Cheque number {idx + 1}</span>
            <input
              type="text"
              value={line.chequeNumber}
              onChange={(e) => onFieldChange('chequeNumber', e.target.value)}
              className={`${filterControl} mt-1`}
            />
          </label>
          <label className={dateClass}>
            <span className="text-xs font-medium text-slate-500">Converting date</span>
            <input
              type="date"
              value={line.chequeDate}
              onChange={(e) => onFieldChange('chequeDate', e.target.value)}
              className={`${filterControl} mt-1`}
            />
          </label>
          <label className={amountClass}>
            <span className="text-xs font-medium text-slate-500">Amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={line.amount}
              onChange={(e) => onFieldChange('amount', e.target.value)}
              placeholder="0.00"
              className={`${filterControl} mt-1`}
            />
          </label>
        </>
      )}
      {canRemove ? (
        <div className={`flex shrink-0 items-end ${compact ? '' : 'sm:col-span-1'}`}>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
            title="Remove payment"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

const emptyForm = () => ({
  date: todayYmdLocal(),
  distributorId: '',
  distributionLocation: '',
  chequePerProduct: true,
  doorStock: false,
  items: [newItemLine()],
  cheques: [newChequeLine()],
  vehicleNumber: '',
  driverId: '',
  driverName: '',
});

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [lastPrices, setLastPrices] = useState({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [distributorFilter, setDistributorFilter] = useState('');
  const [detailRow, setDetailRow] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [shopDetails, setShopDetails] = useState({ shopName: '' });
  const [lorryNumbers, setLorryNumbers] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);

  const validBankAccountIds = useMemo(
    () => new Set(bankAccounts.map((a) => a.id).filter(Boolean)),
    [bankAccounts],
  );

  const loadDistributors = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/distributors`);
      if (!res.ok) throw new Error('Failed to load distributors');
      const data = await res.json();
      setDistributors(Array.isArray(data) ? data : []);
    } catch {
      setDistributors([]);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/drivers`);
      if (!res.ok) throw new Error('Failed to load drivers');
      const data = await res.json();
      setDrivers(Array.isArray(data) ? data : []);
    } catch {
      setDrivers([]);
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

  const loadBankAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/shop`);
      if (!res.ok) throw new Error('Failed to load shop');
      const data = await res.json();
      setBankAccounts(Array.isArray(data.bankAccounts) ? data.bankAccounts : []);
    } catch {
      setBankAccounts([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/purchase-orders`);
      if (!res.ok) throw new Error('Failed to load purchase orders');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadDistributors();
    loadDrivers();
    loadLorries();
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/shop`);
        if (!res.ok) return;
        const data = await res.json();
        setShopDetails({
          shopName: String(data?.shopName ?? '').trim() || DEFAULT_SHOP_NAME,
          registrationNo: data?.registrationNo ?? '',
          addressLine1: data?.addressLine1 ?? '',
          addressLine2: data?.addressLine2 ?? '',
          email: data?.email ?? '',
          contactNumber: data?.contactNumber ?? '',
          dealerCode: data?.dealerCode ?? '',
          dealerTagline: data?.dealerTagline ?? '',
          deliveryNote: data?.deliveryNote ?? '',
        });
      } catch {
        setShopDetails({ shopName: DEFAULT_SHOP_NAME });
      }
    })();
  }, [loadDistributors, loadDrivers, loadLorries]);

  const lorrySelectOptions = useMemo(() => {
    const current = String(form.vehicleNumber ?? '').trim();
    if (current && !lorryNumbers.includes(current)) {
      return [current, ...lorryNumbers];
    }
    return lorryNumbers;
  }, [lorryNumbers, form.vehicleNumber]);

  const selectedDistributor = useMemo(
    () => distributors.find((d) => d.id === form.distributorId) || null,
    [distributors, form.distributorId],
  );

  const distributorProducts = useMemo(() => {
    const list = Array.isArray(selectedDistributor?.products) ? selectedDistributor.products : [];
    return list.map((p) => String(p).trim()).filter(Boolean);
  }, [selectedDistributor]);

  const selectedDistributorLocations = useMemo(
    () => distributorLocations(selectedDistributor),
    [selectedDistributor],
  );

  const loadLastPrices = useCallback(async (distributorId) => {
    if (!distributorId) {
      setLastPrices({});
      return;
    }
    setLoadingPrices(true);
    try {
      const res = await fetch(
        `${apiBase}/api/purchase-orders/last-prices?distributorId=${encodeURIComponent(distributorId)}`,
      );
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setLastPrices(data.prices && typeof data.prices === 'object' ? data.prices : {});
    } catch {
      setLastPrices({});
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      if (distributorFilter && r.distributorId !== distributorFilter) return false;
      const chequeParts = (Array.isArray(r.cheques) ? r.cheques : []).flatMap((c) => [
        c.chequeNumber,
        c.chequeDate,
      ]);
      return rowMatchesQuery(search, [
        r.date,
        r.poNumber,
        r.distributorName,
        r.product,
        r.vehicleNumber,
        r.driverName,
        r.createdBy,
        r.cancelled ? 'cancelled' : '',
        String(r.quantity ?? ''),
        String(r.unitPrice ?? ''),
        String(r.lineTotal ?? r.totalAmount ?? ''),
        ...chequeParts,
      ]);
    });
  }, [rows, search, dateFrom, dateTo, distributorFilter]);

  const pagination = useTablePagination(filteredRows.length, [
    search,
    dateFrom,
    dateTo,
    distributorFilter,
  ]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );

  const openModal = () => {
    setForm(emptyForm());
    setLastPrices({});
    setSaveError(null);
    loadDistributors();
    loadDrivers();
    loadLorries();
    loadBankAccounts();
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSaveError(null);
  };

  const applyLastPriceToItem = (item, product, prices) => {
    const priceMap = prices || lastPrices;
    const keys = Object.keys(priceMap);
    const matchKey = keys.find((k) => k.toLowerCase() === String(product).trim().toLowerCase());
    if (matchKey == null) {
      return { ...item, product, unitPrice: item.priceFromLast ? '' : item.unitPrice, priceFromLast: false };
    }
    return {
      ...item,
      product,
      unitPrice: String(priceMap[matchKey]),
      priceFromLast: true,
    };
  };

  const handleDistributorChange = (distributorId) => {
    const dist = distributors.find((d) => d.id === distributorId);
    const locs = distributorLocations(dist);
    setForm((f) => ({
      ...f,
      distributorId,
      distributionLocation: locs.length === 1 ? locs[0] : '',
      items: [newItemLine()],
    }));
    loadLastPrices(distributorId);
  };

  const handleChequePerProductToggle = (checked) => {
    setForm((f) => {
      const items = f.items.map((item) => {
        const cheques =
          Array.isArray(item.cheques) && item.cheques.length > 0 ? item.cheques : [newChequeLine()];
        return {
          ...item,
          cheques: checked ? syncChequeAmounts(cheques, itemLineTotal(item)) : cheques,
        };
      });
      const cheques =
        Array.isArray(f.cheques) && f.cheques.length > 0 ? f.cheques : [newChequeLine()];
      return {
        ...f,
        chequePerProduct: checked,
        items,
        cheques: !checked ? syncChequeAmounts(cheques, itemsLineTotalSum(items)) : cheques,
      };
    });
  };

  const handleItemChange = (key, field, value) => {
    setForm((f) => {
      const items = f.items.map((item) => {
        if (item.key !== key) return item;
        let next;
        if (field === 'product') {
          next = applyLastPriceToItem(item, value, lastPrices);
        } else if (field === 'unitPrice') {
          next = { ...item, unitPrice: value, priceFromLast: false };
        } else {
          next = { ...item, [field]: value };
        }
        if (
          f.chequePerProduct &&
          (field === 'quantity' || field === 'unitPrice' || field === 'product')
        ) {
          next = { ...next, cheques: syncChequeAmounts(next.cheques, itemLineTotal(next)) };
        }
        return next;
      });
      let cheques = f.cheques;
      if (
        !f.chequePerProduct &&
        (field === 'quantity' || field === 'unitPrice' || field === 'product')
      ) {
        cheques = syncChequeAmounts(f.cheques, itemsLineTotalSum(items));
      }
      return { ...f, items, cheques };
    });
  };

  useEffect(() => {
    if (!form.distributorId || Object.keys(lastPrices).length === 0) return;
    setForm((f) => {
      const items = f.items.map((item) => {
        if (!item.product) return item;
        if (item.unitPrice && !item.priceFromLast) return item;
        let next = applyLastPriceToItem(item, item.product, lastPrices);
        if (f.chequePerProduct) {
          next = { ...next, cheques: syncChequeAmounts(next.cheques, itemLineTotal(next)) };
        }
        return next;
      });
      const cheques = f.chequePerProduct
        ? f.cheques
        : syncChequeAmounts(f.cheques, itemsLineTotalSum(items));
      return { ...f, items, cheques };
    });
    // Only re-apply when lastPrices map arrives for the selected distributor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPrices]);

  const addItemLine = () => {
    setForm((f) => ({ ...f, items: [...f.items, newItemLine()] }));
  };

  const removeItemLine = (key) => {
    setForm((f) => {
      const next = f.items.filter((i) => i.key !== key);
      const items = next.length > 0 ? next : [newItemLine()];
      return {
        ...f,
        items,
        cheques: f.chequePerProduct
          ? f.cheques
          : syncChequeAmounts(f.cheques, itemsLineTotalSum(items)),
      };
    });
  };

  const handleChequeChange = (key, field, value) => {
    setForm((f) => ({
      ...f,
      cheques: f.cheques.map((c) => {
        if (c.key !== key) return c;
        let next = { ...c, [field]: value, ...(field === 'amount' ? { amountManual: true } : {}) };
        if (field === 'paymentType' && value === 'cash') {
          next = { ...next, chequeNumber: '', bankAccountId: '', amountManual: false };
        }
        return next;
      }),
    }));
  };

  const addChequeLine = () => {
    setForm((f) => ({ ...f, cheques: [...f.cheques, newChequeLine()] }));
  };

  const removeChequeLine = (key) => {
    setForm((f) => {
      const next = f.cheques.filter((c) => c.key !== key);
      return { ...f, cheques: next.length > 0 ? next : [newChequeLine()] };
    });
  };

  const handleItemChequeChange = (itemKey, chequeKey, field, value) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item) => {
        if (item.key !== itemKey) return item;
        const cheques = Array.isArray(item.cheques) ? item.cheques : [newChequeLine()];
        return {
          ...item,
          cheques: cheques.map((c) => {
            if (c.key !== chequeKey) return c;
            let next = { ...c, [field]: value, ...(field === 'amount' ? { amountManual: true } : {}) };
            if (field === 'paymentType' && value === 'cash') {
              next = { ...next, chequeNumber: '', bankAccountId: '', amountManual: false };
            }
            return next;
          }),
        };
      }),
    }));
  };

  const addItemChequeLine = (itemKey) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item) => {
        if (item.key !== itemKey) return item;
        const cheques = Array.isArray(item.cheques) ? item.cheques : [];
        return { ...item, cheques: [...cheques, newChequeLine()] };
      }),
    }));
  };

  const removeItemChequeLine = (itemKey, chequeKey) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item) => {
        if (item.key !== itemKey) return item;
        const cheques = (Array.isArray(item.cheques) ? item.cheques : []).filter((c) => c.key !== chequeKey);
        return { ...item, cheques: cheques.length > 0 ? cheques : [newChequeLine()] };
      }),
    }));
  };

  const handleDriverSelect = (driverId) => {
    if (!driverId) {
      setForm((f) => ({ ...f, driverId: '', driverName: '' }));
      return;
    }
    const driver = drivers.find((d) => d.id === driverId);
    setForm((f) => ({
      ...f,
      driverId,
      driverName: driver ? driver.name : '',
    }));
  };

  const itemsTotalPreview = form.items.reduce((sum, item) => {
    const q = Number(item.quantity) || 0;
    const p = Number(item.unitPrice) || 0;
    return sum + q * p;
  }, 0);

  const resolvedVehicle = String(form.vehicleNumber || '').trim();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    if (!form.distributorId) {
      setSaveError('Select a distributor.');
      return;
    }
    const distributionLocation = String(form.distributionLocation || '').trim();
    if (selectedDistributorLocations.length > 0 && !distributionLocation) {
      setSaveError('Select a distribution location.');
      return;
    }
    if (
      distributionLocation &&
      !selectedDistributorLocations.some(
        (l) => l.toLowerCase() === distributionLocation.toLowerCase(),
      )
    ) {
      setSaveError('Select a valid distribution location for this distributor.');
      return;
    }
    if (!resolvedVehicle) {
      setSaveError(
        lorryNumbers.length === 0
          ? 'Add a lorry under Shop → Lorries before creating a purchase order.'
          : 'Select a lorry.',
      );
      return;
    }

    let driverName = String(form.driverName || '').trim();
    let driverId = String(form.driverId || '').trim();
    if (!driverId || !driverName) {
      setSaveError(
        drivers.length === 0
          ? 'Add a staff user with role Driver under Users, then select them here.'
          : 'Select a driver.',
      );
      return;
    }

    if (formHasChequePayments(form) && bankAccounts.length === 0) {
      setSaveError('Add at least one bank account under Shop before recording cheque payments.');
      return;
    }

    const items = [];
    for (let i = 0; i < form.items.length; i++) {
      const line = form.items[i];
      const product = String(line.product || '').trim();
      const quantity = Number(line.quantity) || 0;
      const unitPrice = Number(line.unitPrice) || 0;
      if (!product && quantity <= 0 && unitPrice <= 0) continue;
      if (!product) {
        setSaveError(`Item ${i + 1}: select a product.`);
        return;
      }
      if (quantity <= 0) {
        setSaveError(`Item ${i + 1}: enter amount (quantity) greater than 0.`);
        return;
      }
      if (unitPrice <= 0) {
        setSaveError(`Item ${i + 1}: enter invoice price per unit.`);
        return;
      }
      const entry = { product, quantity, unitPrice };
      if (form.chequePerProduct) {
        const parsed = parsePaymentRows(
          Array.isArray(line.cheques) ? line.cheques : [],
          `Product ${i + 1} payment`,
          validBankAccountIds,
        );
        if (!parsed.ok) {
          setSaveError(parsed.error);
          return;
        }
        if (parsed.cheques.length === 0) {
          setSaveError(`Product ${i + 1}: enter at least one payment (cheque or cash).`);
          return;
        }
        entry.cheques = parsed.cheques;
      }
      items.push(entry);
    }
    if (items.length === 0) {
      setSaveError('Add at least one product with amount and invoice price.');
      return;
    }

    let cheques = [];
    if (!form.chequePerProduct) {
      const parsed = parsePaymentRows(form.cheques, 'Payment', validBankAccountIds);
      if (!parsed.ok) {
        setSaveError(parsed.error);
        return;
      }
      if (parsed.cheques.length === 0) {
        setSaveError('Enter at least one payment for the whole order (cheque or cash).');
        return;
      }
      cheques = parsed.cheques;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/purchase-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          distributorId: form.distributorId,
          ...(distributionLocation ? { distributionLocation } : {}),
          vehicleNumber: resolvedVehicle,
          driverName,
          ...(driverId ? { driverId } : {}),
          chequePerProduct: !!form.chequePerProduct,
          doorStock: !!form.doorStock,
          cheques,
          items,
          createdBy: username,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      await load();
      closeModal();
      const created = Array.isArray(data.created) ? data.created : [];
      if (created.length === 1) {
        setDetailRow(created[0]);
      }
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = (po) => {
    const distributor =
      distributors.find((d) => d.id === po.distributorId) ||
      distributors.find(
        (d) =>
          String(d.name || '')
            .trim()
            .toLowerCase() ===
          String(po.distributorName || '')
            .trim()
            .toLowerCase(),
      );
    const driver =
      (po.driverId && drivers.find((d) => d.id === po.driverId)) ||
      drivers.find(
        (d) =>
          String(d.name || '')
            .trim()
            .toLowerCase() ===
          String(po.driverName || '')
            .trim()
            .toLowerCase(),
      );

    downloadPurchaseOrderPdf(po, {
      ...shopDetails,
      shopName: shopDetails.shopName || DEFAULT_SHOP_NAME,
      distributorName: po.distributorName || distributor?.name || '',
      distributorLocation: po.distributionLocation || distributorPrimaryLocation(distributor),
      driverLicense: driver?.driverLicense || driver?.nic || '',
      bankAccounts,
    });
  };

  const openCancelConfirm = (po, e) => {
    e?.stopPropagation?.();
    setCancelError(null);
    setCancelTarget(po);
  };

  const closeCancelConfirm = () => {
    if (cancelBusy) return;
    setCancelTarget(null);
    setCancelError(null);
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget?.id) return;
    const username = getUsername();
    if (!username) {
      setCancelError('Sign in as admin to cancel purchase orders.');
      return;
    }
    setCancelBusy(true);
    setCancelError(null);
    try {
      const res = await authFetch(`${apiBase}/api/purchase-orders/${encodeURIComponent(cancelTarget.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelledBy: username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCancelError(data.error || 'Could not cancel purchase order');
        return;
      }
      await load();
      const cancelledPo = data.po || { ...cancelTarget, cancelled: true };
      if (detailRow?.id === cancelTarget.id) {
        setDetailRow(cancelledPo);
      }
      setCancelTarget(null);
    } catch {
      setCancelError('Could not reach the server.');
    } finally {
      setCancelBusy(false);
    }
  };

  const adminCanCancel = (po) => isAdmin() && po && !po.cancelled;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          Create purchase orders by distributor and product. Each product line generates its own PO.
        </p>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
        >
          New purchase order
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
            ? `Showing ${filteredRows.length} of ${rows.length} PO${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="PO #, distributor, product, lorry…"
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
        <label className={filterLabel}>
          Distributor
          <select
            value={distributorFilter}
            onChange={(e) => setDistributorFilter(e.target.value)}
            className={filterControl}
          >
            <option value="">All distributors</option>
            {distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
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
              No purchase orders yet. Create one to get started.
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No purchase orders match your search or filters.
            </p>
          ) : (
            pagedRows.map((r) => (
              <MobileRowCard
                key={r.id}
                title={r.poNumber || '—'}
                subtitle={r.date || '—'}
                className={r.cancelled ? 'opacity-75' : ''}
                badge={
                  r.cancelled ? (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-rose-100">
                      Cancelled
                    </span>
                  ) : null
                }
                fields={[
                  { label: 'Product', value: r.product || '—' },
                  { label: 'Amount', value: String(r.quantity ?? '—') },
                  { label: 'Payments', value: formatPoChequesList(r.cheques, bankAccounts) },
                ]}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => setDetailRow(r)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(r)}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                    >
                      PDF
                    </button>
                    {adminCanCancel(r) ? (
                      <button
                        type="button"
                        onClick={(e) => openCancelConfirm(r, e)}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </>
                }
              />
            ))
          )}
        </div>

        <div className={`${scrollTableWrap} hidden md:block`}>
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className={stickyThead}>
              <tr>
                <th className={`whitespace-nowrap px-4 py-3 font-semibold text-slate-600 ${stickyFirstTh}`}>
                  PO number
                </th>
                <th className="px-3 py-3 font-semibold text-slate-600">Date</th>
                <th className="px-3 py-3 font-semibold text-slate-600">Product</th>
                <th className="px-3 py-3 font-semibold text-slate-600 text-right">Amount</th>
                <th className="px-3 py-3 font-semibold text-slate-600">Payments</th>
                <th className="px-3 py-3 font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                    No purchase orders yet.
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                    No purchase orders match your filters.
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => (
                  <tr
                    key={r.id}
                    className={`cursor-pointer hover:bg-slate-50/80 ${r.cancelled ? 'opacity-75' : ''}`}
                    {...detailRowAttrs(() => setDetailRow(r))}
                  >
                    <td className={`whitespace-nowrap px-4 py-2.5 ${stickyFirstTd}`}>
                      <span className="font-mono text-xs font-semibold text-indigo-700">{r.poNumber || '—'}</span>
                      {r.cancelled ? (
                        <span className="ml-2 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-rose-100">
                          Cancelled
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{r.date || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-800">{r.product || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {Number(r.quantity) || 0}
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5 text-xs text-slate-600">
                      <span className="line-clamp-2" title={formatPoChequesList(r.cheques, bankAccounts)}>
                        {formatPoChequesList(r.cheques, bankAccounts)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailRow(r);
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadPdf(r);
                          }}
                          className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                        >
                          PDF
                        </button>
                        {adminCanCancel(r) ? (
                          <button
                            type="button"
                            onClick={(e) => openCancelConfirm(r, e)}
                            className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
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

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        onClose={() => setDetailRow(null)}
        variant="purchaseOrder"
        actions={
          detailRow ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => handleDownloadPdf(detailRow)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
              >
                Download PO PDF
              </button>
              {adminCanCancel(detailRow) ? (
                <button
                  type="button"
                  onClick={(e) => openCancelConfirm(detailRow, e)}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500"
                >
                  Cancel purchase order
                </button>
              ) : null}
            </div>
          ) : null
        }
      />

      {cancelTarget ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center p-4 sm:items-center">
          <ModalBackdrop onClose={closeCancelConfirm} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="po-cancel-title"
            className={`${modalPanelClass} w-full max-w-md`}
          >
            <h2 id="po-cancel-title" className="text-lg font-bold text-slate-900">
              Cancel purchase order?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This will cancel{' '}
              <span className="font-semibold text-slate-900">{cancelTarget.poNumber || 'this PO'}</span>
              {cancelTarget.product ? (
                <>
                  {' '}
                  for <span className="font-semibold text-slate-900">{cancelTarget.product}</span>
                </>
              ) : null}
              . Issued cheques for this order will be removed from bank balances, and cash payments will be
              reversed from the cash book. This cannot be undone.
            </p>
            {cancelError ? (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                {cancelError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={cancelBusy}
                onClick={closeCancelConfirm}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Keep PO
              </button>
              <button
                type="button"
                disabled={cancelBusy}
                onClick={handleConfirmCancel}
                className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {cancelBusy ? 'Cancelling…' : 'Cancel purchase order'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <ModalBackdrop onClose={closeModal} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="po-modal-title"
            className={`${modalPanelClass4xl} max-h-[92vh] overflow-y-auto`}
          >
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 id="po-modal-title" className="text-lg font-semibold text-slate-900">
                New purchase order sheet
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Each product line becomes a separate PO. Logged in as {getUsername() || '—'}.
                {loadingPrices ? ' Loading last invoice prices…' : ''}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 px-5 py-4 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Date</span>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className={`${filterControl} mt-1.5`}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Distributor</span>
                  <select
                    required
                    value={form.distributorId}
                    onChange={(e) => handleDistributorChange(e.target.value)}
                    className={`${filterControl} mt-1.5`}
                  >
                    <option value="">Select distributor…</option>
                    {distributors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Distribution location</span>
                  <select
                    required={form.distributorId && selectedDistributorLocations.length > 0}
                    value={form.distributionLocation}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, distributionLocation: e.target.value }))
                    }
                    className={`${filterControl} mt-1.5`}
                    disabled={!form.distributorId || selectedDistributorLocations.length === 0}
                    title="Locations are managed under Shop → Distributors."
                  >
                    {!form.distributorId ? (
                      <option value="">Select distributor first…</option>
                    ) : selectedDistributorLocations.length === 0 ? (
                      <option value="">No locations — add under Shop</option>
                    ) : (
                      <>
                        {selectedDistributorLocations.length > 1 ? (
                          <option value="">Select location…</option>
                        ) : null}
                        {selectedDistributorLocations.map((loc) => (
                          <option key={loc} value={loc}>
                            {loc}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Payment mode</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Some distributors take one payment for the whole order; others need separate payment
                      per product. Use cheque or cash on each line.
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-start gap-2.5 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200/80">
                    <input
                      type="checkbox"
                      checked={!!form.chequePerProduct}
                      onChange={(e) => handleChequePerProductToggle(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-800">
                      <span className="font-semibold">Payment per product</span>
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        {form.chequePerProduct
                          ? 'Each product line has its own payment(s).'
                          : 'One payment section applies to the whole order.'}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-800">Products</h3>
                  <button
                    type="button"
                    onClick={addItemLine}
                    disabled={!form.distributorId || distributorProducts.length === 0}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add product
                  </button>
                </div>
                {!form.distributorId ? (
                  <p className="mt-3 text-sm text-slate-500">Select a distributor to choose products.</p>
                ) : distributorProducts.length === 0 ? (
                  <p className="mt-3 text-sm text-amber-700">
                    This distributor has no products. Add products under Shop → Distributors first.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {form.items.map((item, idx) => {
                      const lineTotal = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
                      const itemCheques = Array.isArray(item.cheques) ? item.cheques : [];
                      return (
                        <div
                          key={item.key}
                          className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200/80"
                        >
                          <div className="grid gap-3 sm:grid-cols-12">
                            <label className="block text-sm sm:col-span-4">
                              <span className="text-xs font-medium text-slate-500">Product {idx + 1}</span>
                              <select
                                value={item.product}
                                onChange={(e) => handleItemChange(item.key, 'product', e.target.value)}
                                className={`${filterControl} mt-1`}
                              >
                                <option value="">Select…</option>
                                {distributorProducts.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-sm sm:col-span-2">
                              <span className="text-xs font-medium text-slate-500">Amount</span>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                inputMode="decimal"
                                value={item.quantity}
                                onChange={(e) => handleItemChange(item.key, 'quantity', e.target.value)}
                                placeholder="0"
                                className={`${filterControl} mt-1`}
                              />
                            </label>
                            <label className="block text-sm sm:col-span-3">
                              <span className="text-xs font-medium text-slate-500">
                                Invoice price / unit
                                {item.priceFromLast ? (
                                  <span className="ml-1 font-normal text-indigo-600">(last)</span>
                                ) : null}
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                value={item.unitPrice}
                                onChange={(e) => handleItemChange(item.key, 'unitPrice', e.target.value)}
                                placeholder="0.00"
                                className={`${filterControl} mt-1`}
                              />
                            </label>
                            <div className="flex items-end justify-between gap-2 sm:col-span-3">
                              <div>
                                <p className="text-xs font-medium text-slate-500">Line total</p>
                                <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                                  {money(lineTotal)}
                                </p>
                              </div>
                              {form.items.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => removeItemLine(item.key)}
                                  className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                                  title="Remove product line"
                                  aria-label="Remove product line"
                                >
                                  <svg
                                    className="h-4 w-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    aria-hidden
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {form.chequePerProduct ? (
                            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Payment(s) for this product
                                </p>
                                <button
                                  type="button"
                                  onClick={() => addItemChequeLine(item.key)}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                                >
                                  Add payment
                                </button>
                              </div>
                              <div className="mt-2 space-y-2">
                                {itemCheques.map((c, cIdx) => (
                                  <PaymentLineFields
                                    key={c.key}
                                    line={c}
                                    idx={cIdx}
                                    bankAccounts={bankAccounts}
                                    canRemove={itemCheques.length > 1}
                                    compact
                                    onFieldChange={(field, value) =>
                                      handleItemChequeChange(item.key, c.key, field, value)
                                    }
                                    onRemove={() => removeItemChequeLine(item.key, c.key)}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <div className="flex justify-end border-t border-slate-200/80 pt-3">
                      <p className="text-sm text-slate-600">
                        Total invoice amount:{' '}
                        <span className="font-semibold tabular-nums text-slate-900">{money(itemsTotalPreview)}</span>
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {!form.chequePerProduct ? (
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">Payments (whole order)</h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Same payment(s) will be attached to every product PO from this sheet.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addChequeLine}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    >
                      Add payment
                    </button>
                  </div>
                  <div className="mt-3 space-y-3">
                    {form.cheques.map((c, idx) => (
                      <PaymentLineFields
                        key={c.key}
                        line={c}
                        idx={idx}
                        bankAccounts={bankAccounts}
                        canRemove={form.cheques.length > 1}
                        onFieldChange={(field, value) => handleChequeChange(c.key, field, value)}
                        onRemove={() => removeChequeLine(c.key)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="inline-flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                <input
                  type="checkbox"
                  checked={!!form.doorStock}
                  onChange={(e) => setForm((f) => ({ ...f, doorStock: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-800">
                  <span className="font-semibold">Door step</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">
                    When ticked, &ldquo;Door step&rdquo; appears under Notes on the PO PDF.
                  </span>
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Lorry</span>
                    <select
                      required
                      value={form.vehicleNumber}
                      onChange={(e) => setForm((f) => ({ ...f, vehicleNumber: e.target.value }))}
                      className={`${filterControl} mt-1.5`}
                      disabled={lorryNumbers.length === 0 && !form.vehicleNumber}
                    >
                      <option value="">
                        {lorryNumbers.length === 0 ? 'No lorries — add under Shop' : 'Select lorry…'}
                      </option>
                      {lorrySelectOptions.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-400">
                      Managed under Shop → Lorries.
                    </span>
                  </label>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Driver</span>
                    <select
                      required
                      value={form.driverId}
                      onChange={(e) => handleDriverSelect(e.target.value)}
                      className={`${filterControl} mt-1.5`}
                      disabled={drivers.length === 0}
                    >
                      <option value="">
                        {drivers.length === 0 ? 'No drivers in Users yet' : 'Select driver…'}
                      </option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.driverLicense ? ` · ${d.driverLicense}` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-400">
                      {drivers.length === 0
                        ? 'Add staff with role Driver under Users to select them here.'
                        : 'Drivers come from Users with role Driver.'}
                    </span>
                  </label>
                </div>
              </div>

              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                  {saveError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] disabled:opacity-60"
                >
                  {saving ? <LoadingSpinner label="Generating POs…" size="sm" /> : 'Generate purchase order(s)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
