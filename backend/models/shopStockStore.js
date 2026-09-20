const fs = require('fs').promises;
const path = require('path');

const SHOP_STOCK_FILE = path.join(__dirname, '..', 'data', 'shopStocks.json');

const MAX_UPDATE_DISTANCE_M = 250;

function toNonNegInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const y1 = Number(lat1);
  const x1 = Number(lng1);
  const y2 = Number(lat2);
  const x2 = Number(lng2);
  if (![y1, x1, y2, x2].every(Number.isFinite)) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(y2 - y1);
  const dLng = toRad(x2 - x1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(y1)) * Math.cos(toRad(y2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function readShopStocks() {
  try {
    const raw = await fs.readFile(SHOP_STOCK_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeShopStocks(records) {
  await fs.mkdir(path.dirname(SHOP_STOCK_FILE), { recursive: true });
  await fs.writeFile(SHOP_STOCK_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function normalizeShopStock(row) {
  if (!row || typeof row !== 'object') return null;
  const shopId = String(row.shopId ?? row.id ?? '').trim();
  if (!shopId) return null;
  const stockSrc = row.stock && typeof row.stock === 'object' ? row.stock : {};
  const stock = {};
  for (const [key, value] of Object.entries(stockSrc)) {
    const k = String(key || '').trim();
    if (!k) continue;
    stock[k] = toNonNegInt(value);
  }
  return {
    shopId,
    customerId: String(row.customerId ?? '').trim(),
    stock,
    lastUnloadId: String(row.lastUnloadId ?? '').trim(),
    lastUnloadDate: String(row.lastUnloadDate ?? '').trim(),
    updatedAt: String(row.updatedAt ?? '').trim(),
    updatedBy: String(row.updatedBy ?? '').trim(),
    lat: Number(row.lat),
    lng: Number(row.lng),
  };
}

function findShopStock(records, shopId) {
  const id = String(shopId ?? '').trim();
  if (!id) return null;
  const row = records.find((r) => String(r.shopId ?? r.id ?? '').trim() === id);
  return row ? normalizeShopStock(row) : null;
}

function recordTime(row) {
  const date = String(row?.date ?? '').trim();
  const created = String(row?.approvedAt || row?.createdAt || '').trim();
  return `${date}|${created}`;
}

function matchesCustomer(row, customer) {
  if (!row || !customer) return false;
  const cid = String(customer.id ?? '').trim();
  if (cid && String(row.customerId ?? '').trim() === cid) return true;
  const left = String(row.customerName ?? '')
    .trim()
    .toLowerCase();
  const right = String(customer.name ?? '')
    .trim()
    .toLowerCase();
  return Boolean(left && right && left === right);
}

function findLastUnloadRecord(unloads, bills, customer) {
  const unloadMatches = (Array.isArray(unloads) ? unloads : []).filter(
    (row) => matchesCustomer(row, customer) && String(row.status || '').trim().toLowerCase() === 'approved',
  );
  unloadMatches.sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
  if (unloadMatches[0]) return { kind: 'unload', row: unloadMatches[0] };

  const allUnloads = (Array.isArray(unloads) ? unloads : []).filter((row) => matchesCustomer(row, customer));
  allUnloads.sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
  if (allUnloads[0]) return { kind: 'unload', row: allUnloads[0] };

  const billMatches = (Array.isArray(bills) ? bills : []).filter((row) => matchesCustomer(row, customer));
  billMatches.sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
  if (billMatches[0]) return { kind: 'bill', row: billMatches[0] };
  return null;
}

module.exports = {
  SHOP_STOCK_FILE,
  MAX_UPDATE_DISTANCE_M,
  toNonNegInt,
  distanceMeters,
  readShopStocks,
  writeShopStocks,
  normalizeShopStock,
  findShopStock,
  findLastUnloadRecord,
};
