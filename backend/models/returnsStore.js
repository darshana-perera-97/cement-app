const fs = require('fs').promises;
const path = require('path');
const { toNonNegNumber } = require('./stocksStore');
const { toNonNegMoney } = require('./customersStore');
const { bagsField, emptyBrandMap } = require('./bagProducts');

const RETURNS_FILE = path.join(__dirname, '..', 'data', 'returns.json');

const RETURN_KINDS = {
  ITEM_RETURN: 'item_return',
  DAMAGE: 'damage',
  PRICE_CHANGE: 'price_change',
};

const PRICE_DIRECTIONS = {
  UP: 'up',
  DOWN: 'down',
};

const SETTLEMENTS = {
  CASH: 'cash',
  CREDIT_NOTE: 'credit_note',
  DAMAGE: 'damage',
};

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function returnKind(row) {
  const k = String(row?.kind ?? '').trim();
  if (k === RETURN_KINDS.DAMAGE || k === RETURN_KINDS.PRICE_CHANGE) return k;
  return RETURN_KINDS.ITEM_RETURN;
}

function isItemReturn(row) {
  return returnKind(row) === RETURN_KINDS.ITEM_RETURN;
}

function isDamage(row) {
  return returnKind(row) === RETURN_KINDS.DAMAGE;
}

function isPriceChange(row) {
  return returnKind(row) === RETURN_KINDS.PRICE_CHANGE;
}

function returnAmount(row) {
  return toNonNegMoney(row?.amount);
}

function priceDirection(row) {
  return String(row?.direction ?? '').trim() === PRICE_DIRECTIONS.UP
    ? PRICE_DIRECTIONS.UP
    : PRICE_DIRECTIONS.DOWN;
}

function settlementOf(row) {
  const s = String(row?.settlement ?? '').trim();
  if (s === SETTLEMENTS.CASH) return SETTLEMENTS.CASH;
  if (s === SETTLEMENTS.DAMAGE) return SETTLEMENTS.DAMAGE;
  return SETTLEMENTS.CREDIT_NOTE;
}

/** Invoice return that goes back into sellable brand stock. */
function isSellableItemReturn(row) {
  return isItemReturn(row) && settlementOf(row) !== SETTLEMENTS.DAMAGE;
}

/** Invoice return settled as damage — bags go to the single Damages stock item. */
function isInvoiceDamage(row) {
  return isItemReturn(row) && settlementOf(row) === SETTLEMENTS.DAMAGE;
}

function isDamageStockRow(row) {
  return isDamage(row) || isInvoiceDamage(row);
}

function returnMatchesCustomer(row, customer) {
  if (!row || !customer) return false;
  const id = String(row.customerId ?? '').trim();
  if (id && id === String(customer.id ?? '').trim()) return true;
  const a = String(row.customerName ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const b = String(customer.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return Boolean(a && b && a === b);
}

/** Signed ledger delta for this customer: negative = credit (reduces owed). */
function returnLedgerDeltaForCustomer(row, customer) {
  if (!returnMatchesCustomer(row, customer)) return 0;
  const amount = returnAmount(row);
  if (amount <= 0) return 0;
  const kind = returnKind(row);
  if (kind === RETURN_KINDS.ITEM_RETURN) return -amount;
  if (kind === RETURN_KINDS.PRICE_CHANGE) {
    return priceDirection(row) === PRICE_DIRECTIONS.UP ? amount : -amount;
  }
  return 0;
}

function sumItemReturnForBill(returnsRows, billId) {
  const id = String(billId ?? '').trim();
  if (!id) return 0;
  let sum = 0;
  for (const row of Array.isArray(returnsRows) ? returnsRows : []) {
    if (!isItemReturn(row)) continue;
    if (String(row.billId ?? '').trim() !== id) continue;
    sum += returnAmount(row);
  }
  return roundMoney(sum);
}

function sumReturnedBagsForBill(returnsRows, billId, keys) {
  const t = emptyBrandMap(keys);
  const id = String(billId ?? '').trim();
  if (!id) return t;
  for (const row of Array.isArray(returnsRows) ? returnsRows : []) {
    if (!isItemReturn(row)) continue;
    if (String(row.billId ?? '').trim() !== id) continue;
    for (const k of keys) {
      t[k] += toNonNegNumber(row[bagsField(k)]);
    }
  }
  return t;
}

function sumItemReturnBagsByBrand(returnsRows, keys) {
  const t = emptyBrandMap(keys);
  for (const row of Array.isArray(returnsRows) ? returnsRows : []) {
    if (!isSellableItemReturn(row)) continue;
    for (const k of keys) {
      t[k] += toNonNegNumber(row[bagsField(k)]);
    }
  }
  return t;
}

function sumDamageBagsByBrand(returnsRows, keys) {
  const t = emptyBrandMap(keys);
  for (const row of Array.isArray(returnsRows) ? returnsRows : []) {
    if (!isDamage(row)) continue;
    for (const k of keys) {
      t[k] += toNonNegNumber(row[bagsField(k)]);
    }
  }
  return t;
}

/** All damaged bags in one stock item, regardless of brand. */
function sumDamageStockTotal(returnsRows, keys) {
  let n = 0;
  const list = Array.isArray(keys) ? keys : [];
  for (const row of Array.isArray(returnsRows) ? returnsRows : []) {
    if (!isDamageStockRow(row)) continue;
    for (const k of list) {
      n += toNonNegNumber(row[bagsField(k)]);
    }
  }
  return n;
}

function aggregateBagsByDate(returnsRows, keys, predicate) {
  const map = {};
  for (const row of Array.isArray(returnsRows) ? returnsRows : []) {
    if (!predicate(row)) continue;
    const d = String(row.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!map[d]) map[d] = emptyBrandMap(keys);
    for (const k of keys) {
      map[d][k] += toNonNegNumber(row[bagsField(k)]);
    }
  }
  return map;
}

function aggregateItemReturnInsByDate(returnsRows, keys) {
  return aggregateBagsByDate(returnsRows, keys, isSellableItemReturn);
}

function aggregateDamageOutsByDate(returnsRows, keys) {
  return aggregateBagsByDate(returnsRows, keys, isDamage);
}

function nextPrefixedNumber(rows, field, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let max = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const m = String(row?.[field] ?? '').trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function suggestNextReturnInvoiceNumber(rows) {
  return nextPrefixedNumber(rows, 'returnInvoiceNumber', 'RET');
}

function suggestNextDamageInvoiceNumber(rows) {
  return nextPrefixedNumber(rows, 'damageInvoiceNumber', 'DMG');
}

function invoiceNumberTaken(rows, field, value, exceptId = '') {
  const want = String(value ?? '').trim().toLowerCase();
  if (!want) return false;
  const skip = String(exceptId ?? '').trim();
  return (Array.isArray(rows) ? rows : []).some((row) => {
    if (skip && String(row.id ?? '').trim() === skip) return false;
    return String(row?.[field] ?? '').trim().toLowerCase() === want;
  });
}

async function readReturns() {
  try {
    const raw = await fs.readFile(RETURNS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeReturns(records) {
  await fs.mkdir(path.dirname(RETURNS_FILE), { recursive: true });
  await fs.writeFile(RETURNS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

module.exports = {
  RETURNS_FILE,
  RETURN_KINDS,
  PRICE_DIRECTIONS,
  SETTLEMENTS,
  readReturns,
  writeReturns,
  returnKind,
  isItemReturn,
  isSellableItemReturn,
  isInvoiceDamage,
  isDamageStockRow,
  isDamage,
  isPriceChange,
  returnAmount,
  priceDirection,
  settlementOf,
  returnMatchesCustomer,
  returnLedgerDeltaForCustomer,
  sumItemReturnForBill,
  sumReturnedBagsForBill,
  sumItemReturnBagsByBrand,
  sumDamageBagsByBrand,
  sumDamageStockTotal,
  aggregateItemReturnInsByDate,
  aggregateDamageOutsByDate,
  suggestNextReturnInvoiceNumber,
  suggestNextDamageInvoiceNumber,
  invoiceNumberTaken,
};
