const fs = require('fs').promises;
const path = require('path');

const SHOP_LOCATIONS_FILE = path.join(__dirname, '..', 'data', 'shopLocations.json');
const LEGACY_MAP_SHOPS_FILE = path.join(__dirname, '..', 'data', 'mapShops.json');

const SRI_LANKA = {
  west: 79.42,
  south: 5.72,
  east: 81.95,
  north: 9.98,
};

function isInSriLanka(lat, lng) {
  const y = Number(lat);
  const x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return false;
  return y >= SRI_LANKA.south && y <= SRI_LANKA.north && x >= SRI_LANKA.west && x <= SRI_LANKA.east;
}

function coordKey(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

async function readJsonArray(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeShopLocations(records) {
  await fs.mkdir(path.dirname(SHOP_LOCATIONS_FILE), { recursive: true });
  await fs.writeFile(SHOP_LOCATIONS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function normalizeMapShop(row) {
  const customerId = String(row.customerId ?? '').trim();
  const id = String(row.id ?? '').trim() || customerId;
  const name = String(row.name ?? '').trim();
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  const location = String(row.location ?? '').trim();
  if (!id || !name || !isInSriLanka(lat, lng)) return null;
  const shop = {
    id,
    name,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
  };
  if (customerId) shop.customerId = customerId;
  if (location) shop.location = location;
  const createdAt = String(row.createdAt ?? '').trim();
  const updatedAt = String(row.updatedAt ?? '').trim();
  if (createdAt) shop.createdAt = createdAt;
  if (updatedAt) shop.updatedAt = updatedAt;
  return shop;
}

function dedupeShops(rows) {
  const byCustomer = new Set();
  const byCoord = new Set();
  const shops = [];
  for (const row of rows) {
    const shop = normalizeMapShop(row);
    if (!shop) continue;
    const cid = String(shop.customerId ?? '').trim();
    if (cid) {
      if (byCustomer.has(cid)) continue;
      byCustomer.add(cid);
    }
    const key = coordKey(shop.lat, shop.lng);
    if (byCoord.has(key)) continue;
    byCoord.add(key);
    if (shops.some((s) => s.id === shop.id)) continue;
    shops.push(shop);
  }
  return shops;
}

async function readMapShops() {
  const primary = await readJsonArray(SHOP_LOCATIONS_FILE);
  if (primary) return dedupeShops(primary);
  const legacy = await readJsonArray(LEGACY_MAP_SHOPS_FILE);
  return dedupeShops(legacy || []);
}

module.exports = {
  readMapShops,
  writeMapShops: writeShopLocations,
  normalizeMapShop,
  isInSriLanka,
  coordKey,
  dedupeShops,
  SHOP_LOCATIONS_FILE,
};
