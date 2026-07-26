const fs = require('fs').promises;
const path = require('path');
const { toNonNegNumber } = require('./stocksStore');
const { toNonNegMoney } = require('./customersStore');

const BILLS_FILE = path.join(__dirname, 'data', 'bills.json');

async function readBills() {
  try {
    const raw = await fs.readFile(BILLS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeBills(records) {
  await fs.mkdir(path.dirname(BILLS_FILE), { recursive: true });
  await fs.writeFile(BILLS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function lineTotal(bags, unitPrice) {
  const b = toNonNegNumber(bags);
  const u = toNonNegMoney(unitPrice);
  return Math.round(b * u * 100) / 100;
}

const BRAND_KEYS = ['tokyo', 'samudra', 'atlas', 'nippon'];

function emptyBrandMap() {
  return { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 };
}

/** Per-brand bag counts already sold on bills tied to this stock ID (loads file is not mutated). */
function sumBagsOnBillsForStockId(bills, stockId) {
  const sid = String(stockId ?? '').trim();
  const t = emptyBrandMap();
  if (!sid) return t;
  for (const row of bills) {
    if (String(row.stockId ?? '').trim() !== sid) continue;
    for (const k of BRAND_KEYS) {
      t[k] += toNonNegNumber(row[`${k}Bags`]);
    }
  }
  return t;
}

/** Total bags sold on all credit bills, per brand (inventory outflow). */
function sumAllBillBagsByBrand(bills) {
  const t = emptyBrandMap();
  for (const row of bills) {
    for (const k of BRAND_KEYS) {
      t[k] += toNonNegNumber(row[`${k}Bags`]);
    }
  }
  return t;
}

/** Bags sold per bill date → daily “out” totals per brand (credit sales). */
function aggregateOutsByDateFromBills(bills) {
  const map = {};
  for (const row of bills) {
    const d = String(row.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!map[d]) map[d] = emptyBrandMap();
    for (const k of BRAND_KEYS) {
      map[d][k] += toNonNegNumber(row[`${k}Bags`]);
    }
  }
  return map;
}

module.exports = {
  readBills,
  writeBills,
  lineTotal,
  aggregateOutsByDateFromBills,
  sumBagsOnBillsForStockId,
  sumAllBillBagsByBrand,
  BILLS_FILE,
};
