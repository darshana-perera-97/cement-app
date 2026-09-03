import { useCallback, useEffect, useMemo, useState } from 'react';
import { canEditDetails } from '../auth';
import { getApiBase } from '../apiBase';
import { getCachedBrands, productToBrandKey, formatBrandLabel } from './brandTheme';
import { useBagProducts } from './BagProductsContext';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import {
  buildLoadBasedBasicIncentiveRows,
  buildStockGroupedBasicIncentiveRows,
  downloadBasicIncentiveExcel,
  downloadBasicIncentivePdf,
  downloadStockWiseIncentiveExcel,
  downloadStockWiseIncentivePdf,
} from './incentiveBasicExport';
import {
  downloadDoorStockTransportExcel,
  downloadDoorStockTransportPdf,
} from './doorStockTransportExport';
import DoorStockTransportSettingsModal, {
  EMPTY_DOOR_STOCK_TRANSPORT_SETTINGS,
} from './DoorStockTransportSettingsModal';
import {
  normalizeDoorStockTransportSettings,
  resolveBrandDoorStockSettings,
} from './doorStockTransportSettings';
import { downloadIncentiveCompanyReport, resolveLocation } from './incentiveCompanyExport';
import {
  buildShopGroupedDistributionRows,
  computeSpecialPriceFields,
  downloadIncentiveCalculatorPdf,
  downloadIncentiveCostPdf,
  downloadIncentivePdf,
} from './incentivePdf';
import {
  LoadingSpinner,
  MobileRowCard,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  modalPanelClassMd,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTdMuted,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';

const EMPTY_INCENTIVE_FILTERS = {
  search: '',
  dateFrom: '',
  dateTo: '',
  shop: '',
  brand: '',
  stockId: '',
};

const EMPTY_DOOR_STOCK_FILTERS = {
  dateFrom: '',
  dateTo: '',
  brand: '',
};

function countActiveIncentiveFilters(filters, { includeShop = true } = {}) {
  let count = 0;
  if (String(filters.search ?? '').trim()) count += 1;
  if (filters.dateFrom) count += 1;
  if (filters.dateTo) count += 1;
  if (includeShop && filters.shop) count += 1;
  if (filters.brand) count += 1;
  if (String(filters.stockId ?? '').trim()) count += 1;
  return count;
}

function filterLoadIncentiveRows(rows, filters) {
  const { search, dateFrom, dateTo, brand, stockId } = filters;
  const stockIdQuery = String(stockId ?? '').trim().toLowerCase();

  return rows.filter((r) => {
    if (!inDateRange(r.date, dateFrom, dateTo)) return false;
    if (brand && r.brandKey !== brand) return false;
    if (stockIdQuery && !String(r.stockId ?? '').toLowerCase().includes(stockIdQuery)) return false;

    return rowMatchesQuery(search, [
      r.date,
      r.stockId,
      r.invoiceNumber,
      r.brandLabel,
      String(r.bags),
      String(r.perBagPrice),
      String(r.cutOffPrice),
      String(r.transportPerBag),
      String(r.totalCostPerBag),
      String(r.basicIncentivePerBag),
      String(r.basicTotalIncentive),
    ]);
  });
}

function filterDistributionRows(rows, filters, customerLocationMap) {
  const { search, dateFrom, dateTo, shop, brand, stockId } = filters;
  const stockIdQuery = String(stockId ?? '').trim().toLowerCase();

  return rows.filter((r) => {
    if (!inDateRange(r.date, dateFrom, dateTo)) return false;
    if (shop && r.shop !== shop) return false;
    if (brand && r.brandKey !== brand) return false;
    if (stockIdQuery && !String(r.stockId ?? '').toLowerCase().includes(stockIdQuery)) return false;

    const location = resolveLocation(r.shop, customerLocationMap);
    return rowMatchesQuery(search, [
      r.date,
      r.stockId,
      r.shop,
      location,
      r.brandLabel,
      String(r.bags),
      String(r.perBagPrice),
      String(r.cutOffPrice),
      String(r.cutOffIncentivePerBag),
      String(r.transportPerBag),
      String(r.totalCostPerBag),
      String(r.sellingPricePerBag),
      String(r.incentivePerBag),
      String(r.pureIncentivePerBag),
      String(r.totalIncentive),
    ]);
  });
}

const downloadPdfButtonClass =
  'rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

function DistributionFilterModal({
  open,
  title,
  description,
  titleId,
  draft,
  setDraft,
  shopOptions,
  brands,
  showShopFilter = true,
  onApply,
  onClear,
  onClose,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className={modalPanelClassMd}>
        <h2 id={titleId} className="text-lg font-bold text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onApply();
          }}
        >
          <label className="block text-sm font-medium text-slate-600">
            Search
            <input
              type="search"
              value={draft.search}
              onChange={(e) => setDraft((prev) => ({ ...prev, search: e.target.value }))}
              placeholder={showShopFilter ? 'Shop, stock ID, bag type, amounts…' : 'Stock ID, invoice, bag type, amounts…'}
              className={filterControl}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-600">
              From date
              <input
                type="date"
                value={draft.dateFrom}
                onChange={(e) => setDraft((prev) => ({ ...prev, dateFrom: e.target.value }))}
                className={filterControl}
              />
            </label>
            <label className="block text-sm font-medium text-slate-600">
              To date
              <input
                type="date"
                value={draft.dateTo}
                onChange={(e) => setDraft((prev) => ({ ...prev, dateTo: e.target.value }))}
                className={filterControl}
              />
            </label>
          </div>
          {showShopFilter ? (
            <label className="block text-sm font-medium text-slate-600">
              Shop
              <select
                value={draft.shop}
                onChange={(e) => setDraft((prev) => ({ ...prev, shop: e.target.value }))}
                className={filterControl}
              >
                <option value="">All shops</option>
                {shopOptions.map((shop) => (
                  <option key={shop} value={shop}>
                    {shop}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-600">
              Bag type
              <select
                value={draft.brand}
                onChange={(e) => setDraft((prev) => ({ ...prev, brand: e.target.value }))}
                className={filterControl}
              >
                <option value="">All bag types</option>
                {brands.map((b) => (
                  <option key={b.key} value={b.key}>
                    {formatBrandLabel(b) || b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-600">
              Stock ID
              <input
                type="search"
                value={draft.stockId}
                onChange={(e) => setDraft((prev) => ({ ...prev, stockId: e.target.value }))}
                placeholder="Contains…"
                className={filterControl}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            >
              Apply filters
            </button>
            <button type="button" className={downloadPdfButtonClass} onClick={onClear}>
              Clear all
            </button>
            <button type="button" className={downloadPdfButtonClass} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const apiBase = getApiBase();
const DEFAULT_MARGIN_PER_BAG = 70;

function money(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function moneyOrDash(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return money(n);
}

const negativeMoneyClass = 'font-medium text-orange-600';

function moneyOrDashStyled(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const formatted = money(n);
  if (Number(n) < 0) return <span className={negativeMoneyClass}>{formatted}</span>;
  return formatted;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function resolveDoorStockLocations(brandKey, settings, poFromFallback) {
  const brandCfg = resolveBrandDoorStockSettings(settings, brandKey);
  const from =
    String(brandCfg.from ?? '').trim() || String(poFromFallback ?? '').trim() || '—';
  const to = String(brandCfg.to ?? '').trim() || '—';
  return { from, to, locationFromTo: formatLocationFromTo(from, to) };
}

function formatLocationFromTo(from, to) {
  const f = String(from ?? '').trim() || '—';
  const t = String(to ?? '').trim() || '—';
  return `${f} | ${t}`;
}

/** One row per door-step stock load × brand (bags > 0). */
function buildDoorStockRows(loads, purchaseOrders, doorStockSettings, brands) {
  const settings = doorStockSettings || EMPTY_DOOR_STOCK_TRANSPORT_SETTINGS;
  const poById = new Map(
    (Array.isArray(purchaseOrders) ? purchaseOrders : []).map((po) => [String(po.id), po]),
  );
  const rows = [];

  for (const load of Array.isArray(loads) ? loads : []) {
    const poIds = (Array.isArray(load.purchaseOrderIds) ? load.purchaseOrderIds : [])
      .map((id) => String(id).trim())
      .filter(Boolean);
    const doorStockPos = poIds.map((id) => poById.get(id)).filter((po) => po?.doorStock);
    if (doorStockPos.length === 0) continue;

    const invoiceDate = String(load.date ?? '').slice(0, 10);
    const vehicleNumber = String(load.vehicleNumber ?? '').trim() || '—';
    const tpRate = round2(Number(load.doorStockTransportCostPerBag) || 0);

    for (const b of brands) {
      const quantity = Number(load[`${b.key}Bags`]) || 0;
      if (quantity <= 0) continue;

      const matchingPo = doorStockPos.find(
        (po) => productToBrandKey(po.product, brands) === b.key,
      );
      const poFrom = String(
        matchingPo?.distributionLocation ?? doorStockPos[0]?.distributionLocation ?? '',
      ).trim();
      const { from, to, locationFromTo } = resolveDoorStockLocations(b.key, settings, poFrom);
      const invoiceNumber = String(load[`${b.key}Invoice`] ?? '').trim() || '—';

      rows.push({
        rowKey: `door-${load.id || load.stockId}-${b.key}`,
        invoiceDate,
        invoiceNumber,
        vehicleNumber,
        brandKey: b.key,
        brandLabel: formatBrandLabel(b) || b.label,
        quantity,
        tpRate,
        locationFrom: from,
        locationTo: to,
        locationFromTo,
        amount: round2(tpRate * quantity),
        stockId: String(load.stockId ?? '').trim() || '—',
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = b.invoiceDate.localeCompare(a.invoiceDate);
    if (byDate !== 0) return byDate;
    const byStock = a.stockId.localeCompare(b.stockId);
    if (byStock !== 0) return byStock;
    return a.brandLabel.localeCompare(b.brandLabel);
  });

  return rows;
}

function priceDiffPerBag(left, right) {
  if (
    left == null ||
    right == null ||
    !Number.isFinite(Number(left)) ||
    !Number.isFinite(Number(right))
  ) {
    return null;
  }
  return round2(Number(left) - Number(right));
}

/** (Per bag price + transport + margin) − cut-off price (per bag). */
function cutOffIncentivePerBag(perBagPrice, transportPerBag, marginPerBag, cutOffPrice) {
  if (
    perBagPrice == null ||
    transportPerBag == null ||
    marginPerBag == null ||
    cutOffPrice == null ||
    !Number.isFinite(Number(perBagPrice)) ||
    !Number.isFinite(Number(transportPerBag)) ||
    !Number.isFinite(Number(marginPerBag)) ||
    !Number.isFinite(Number(cutOffPrice))
  ) {
    return null;
  }
  return round2(
    Number(perBagPrice) + Number(transportPerBag) + Number(marginPerBag) - Number(cutOffPrice),
  );
}

function loadHasIncentivePricing(load) {
  return (
    'transportCostPerBag' in load ||
    'doorStockTransportCostPerBag' in load ||
    'marginPerBag' in load
  );
}

function loadTransportPerBag(load, hasLoadPricing) {
  if (!hasLoadPricing) return null;
  const regular = round2(Number(load.transportCostPerBag) || 0);
  const doorStock = round2(Number(load.doorStockTransportCostPerBag) || 0);
  return round2(regular + doorStock);
}

/** One row per stock load × brand (bags > 0). */
function buildIncentiveRows(loads) {
  const rows = [];
  for (const load of loads) {
    const stockId = String(load.stockId ?? '').trim() || '—';
    const loadDate = String(load.date ?? '').slice(0, 10);
    const hasLoadPricing = loadHasIncentivePricing(load);
    const transportPerBagStored = loadTransportPerBag(load, hasLoadPricing);
    const marginPerBagRaw = load.marginPerBag;
    const marginPerBagForLoad = round2(
      marginPerBagRaw === '' || marginPerBagRaw == null
        ? DEFAULT_MARGIN_PER_BAG
        : Number(marginPerBagRaw) || DEFAULT_MARGIN_PER_BAG,
    );

    for (const b of getCachedBrands()) {
      const bags = Number(load[`${b.key}Bags`]) || 0;
      if (bags <= 0) continue;

      const totalCost = Number(load[`${b.key}Cost`]) || 0;
      const perBagCost = bags > 0 ? round2(totalCost / bags) : 0;
      const invoiceNumber = String(load[`${b.key}Invoice`] ?? '').trim() || '—';
      const chequeNumber = String(load[`${b.key}Cheque`] ?? '').trim() || '—';
      const convertingDate =
        String(load[`${b.key}ConvertingDate`] ?? '').trim().slice(0, 10) || loadDate || '—';

      const cutOffRaw = load[`${b.key}CutOffPrice`];
      const cutOffNumber = cutOffRaw == null || cutOffRaw === '' ? null : Number(cutOffRaw);
      const hasCutOff = cutOffNumber != null && Number.isFinite(cutOffNumber);

      const transportPerBag = round2(transportPerBagStored ?? 0);
      const transportCost = round2(transportPerBag * bags);
      const margin = marginPerBagForLoad;
      const unloadingPrice = round2(perBagCost + transportPerBag + margin);

      rows.push({
        rowKey: `${load.id || stockId}-${b.key}`,
        date: loadDate,
        stockId,
        brandKey: b.key,
        brandLabel: formatBrandLabel(b) || b.label,
        bags,
        totalCost,
        perBagCost,
        invoiceNumber,
        chequeNumber,
        convertingDate,
        transportCost,
        transportPerBag,
        margin,
        cutOffPrice: hasCutOff ? round2(cutOffNumber) : null,
        unloadingPrice,
        vehicleNumber: String(load.vehicleNumber ?? '').trim() || '—',
        addedBy: String(load.addedBy ?? '').trim() || '—',
        totalLoadAmount: Number(load.totalAmount) || 0,
        sourceLoad: load,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    const byStock = b.stockId.localeCompare(a.stockId);
    if (byStock !== 0) return byStock;
    return a.brandLabel.localeCompare(b.brandLabel);
  });

  return rows;
}

function compareLoadOrder(a, b) {
  const byDate = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  if (byDate !== 0) return byDate;
  const byStock = String(a.stockId ?? '').localeCompare(String(b.stockId ?? ''));
  if (byStock !== 0) return byStock;
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

function compareBillOrder(a, b) {
  const byDate = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  if (byDate !== 0) return byDate;
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
}

/** Per-bag pricing from stock loads, keyed by stockId|brandKey. */
function buildLoadBrandPricingLookup(loads) {
  const map = new Map();
  for (const load of loads) {
    const stockId = String(load.stockId ?? '').trim();
    if (!stockId) continue;

    const hasLoadPricing = loadHasIncentivePricing(load);
    const transportPerBag = loadTransportPerBag(load, hasLoadPricing) ?? 0;
    const marginPerBagRaw = load.marginPerBag;
    const marginPerBag = round2(
      marginPerBagRaw === '' || marginPerBagRaw == null
        ? DEFAULT_MARGIN_PER_BAG
        : Number(marginPerBagRaw) || DEFAULT_MARGIN_PER_BAG,
    );

    for (const b of getCachedBrands()) {
      const bags = Number(load[`${b.key}Bags`]) || 0;
      if (bags <= 0) continue;
      const totalCost = Number(load[`${b.key}Cost`]) || 0;
      const perBagPrice = round2(totalCost / bags);
      const totalCostPerBag = round2(perBagPrice + transportPerBag + marginPerBag);
      const cutOffRaw = load[`${b.key}CutOffPrice`];
      const cutOffNumber = cutOffRaw == null || cutOffRaw === '' ? null : Number(cutOffRaw);
      const cutOffPrice =
        cutOffNumber != null && Number.isFinite(cutOffNumber) ? round2(cutOffNumber) : null;
      const invoiceNumber = String(load[`${b.key}Invoice`] ?? '').trim() || '—';
      const loadDate = String(load.date ?? '').slice(0, 10) || '—';
      map.set(`${stockId}|${b.key}`, {
        perBagPrice,
        cutOffPrice,
        transportPerBag,
        marginPerBag,
        totalCostPerBag,
        invoiceNumber,
        loadDate,
      });
    }
  }
  return map;
}

/** Per-brand FIFO pools from stock loads (oldest load first). */
function buildLoadPools(loads) {
  const pools = Object.fromEntries(getCachedBrands().map((b) => [b.key, []]));
  for (const load of [...loads].sort(compareLoadOrder)) {
    const stockId = String(load.stockId ?? '').trim();
    if (!stockId) continue;
    for (const b of getCachedBrands()) {
      const bags = Number(load[`${b.key}Bags`]) || 0;
      if (bags > 0) pools[b.key].push({ stockId, remaining: bags });
    }
  }
  return pools;
}

function allocateFromPool(pool, need, stockIdFilter = null) {
  const chunks = [];
  let left = need;
  for (const slot of pool) {
    if (left <= 0) break;
    if (stockIdFilter && slot.stockId !== stockIdFilter) continue;
    if (slot.remaining <= 0) continue;
    const take = Math.min(left, slot.remaining);
    slot.remaining -= take;
    left -= take;
    chunks.push({ stockId: slot.stockId, bags: take });
  }
  return chunks;
}

/**
 * One row per credit bill × brand × stock load.
 * Bills are not stored with a stock ID — bags are matched to loads FIFO (oldest load first).
 */
function buildDistributionRows(loads, bills) {
  const pools = buildLoadPools(loads);
  const pricingLookup = buildLoadBrandPricingLookup(loads);
  const rows = [];

  for (const bill of [...bills].sort(compareBillOrder)) {
    const date = String(bill.date ?? '').slice(0, 10);
    const shop = String(bill.customerName ?? '').trim() || '—';
    const explicitStockId = String(bill.stockId ?? '').trim();

    for (const b of getCachedBrands()) {
      let need = Number(bill[`${b.key}Bags`]) || 0;
      if (need <= 0) continue;

      const pool = pools[b.key];
      let chunks = explicitStockId
        ? allocateFromPool(pool, need, explicitStockId)
        : allocateFromPool(pool, need);

      if (explicitStockId) {
        const taken = chunks.reduce((sum, c) => sum + c.bags, 0);
        if (taken < need) {
          chunks = chunks.concat(allocateFromPool(pool, need - taken));
        }
      }

      const unitPriceRaw = bill[`${b.key}UnitPrice`];
      const sellingPricePerBag =
        unitPriceRaw == null || unitPriceRaw === '' ? null : round2(Number(unitPriceRaw));

      for (const chunk of chunks) {
        const pricing = pricingLookup.get(`${chunk.stockId}|${b.key}`);
        const perBagPrice = pricing?.perBagPrice ?? null;
        const cutOffPrice = pricing?.cutOffPrice ?? null;
        const transportPerBag = pricing?.transportPerBag ?? null;
        const marginPerBag = pricing?.marginPerBag ?? null;
        const totalCostPerBag = pricing?.totalCostPerBag ?? null;
        const invoiceNumber = pricing?.invoiceNumber ?? '—';
        const loadDate = pricing?.loadDate ?? date;
        const incentivePerBag = priceDiffPerBag(totalCostPerBag, sellingPricePerBag);
        const cutOffIncentive = cutOffIncentivePerBag(perBagPrice, transportPerBag, marginPerBag, cutOffPrice);
        const pureIncentivePerBag = priceDiffPerBag(incentivePerBag, cutOffIncentive);
        rows.push({
          rowKey: `${bill.id || date}-${b.key}-${chunk.stockId}-${rows.length}`,
          date,
          loadDate,
          stockId: chunk.stockId,
          shop,
          brandKey: b.key,
          brandLabel: formatBrandLabel(b) || b.label,
          bags: chunk.bags,
          perBagPrice,
          invoiceNumber,
          cutOffPrice,
          transportPerBag,
          marginPerBag,
          totalCostPerBag,
          sellingPricePerBag,
          incentivePerBag,
          cutOffIncentivePerBag: cutOffIncentive,
          pureIncentivePerBag,
          totalIncentive: pureIncentivePerBag != null ? round2(pureIncentivePerBag * chunk.bags) : null,
        });
      }
    }
  }

  rows.sort((a, b) => {
    const byShop = a.shop.localeCompare(b.shop);
    if (byShop !== 0) return byShop;
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    const byStock = a.stockId.localeCompare(b.stockId);
    if (byStock !== 0) return byStock;
    return a.brandLabel.localeCompare(b.brandLabel);
  });

  return rows;
}

export default function IncentivePage() {
  const { brands } = useBagProducts();
  const [loads, setLoads] = useState([]);
  const [bills, setBills] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [doorStockTransportSettings, setDoorStockTransportSettings] = useState(
    EMPTY_DOOR_STOCK_TRANSPORT_SETTINGS,
  );
  const normalizedDoorStockSettings = useMemo(
    () => normalizeDoorStockTransportSettings(doorStockTransportSettings, brands),
    [doorStockTransportSettings, brands],
  );
  const [doorStockFilters, setDoorStockFilters] = useState(EMPTY_DOOR_STOCK_FILTERS);
  const [doorStockSettingsOpen, setDoorStockSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detailRow, setDetailRow] = useState(null);
  const [incentiveFilterOpen, setIncentiveFilterOpen] = useState(false);
  const [incentiveFilters, setIncentiveFilters] = useState(EMPTY_INCENTIVE_FILTERS);
  const [incentiveFilterDraft, setIncentiveFilterDraft] = useState(EMPTY_INCENTIVE_FILTERS);
  const [specialPriceFilterOpen, setSpecialPriceFilterOpen] = useState(false);
  const [specialPriceFilters, setSpecialPriceFilters] = useState(EMPTY_INCENTIVE_FILTERS);
  const [specialPriceFilterDraft, setSpecialPriceFilterDraft] = useState(EMPTY_INCENTIVE_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadsRes, billsRes, customersRes, promoRes, poRes, shopRes] = await Promise.all([
        fetch(`${apiBase}/api/stocks`),
        fetch(`${apiBase}/api/bills`),
        fetch(`${apiBase}/api/customers`),
        fetch(`${apiBase}/api/promotions`),
        fetch(`${apiBase}/api/purchase-orders`),
        fetch(`${apiBase}/api/shop`),
      ]);
      if (!loadsRes.ok) throw new Error('Failed to load stock data');
      if (!billsRes.ok) throw new Error('Failed to load bill data');
      if (!customersRes.ok) throw new Error('Failed to load customer data');
      const [loadsData, billsData, customersData, promoData, poData, shopData] = await Promise.all([
        loadsRes.json(),
        billsRes.json(),
        customersRes.json(),
        promoRes.ok ? promoRes.json() : Promise.resolve([]),
        poRes.ok ? poRes.json() : Promise.resolve([]),
        shopRes.ok ? shopRes.json() : Promise.resolve({}),
      ]);
      setLoads(Array.isArray(loadsData) ? loadsData : []);
      setBills(Array.isArray(billsData) ? billsData : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
      setPromotions(Array.isArray(promoData) ? promoData : []);
      setPurchaseOrders(Array.isArray(poData) ? poData : []);
      setDoorStockTransportSettings({
        ...EMPTY_DOOR_STOCK_TRANSPORT_SETTINGS,
        ...(shopData?.doorStockTransportSettings && typeof shopData.doorStockTransportSettings === 'object'
          ? shopData.doorStockTransportSettings
          : {}),
      });
    } catch (e) {
      setError(e.message || 'Could not load data');
      setLoads([]);
      setBills([]);
      setCustomers([]);
      setPurchaseOrders([]);
      setDoorStockTransportSettings(EMPTY_DOOR_STOCK_TRANSPORT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tableRows = useMemo(() => buildIncentiveRows(loads), [loads]);
  const distributionRows = useMemo(() => buildDistributionRows(loads, bills), [loads, bills]);

  const customerLocationMap = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const name = String(c.name ?? '').trim();
      if (name) map.set(name.toLowerCase(), String(c.location ?? '').trim());
    }
    return map;
  }, [customers]);

  const filteredRows = useMemo(() => {
    return tableRows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.stockId,
        r.brandLabel,
        r.invoiceNumber,
        r.chequeNumber,
        r.convertingDate,
        String(r.bags),
        String(r.totalCost),
        String(r.perBagCost),
        String(r.cutOffPrice),
        String(r.transportPerBag),
        String(r.transportCost),
        String(r.margin),
        String(r.unloadingPrice),
      ]);
    });
  }, [tableRows, search, dateFrom, dateTo]);

  const filteredDistributionRows = useMemo(() => {
    return distributionRows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      const location = resolveLocation(r.shop, customerLocationMap);
      return rowMatchesQuery(search, [
        r.date,
        r.stockId,
        r.shop,
        location,
        r.brandLabel,
        String(r.bags),
        String(r.perBagPrice),
        String(r.cutOffPrice),
        String(r.cutOffIncentivePerBag),
        String(r.transportPerBag),
        String(r.totalCostPerBag),
        String(r.sellingPricePerBag),
        String(r.incentivePerBag),
        String(r.pureIncentivePerBag),
        String(r.totalIncentive),
      ]);
    });
  }, [distributionRows, search, dateFrom, dateTo, customerLocationMap]);

  const incentiveShopOptions = useMemo(() => {
    const shops = new Set();
    for (const row of distributionRows) {
      const shop = String(row.shop ?? '').trim();
      if (shop && shop !== '—') shops.add(shop);
    }
    return [...shops].sort((a, b) => a.localeCompare(b));
  }, [distributionRows]);

  const loadBasicIncentiveRows = useMemo(
    () => buildLoadBasedBasicIncentiveRows(tableRows),
    [tableRows],
  );

  const filteredLoadBasicIncentiveRows = useMemo(
    () => filterLoadIncentiveRows(loadBasicIncentiveRows, incentiveFilters),
    [loadBasicIncentiveRows, incentiveFilters],
  );

  const filteredSpecialPriceDistributionRows = useMemo(
    () => filterDistributionRows(distributionRows, specialPriceFilters, customerLocationMap),
    [distributionRows, specialPriceFilters, customerLocationMap],
  );

  const activeIncentiveFilterCount = useMemo(
    () => countActiveIncentiveFilters(incentiveFilters, { includeShop: false }),
    [incentiveFilters],
  );

  const activeSpecialPriceFilterCount = useMemo(
    () => countActiveIncentiveFilters(specialPriceFilters),
    [specialPriceFilters],
  );

  const groupedDistributionRows = useMemo(
    () => buildShopGroupedDistributionRows(filteredSpecialPriceDistributionRows),
    [filteredSpecialPriceDistributionRows],
  );

  const basicIncentiveRows = filteredLoadBasicIncentiveRows;

  const groupedBasicIncentiveRows = useMemo(
    () => buildStockGroupedBasicIncentiveRows(basicIncentiveRows),
    [basicIncentiveRows],
  );

  const invoiceDiscountRows = useMemo(() => {
    return promotions
      .filter((p) => String(p.type ?? '').trim() === 'invoice_discount')
      .map((p) => ({
        id: p.id,
        date: p.date,
        customerName: p.customerName || '—',
        invoiceNumber: p.invoiceNumber || '—',
        discountMode: p.discountMode === 'per_bag' ? 'Per bag' : 'Whole invoice',
        discountValue: Number(p.discountValue) || 0,
        discountAmount: Number(p.discountAmount) || 0,
        reason: p.reason || '—',
        enteredBy: p.enteredBy || '—',
      }))
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  }, [promotions]);

  const filteredInvoiceDiscountRows = useMemo(() => {
    return invoiceDiscountRows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.customerName,
        r.invoiceNumber,
        r.discountMode,
        String(r.discountValue),
        String(r.discountAmount),
        r.reason,
        r.enteredBy,
      ]);
    });
  }, [invoiceDiscountRows, dateFrom, dateTo, search]);

  const invoiceDiscountPagination = useTablePagination(filteredInvoiceDiscountRows.length, [
    search,
    dateFrom,
    dateTo,
  ]);
  const pagedInvoiceDiscountRows = useMemo(
    () =>
      filteredInvoiceDiscountRows.slice(
        invoiceDiscountPagination.offset,
        invoiceDiscountPagination.offset + invoiceDiscountPagination.pageSize,
      ),
    [filteredInvoiceDiscountRows, invoiceDiscountPagination.offset, invoiceDiscountPagination.pageSize],
  );

  const invoiceDiscountTotal = useMemo(
    () => filteredInvoiceDiscountRows.reduce((s, r) => s + (Number(r.discountAmount) || 0), 0),
    [filteredInvoiceDiscountRows],
  );

  const doorStockRows = useMemo(
    () => buildDoorStockRows(loads, purchaseOrders, normalizedDoorStockSettings, brands),
    [loads, purchaseOrders, normalizedDoorStockSettings, brands],
  );

  const filteredDoorStockRows = useMemo(() => {
    const { dateFrom: dsFrom, dateTo: dsTo, brand: dsBrand } = doorStockFilters;
    return doorStockRows.filter((r) => {
      if (!inDateRange(r.invoiceDate, dsFrom, dsTo)) return false;
      if (dsBrand && r.brandKey !== dsBrand) return false;
      return true;
    });
  }, [doorStockRows, doorStockFilters]);

  const doorStockPagination = useTablePagination(filteredDoorStockRows.length, [doorStockFilters]);
  const pagedDoorStockRows = useMemo(
    () =>
      filteredDoorStockRows.slice(
        doorStockPagination.offset,
        doorStockPagination.offset + doorStockPagination.pageSize,
      ),
    [filteredDoorStockRows, doorStockPagination.offset, doorStockPagination.pageSize],
  );

  const doorStockTotals = useMemo(() => {
    let quantity = 0;
    let amount = 0;
    for (const r of filteredDoorStockRows) {
      quantity += Number(r.quantity) || 0;
      amount += Number(r.amount) || 0;
    }
    return { quantity, amount: round2(amount) };
  }, [filteredDoorStockRows]);

  const basicIncentiveTotals = useMemo(() => {
    let bags = 0;
    let totalIncentive = 0;
    let hasTotalIncentive = false;
    for (const r of basicIncentiveRows) {
      bags += r.bags;
      if (r.basicTotalIncentive != null) {
        totalIncentive += r.basicTotalIncentive;
        hasTotalIncentive = true;
      }
    }
    return {
      bags,
      totalIncentive: round2(totalIncentive),
      hasTotalIncentive,
    };
  }, [basicIncentiveRows]);

  const loadPagination = useTablePagination(filteredRows.length, [search, dateFrom, dateTo]);
  const pagedLoadRows = useMemo(
    () => filteredRows.slice(loadPagination.offset, loadPagination.offset + loadPagination.pageSize),
    [filteredRows, loadPagination.offset, loadPagination.pageSize],
  );

  const basicPagination = useTablePagination(groupedBasicIncentiveRows.length, [incentiveFilters]);
  const pagedBasicRows = useMemo(
    () =>
      groupedBasicIncentiveRows.slice(
        basicPagination.offset,
        basicPagination.offset + basicPagination.pageSize,
      ),
    [groupedBasicIncentiveRows, basicPagination.offset, basicPagination.pageSize],
  );

  const distributionPagination = useTablePagination(groupedDistributionRows.length, [specialPriceFilters]);
  const pagedDistributionRows = useMemo(
    () =>
      groupedDistributionRows.slice(
        distributionPagination.offset,
        distributionPagination.offset + distributionPagination.pageSize,
      ),
    [groupedDistributionRows, distributionPagination.offset, distributionPagination.pageSize],
  );

  const filteredTotals = useMemo(() => {
    const t = { bags: 0, transportCost: 0, margin: 0, hasTransport: false, hasMargin: false };
    for (const r of filteredRows) {
      t.bags += r.bags;
      if (r.transportPerBag != null) {
        t.transportCost += r.transportPerBag * r.bags;
        t.hasTransport = true;
      }
      if (r.margin != null) {
        t.margin += r.margin * r.bags;
        t.hasMargin = true;
      }
    }
    return t;
  }, [filteredRows]);

  const distributionTotals = useMemo(() => {
    let bags = 0;
    let totalDifference = 0;
    let hasTotalDifference = false;
    for (const r of filteredSpecialPriceDistributionRows) {
      bags += r.bags;
      const { totalDifference: rowTotal } = computeSpecialPriceFields(r);
      if (rowTotal != null) {
        totalDifference += rowTotal;
        hasTotalDifference = true;
      }
    }
    return {
      bags,
      totalDifference: round2(totalDifference),
      hasTotalDifference,
    };
  }, [filteredSpecialPriceDistributionRows]);

  const brandByKey = useMemo(() => Object.fromEntries(brands.map((b) => [b.key, b])), [brands]);

  const doorStockExportOptions = useMemo(
    () => ({
      dateFrom: doorStockFilters.dateFrom,
      dateTo: doorStockFilters.dateTo,
      brandKey: doorStockFilters.brand || '',
      brandLabel: doorStockFilters.brand
        ? formatBrandLabel(brandByKey[doorStockFilters.brand]) ||
          brandByKey[doorStockFilters.brand]?.label ||
          doorStockFilters.brand
        : '',
    }),
    [doorStockFilters, brandByKey],
  );

  const handleDownloadDoorStockPdf = useCallback(() => {
    downloadDoorStockTransportPdf(filteredDoorStockRows, normalizedDoorStockSettings, doorStockExportOptions);
  }, [filteredDoorStockRows, normalizedDoorStockSettings, doorStockExportOptions]);

  const handleDownloadDoorStockExcel = useCallback(() => {
    downloadDoorStockTransportExcel(
      filteredDoorStockRows,
      normalizedDoorStockSettings,
      doorStockExportOptions,
    );
  }, [filteredDoorStockRows, normalizedDoorStockSettings, doorStockExportOptions]);

  const handleDownloadPdf = useCallback(() => {
    downloadIncentivePdf(filteredRows, filteredDistributionRows, { dateFrom, dateTo, search });
  }, [filteredRows, filteredDistributionRows, dateFrom, dateTo, search]);

  const handleDownloadCostPdf = useCallback(() => {
    downloadIncentiveCostPdf(filteredRows, { dateFrom, dateTo, search });
  }, [filteredRows, dateFrom, dateTo, search]);

  const incentiveExportOptions = useMemo(
    () => ({
      dateFrom: incentiveFilters.dateFrom,
      dateTo: incentiveFilters.dateTo,
      search: incentiveFilters.search,
      stockId: incentiveFilters.stockId,
      brandLabel: incentiveFilters.brand
        ? formatBrandLabel(brandByKey[incentiveFilters.brand]) ||
          brandByKey[incentiveFilters.brand]?.label ||
          incentiveFilters.brand
        : '',
    }),
    [incentiveFilters, brandByKey],
  );

  const specialPriceExportOptions = useMemo(
    () => ({
      dateFrom: specialPriceFilters.dateFrom,
      dateTo: specialPriceFilters.dateTo,
      search: specialPriceFilters.search,
      shop: specialPriceFilters.shop,
      stockId: specialPriceFilters.stockId,
      brandLabel: specialPriceFilters.brand
        ? formatBrandLabel(brandByKey[specialPriceFilters.brand]) ||
          brandByKey[specialPriceFilters.brand]?.label ||
          specialPriceFilters.brand
        : '',
    }),
    [specialPriceFilters, brandByKey],
  );

  const openIncentiveFilterPopup = useCallback(() => {
    setIncentiveFilterDraft(incentiveFilters);
    setIncentiveFilterOpen(true);
  }, [incentiveFilters]);

  const closeIncentiveFilterPopup = useCallback(() => {
    setIncentiveFilterOpen(false);
  }, []);

  const applyIncentiveFilters = useCallback(() => {
    setIncentiveFilters(incentiveFilterDraft);
    setIncentiveFilterOpen(false);
  }, [incentiveFilterDraft]);

  const clearIncentiveFilters = useCallback(() => {
    setIncentiveFilterDraft(EMPTY_INCENTIVE_FILTERS);
    setIncentiveFilters(EMPTY_INCENTIVE_FILTERS);
    setIncentiveFilterOpen(false);
  }, []);

  const openSpecialPriceFilterPopup = useCallback(() => {
    setSpecialPriceFilterDraft(specialPriceFilters);
    setSpecialPriceFilterOpen(true);
  }, [specialPriceFilters]);

  const closeSpecialPriceFilterPopup = useCallback(() => {
    setSpecialPriceFilterOpen(false);
  }, []);

  const applySpecialPriceFilters = useCallback(() => {
    setSpecialPriceFilters(specialPriceFilterDraft);
    setSpecialPriceFilterOpen(false);
  }, [specialPriceFilterDraft]);

  const clearSpecialPriceFilters = useCallback(() => {
    setSpecialPriceFilterDraft(EMPTY_INCENTIVE_FILTERS);
    setSpecialPriceFilters(EMPTY_INCENTIVE_FILTERS);
    setSpecialPriceFilterOpen(false);
  }, []);

  const handleDownloadBasicIncentivePdf = useCallback(() => {
    downloadBasicIncentivePdf(groupedBasicIncentiveRows, incentiveExportOptions);
  }, [groupedBasicIncentiveRows, incentiveExportOptions]);

  const handleDownloadBasicIncentiveExcel = useCallback(() => {
    downloadBasicIncentiveExcel(groupedBasicIncentiveRows, incentiveExportOptions);
  }, [groupedBasicIncentiveRows, incentiveExportOptions]);

  const handleDownloadStockWiseIncentivePdf = useCallback(() => {
    downloadStockWiseIncentivePdf(basicIncentiveRows, incentiveExportOptions);
  }, [basicIncentiveRows, incentiveExportOptions]);

  const handleDownloadStockWiseIncentiveExcel = useCallback(() => {
    downloadStockWiseIncentiveExcel(basicIncentiveRows, incentiveExportOptions);
  }, [basicIncentiveRows, incentiveExportOptions]);

  const handleDownloadCalculatorPdf = useCallback(() => {
    downloadIncentiveCalculatorPdf(filteredSpecialPriceDistributionRows, specialPriceExportOptions);
  }, [filteredSpecialPriceDistributionRows, specialPriceExportOptions]);

  const handleDownloadForCompany = useCallback(() => {
    downloadIncentiveCompanyReport(
      filteredSpecialPriceDistributionRows,
      customerLocationMap,
      specialPriceExportOptions,
    );
  }, [filteredSpecialPriceDistributionRows, customerLocationMap, specialPriceExportOptions]);

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !loading && tableRows.length > 0
            ? `Showing ${filteredRows.length} of ${tableRows.length} line${tableRows.length === 1 ? '' : 's'}.`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Stock ID, shop, bag type, invoice, amounts…"
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
        <div className="flex items-end">
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || (filteredRows.length === 0 && filteredDistributionRows.length === 0)}
            onClick={handleDownloadPdf}
          >
            Download PDF
          </button>
        </div>
      </TableFiltersBar>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Cost Calculator for Loads</h2>
          <p className="mt-1 text-sm text-slate-500">
            Stock load pricing by bag type — per-bag price, transport, margin, and total cost per bag.
          </p>
        </div>
        <button
          type="button"
          className={downloadPdfButtonClass}
          disabled={loading || filteredRows.length === 0}
          onClick={handleDownloadCostPdf}
        >
          Download PDF
        </button>
      </div>

      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : tableRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No stock loads yet. Add loads on the Loads page to see incentive data here.
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No rows match your search or filters.
          </p>
        ) : (
          pagedLoadRows.map((r) => {
            const brand = brandByKey[r.brandKey];
            return (
              <MobileRowCard
                key={r.rowKey}
                title={r.brandLabel}
                subtitle={r.date}
                badge={
                  <span
                    className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                  >
                    {r.bags.toLocaleString()} bags
                  </span>
                }
                fields={[
                  { label: 'Per bag', value: moneyOrDashStyled(r.perBagCost) },
                  { label: 'Cut-off', value: moneyOrDashStyled(r.cutOffPrice) },
                  { label: 'Transport', value: moneyOrDashStyled(r.transportPerBag) },
                  { label: 'Margin', value: moneyOrDashStyled(r.margin) },
                  { label: 'Total / bag', value: moneyOrDashStyled(r.unloadingPrice) },
                ]}
                onClick={() => setDetailRow(r)}
              />
            );
          })
        )}
      </div>

      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
              <th className="whitespace-nowrap px-4 py-3">Bag type</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Bags</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Per bag price</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Cut-off price (per bag)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Transport </th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Margin</th>
              <th className="whitespace-nowrap bg-gradient-to-br from-indigo-50 via-violet-50 to-sky-50 px-4 py-3 text-right font-bold text-indigo-900 ring-1 ring-inset ring-indigo-200/50">
                Total cost per bag
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No stock loads yet. Add loads on the Loads page to see incentive data here.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No rows match your search or filters.
                </td>
              </tr>
            ) : (
              pagedLoadRows.map((r) => {
                const brand = brandByKey[r.brandKey];
                return (
                  <tr
                    key={r.rowKey}
                    {...detailRowAttrs(() => setDetailRow(r), 'bg-white hover:bg-slate-50/80')}
                    aria-label={`Incentive ${r.stockId} ${r.brandLabel} details`}
                  >
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                      {r.date}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.brandLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{moneyOrDashStyled(r.perBagCost)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{moneyOrDashStyled(r.cutOffPrice)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{moneyOrDashStyled(r.transportPerBag)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{moneyOrDashStyled(r.margin)}</td>
                    <td className="whitespace-nowrap bg-gradient-to-br from-indigo-50 via-violet-50 to-sky-50 px-4 py-3 text-right text-base font-bold tabular-nums text-indigo-950 ring-1 ring-inset ring-indigo-200/40">
                      {moneyOrDashStyled(r.unloadingPrice)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && filteredRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                <td colSpan={2} className="px-4 py-3">
                  Totals (filtered)
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{filteredTotals.bags.toLocaleString()}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">
                  {filteredTotals.hasTransport ? moneyOrDashStyled(filteredTotals.transportCost) : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {filteredTotals.hasMargin ? moneyOrDashStyled(filteredTotals.margin) : '—'}
                </td>
                <td className="bg-gradient-to-br from-indigo-50 via-violet-50 to-sky-50 px-4 py-3 ring-1 ring-inset ring-indigo-200/40" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {!loading && tableRows.length > 0 ? (
        <TablePaginationBar
          page={loadPagination.page}
          totalPages={loadPagination.totalPages}
          pageSize={loadPagination.pageSize}
          totalCount={filteredRows.length}
          onPageChange={loadPagination.setPage}
          onPageSizeChange={loadPagination.setPageSize}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Incentive Calculator</h2>
          <p className="mt-1 text-sm text-slate-500">
            Incentive on all bags received per stock load (not sold allocations).
          </p>
          {!loading && loadBasicIncentiveRows.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500">
              Showing {basicIncentiveRows.length} of {loadBasicIncentiveRows.length} line
              {loadBasicIncentiveRows.length === 1 ? '' : 's'}
              {activeIncentiveFilterCount > 0 ? ` · ${activeIncentiveFilterCount} filter${activeIncentiveFilterCount === 1 ? '' : 's'} active` : ''}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${downloadPdfButtonClass}${activeIncentiveFilterCount > 0 ? ' border-indigo-200 bg-indigo-50 text-indigo-800 ring-indigo-100' : ''}`}
            disabled={loading}
            onClick={openIncentiveFilterPopup}
          >
            Filters
            {activeIncentiveFilterCount > 0 ? (
              <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {activeIncentiveFilterCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || basicIncentiveRows.length === 0}
            onClick={handleDownloadBasicIncentivePdf}
          >
            Download PDF
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || basicIncentiveRows.length === 0}
            onClick={handleDownloadBasicIncentiveExcel}
          >
            Download Excel
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || basicIncentiveRows.length === 0}
            onClick={handleDownloadStockWiseIncentivePdf}
          >
            Stock wise PDF
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || basicIncentiveRows.length === 0}
            onClick={handleDownloadStockWiseIncentiveExcel}
          >
            Stock wise Excel
          </button>
        </div>
      </div>

      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : loadBasicIncentiveRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No stock loads yet. Add loads on the Loads page to see incentive data here.
          </p>
        ) : basicIncentiveRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No rows match your search or filters.
          </p>
        ) : (
          pagedBasicRows.map((r) => {
            if (r.type === 'stockTotal') {
              return (
                <MobileRowCard
                  key={r.rowKey}
                  title={`${r.stockId} total`}
                  fields={[
                    { label: 'Bags', value: r.bags.toLocaleString() },
                    {
                      label: 'Total incentive',
                      value: r.hasTotalIncentive ? moneyOrDashStyled(r.basicTotalIncentive) : '—',
                    },
                  ]}
                />
              );
            }
            const brand = brandByKey[r.brandKey];
            return (
              <MobileRowCard
                key={r.rowKey}
                title={r.stockId}
                subtitle={r.date}
                badge={
                  <span
                    className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                  >
                    {r.brandLabel}
                  </span>
                }
                fields={[
                  { label: 'Invoice', value: r.invoiceNumber ?? '—' },
                  { label: 'Bags', value: r.bags.toLocaleString() },
                  { label: 'Cost / bag', value: moneyOrDashStyled(r.totalCostPerBag) },
                  { label: 'Inc. / bag', value: moneyOrDashStyled(r.basicIncentivePerBag) },
                  { label: 'Total inc.', value: moneyOrDashStyled(r.basicTotalIncentive) },
                ]}
              />
            );
          })
        )}
      </div>

      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[1480px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
              <th className="whitespace-nowrap px-4 py-3">StockID</th>
              <th className="whitespace-nowrap px-4 py-3">Invoice number</th>
              <th className="whitespace-nowrap px-4 py-3">Bag type</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">No. Bags</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Bag Price in Invoice</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Transport Cost</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Cut-off price (per bag)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Total Cost per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Incentive per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Total Incentive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : loadBasicIncentiveRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                  No stock loads yet. Add loads on the Loads page to see incentive data here.
                </td>
              </tr>
            ) : basicIncentiveRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                  No rows match your search or filters.
                </td>
              </tr>
            ) : (
              pagedBasicRows.map((r) => {
                if (r.type === 'stockTotal') {
                  return (
                    <tr
                      key={r.rowKey}
                      className="border-t border-slate-200 bg-slate-100/90 font-semibold text-slate-900"
                    >
                      <td className={`px-4 py-3 ${stickyFirstTdMuted}`} />
                      <td colSpan={2} className="px-4 py-3">
                        {r.stockId} total
                      </td>
                      <td className="px-4 py-3" />
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {r.hasTotalIncentive ? moneyOrDashStyled(r.basicTotalIncentive) : '—'}
                      </td>
                    </tr>
                  );
                }

                const brand = brandByKey[r.brandKey];
                return (
                  <tr key={r.rowKey} className="bg-white">
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                      {r.date}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{r.stockId}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-800">{r.invoiceNumber ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.brandLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.perBagPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.transportPerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.cutOffPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.totalCostPerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.basicIncentivePerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.basicTotalIncentive)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && basicIncentiveRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                <td colSpan={4} className="px-4 py-3">
                  Grand total (filtered)
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{basicIncentiveTotals.bags.toLocaleString()}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">
                  {basicIncentiveTotals.hasTotalIncentive
                    ? moneyOrDashStyled(basicIncentiveTotals.totalIncentive)
                    : '—'}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {!loading && basicIncentiveRows.length > 0 ? (
        <TablePaginationBar
          page={basicPagination.page}
          totalPages={basicPagination.totalPages}
          pageSize={basicPagination.pageSize}
          totalCount={groupedBasicIncentiveRows.length}
          onPageChange={basicPagination.setPage}
          onPageSizeChange={basicPagination.setPageSize}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Special Price Calculator</h2>
          {!loading && distributionRows.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500">
              Showing {filteredSpecialPriceDistributionRows.length} of {distributionRows.length} line
              {distributionRows.length === 1 ? '' : 's'}
              {activeSpecialPriceFilterCount > 0
                ? ` · ${activeSpecialPriceFilterCount} filter${activeSpecialPriceFilterCount === 1 ? '' : 's'} active`
                : ''}
              .
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${downloadPdfButtonClass}${activeSpecialPriceFilterCount > 0 ? ' border-indigo-200 bg-indigo-50 text-indigo-800 ring-indigo-100' : ''}`}
            disabled={loading}
            onClick={openSpecialPriceFilterPopup}
          >
            Filters
            {activeSpecialPriceFilterCount > 0 ? (
              <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {activeSpecialPriceFilterCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || filteredSpecialPriceDistributionRows.length === 0}
            onClick={handleDownloadCalculatorPdf}
          >
            Download PDF
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || filteredSpecialPriceDistributionRows.length === 0}
            onClick={handleDownloadForCompany}
          >
            Download for Company
          </button>
        </div>
      </div>

      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : distributionRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No shop distributions yet. Add credit bills on the Bills page to see allocations here.
          </p>
        ) : filteredSpecialPriceDistributionRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No rows match your search or filters.
          </p>
        ) : (
          pagedDistributionRows.map((r) => {
            if (r.type === 'shopTotal') {
              return (
                <MobileRowCard
                  key={r.rowKey}
                  title={`${r.shop} total`}
                  fields={[
                    { label: 'Bags', value: r.bags.toLocaleString() },
                    {
                      label: 'Total difference',
                      value: r.hasTotalDifference ? moneyOrDashStyled(r.totalDifference) : '—',
                    },
                  ]}
                />
              );
            }
            const brand = brandByKey[r.brandKey];
            return (
              <MobileRowCard
                key={r.rowKey}
                title={r.shop}
                subtitle={r.date}
                badge={
                  <span
                    className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                  >
                    {r.brandLabel}
                  </span>
                }
                fields={[
                  { label: 'Bags', value: r.bags.toLocaleString() },
                  { label: 'Cut-off', value: moneyOrDashStyled(r.cutOffPrice) },
                  { label: 'Sold price', value: moneyOrDashStyled(r.sellingPricePerBag) },
                  { label: 'Diff / bag', value: moneyOrDashStyled(r.differencePerBag) },
                  { label: 'Total diff', value: moneyOrDashStyled(r.totalDifference) },
                ]}
              />
            );
          })
        )}
      </div>

      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
              <th className="whitespace-nowrap px-4 py-3">Shop Name</th>
              <th className="whitespace-nowrap px-4 py-3">Bag Type</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Cut-off price</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Sold price</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Different per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Total difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : distributionRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No shop distributions yet. Add credit bills on the Bills page to see allocations here.
                </td>
              </tr>
            ) : filteredSpecialPriceDistributionRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No rows match your search or filters.
                </td>
              </tr>
            ) : (
              pagedDistributionRows.map((r) => {
                if (r.type === 'shopTotal') {
                  return (
                    <tr
                      key={r.rowKey}
                      className="border-t border-slate-200 bg-slate-100/90 font-semibold text-slate-900"
                    >
                      <td className={`px-4 py-3 ${stickyFirstTdMuted}`} />
                      <td colSpan={2} className="px-4 py-3">
                        {r.shop} total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {r.hasTotalDifference ? moneyOrDashStyled(r.totalDifference) : '—'}
                      </td>
                    </tr>
                  );
                }

                const brand = brandByKey[r.brandKey];
                return (
                  <tr key={r.rowKey} className="bg-white">
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                      {r.date}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-800">{r.shop}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.brandLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.cutOffPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.sellingPricePerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.differencePerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.totalDifference)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && filteredSpecialPriceDistributionRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                <td colSpan={3} className="px-4 py-3">
                  Grand total (filtered)
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{distributionTotals.bags.toLocaleString()}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">
                  {distributionTotals.hasTotalDifference
                    ? moneyOrDashStyled(distributionTotals.totalDifference)
                    : '—'}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {!loading && filteredSpecialPriceDistributionRows.length > 0 ? (
        <TablePaginationBar
          page={distributionPagination.page}
          totalPages={distributionPagination.totalPages}
          pageSize={distributionPagination.pageSize}
          totalCount={groupedDistributionRows.length}
          onPageChange={distributionPagination.setPage}
          onPageSizeChange={distributionPagination.setPageSize}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Invoice Discount Promotions</h2>
          {!loading ? (
            <p className="mt-1 text-sm text-slate-500">
              Showing {filteredInvoiceDiscountRows.length} discount
              {filteredInvoiceDiscountRows.length === 1 ? '' : 's'}
              {filteredInvoiceDiscountRows.length > 0
                ? ` · Total ${money(invoiceDiscountTotal)} deducted from customer ledger and cashier`
                : ''}
              .
            </p>
          ) : null}
        </div>
      </div>

      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : filteredInvoiceDiscountRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No invoice discount promotions yet. Record them on the Promotions page.
          </p>
        ) : (
          pagedInvoiceDiscountRows.map((r) => (
            <MobileRowCard
              key={r.id}
              title={r.customerName}
              subtitle={r.date}
              fields={[
                { label: 'Invoice', value: r.invoiceNumber },
                { label: 'Type', value: r.discountMode },
                { label: 'Discount', value: money(r.discountAmount) },
                { label: 'Reason', value: r.reason },
              ]}
            />
          ))
        )}
      </div>

      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="whitespace-nowrap px-4 py-3 font-mono">Invoice</th>
              <th className="whitespace-nowrap px-4 py-3">Discount type</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Value</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Total discount</th>
              <th className="px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : filteredInvoiceDiscountRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  No invoice discount promotions yet. Record them on the Promotions page.
                </td>
              </tr>
            ) : (
              pagedInvoiceDiscountRows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>{r.date}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{r.customerName}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.invoiceNumber}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.discountMode}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(r.discountValue)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold text-emerald-800">
                    {money(r.discountAmount)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && filteredInvoiceDiscountRows.length > 0 ? (
        <TablePaginationBar
          page={invoiceDiscountPagination.page}
          totalPages={invoiceDiscountPagination.totalPages}
          pageSize={invoiceDiscountPagination.pageSize}
          totalCount={filteredInvoiceDiscountRows.length}
          onPageChange={invoiceDiscountPagination.setPage}
          onPageSizeChange={invoiceDiscountPagination.setPageSize}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Door Step Transport</h2>
          {!loading ? (
            <p className="mt-1 text-sm text-slate-500">
              Showing {filteredDoorStockRows.length} door step line
              {filteredDoorStockRows.length === 1 ? '' : 's'}
              {filteredDoorStockRows.length > 0
                ? ` · Total transport ${money(doorStockTotals.amount)}`
                : ''}
              .
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditDetails() ? (
            <button
              type="button"
              onClick={() => setDoorStockSettingsOpen(true)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50"
            >
              Settings
            </button>
          ) : null}
          <button
            type="button"
            disabled={loading || filteredDoorStockRows.length === 0}
            onClick={handleDownloadDoorStockPdf}
            className={downloadPdfButtonClass}
          >
            Download PDF
          </button>
          <button
            type="button"
            disabled={loading || filteredDoorStockRows.length === 0}
            onClick={handleDownloadDoorStockExcel}
            className={downloadPdfButtonClass}
          >
            Download Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-md ring-1 ring-slate-100">
        <label className={filterLabelNarrow}>
          From date
          <input
            type="date"
            value={doorStockFilters.dateFrom}
            onChange={(e) => setDoorStockFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          To date
          <input
            type="date"
            value={doorStockFilters.dateTo}
            onChange={(e) => setDoorStockFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className={filterControl}
          />
        </label>
        <label className={filterLabel}>
          Bag type
          <select
            value={doorStockFilters.brand}
            onChange={(e) => setDoorStockFilters((f) => ({ ...f, brand: e.target.value }))}
            className={filterControl}
          >
            <option value="">All bag types</option>
            {brands.map((b) => (
              <option key={b.key} value={b.key}>
                {formatBrandLabel(b) || b.label}
              </option>
            ))}
          </select>
        </label>
        {(doorStockFilters.dateFrom || doorStockFilters.dateTo || doorStockFilters.brand) && (
          <button
            type="button"
            onClick={() => setDoorStockFilters(EMPTY_DOOR_STOCK_FILTERS)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : filteredDoorStockRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            {doorStockRows.length === 0
              ? 'No door step loads yet. Mark a PO as door step and record the load on the Loads page.'
              : 'No door step rows match your date or bag type filters.'}
          </p>
        ) : (
          pagedDoorStockRows.map((r) => {
            const brand = brandByKey[r.brandKey];
            return (
              <MobileRowCard
                key={r.rowKey}
                title={r.invoiceNumber}
                subtitle={r.invoiceDate}
                fields={[
                  { label: 'Vehicle', value: r.vehicleNumber },
                  {
                    label: 'Bag type',
                    value: (
                      <span
                        className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.brandLabel}
                      </span>
                    ),
                  },
                  { label: 'Quantity', value: r.quantity.toLocaleString() },
                  { label: 'T/P rate', value: moneyOrDashStyled(r.tpRate) },
                  { label: 'From', value: r.locationFrom },
                  { label: 'To', value: r.locationTo },
                  { label: 'Amount', value: moneyOrDashStyled(r.amount) },
                ]}
              />
            );
          })
        )}
      </div>

      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[1200px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Invoice date</th>
              <th className="whitespace-nowrap px-4 py-3 font-mono">Invoice number</th>
              <th className="whitespace-nowrap px-4 py-3">Vehicle number</th>
              <th className="whitespace-nowrap px-4 py-3">Bag type</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Quantity</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">T/P rate</th>
              <th className="whitespace-nowrap px-4 py-3">From</th>
              <th className="whitespace-nowrap px-4 py-3">To</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : filteredDoorStockRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  {doorStockRows.length === 0
                    ? 'No door step loads yet. Mark a PO as door step and record the load on the Loads page.'
                    : 'No door step rows match your date or bag type filters.'}
                </td>
              </tr>
            ) : (
              pagedDoorStockRows.map((r) => {
                const brand = brandByKey[r.brandKey];
                return (
                  <tr key={r.rowKey} className="hover:bg-slate-50/80">
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>
                      {r.invoiceDate}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.invoiceNumber}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.vehicleNumber}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.brandLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {r.quantity.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.tpRate)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.locationFrom}</td>
                    <td className="px-4 py-3 text-slate-700">{r.locationTo}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold">
                      {moneyOrDashStyled(r.amount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && filteredDoorStockRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                <td colSpan={4} className={`px-4 py-3 ${stickyFirstTdMuted}`}>
                  Total (filtered)
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {doorStockTotals.quantity.toLocaleString()}
                </td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {money(doorStockTotals.amount)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {!loading && filteredDoorStockRows.length > 0 ? (
        <TablePaginationBar
          page={doorStockPagination.page}
          totalPages={doorStockPagination.totalPages}
          pageSize={doorStockPagination.pageSize}
          totalCount={filteredDoorStockRows.length}
          onPageChange={doorStockPagination.setPage}
          onPageSizeChange={doorStockPagination.setPageSize}
        />
      ) : null}

      <DoorStockTransportSettingsModal
        open={doorStockSettingsOpen}
        brands={brands}
        settings={doorStockTransportSettings}
        onClose={() => setDoorStockSettingsOpen(false)}
        onSaved={(next) => setDoorStockTransportSettings(next)}
      />

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant="incentive"
        onClose={() => setDetailRow(null)}
      />

      <DistributionFilterModal
        brands={brands}
        open={incentiveFilterOpen}
        title="Filter Incentive Calculator"
        description="Narrow rows by load date, bag type, stock ID, invoice, or free-text search."
        titleId="incentive-filter-modal-title"
        draft={incentiveFilterDraft}
        setDraft={setIncentiveFilterDraft}
        shopOptions={incentiveShopOptions}
        showShopFilter={false}
        onApply={applyIncentiveFilters}
        onClear={clearIncentiveFilters}
        onClose={closeIncentiveFilterPopup}
      />

      <DistributionFilterModal
        brands={brands}
        open={specialPriceFilterOpen}
        title="Filter Special Price Calculator"
        description="Narrow rows by date, shop, bag type, stock ID, or free-text search."
        titleId="special-price-filter-modal-title"
        draft={specialPriceFilterDraft}
        setDraft={setSpecialPriceFilterDraft}
        shopOptions={incentiveShopOptions}
        onApply={applySpecialPriceFilters}
        onClear={clearSpecialPriceFilters}
        onClose={closeSpecialPriceFilterPopup}
      />
    </div>
  );
}
