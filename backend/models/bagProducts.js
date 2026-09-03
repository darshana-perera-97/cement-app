const { readDistributors } = require('./distributorsStore');
const { readShopData } = require('./shopDataStore');

function toNonNegNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Legacy brand keys used in existing load/bill JSON fields. */
const LEGACY_KEYS = ['tokyo', 'samudra', 'atlas', 'nippon'];
const LEGACY_LABELS = {
  tokyo: 'Tokyo',
  samudra: 'Samudra',
  atlas: 'Atlas',
  nippon: 'Nippon',
};

function slugifyProduct(name) {
  return (
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'product'
  );
}

/** Map distributor product name (e.g. "Tokyo 50KG") → storage key. */
function productToKey(product) {
  const p = String(product || '').toLowerCase();
  if (!p) return null;
  for (const key of LEGACY_KEYS) {
    if (p === key || p.includes(key) || p.includes(LEGACY_LABELS[key].toLowerCase())) {
      return key;
    }
  }
  return slugifyProduct(product);
}

function bagsField(key) {
  return `${key}Bags`;
}

function costField(key) {
  return `${key}Cost`;
}

function cutOffPriceField(key) {
  return `${key}CutOffPrice`;
}

function unitPriceField(key) {
  return `${key}UnitPrice`;
}

function invoiceField(key) {
  return `${key}Invoice`;
}

function chequeField(key) {
  return `${key}Cheque`;
}

function convertingDateField(key) {
  return `${key}ConvertingDate`;
}

function labelForKey(key, fallbackLabel) {
  return fallbackLabel || LEGACY_LABELS[key] || key;
}

/** Unique bag products from shop catalog; falls back to distributor lists when catalog is empty. */
async function getBagProducts() {
  const shop = await readShopData();
  const catalogNames = (shop.products || []).map((p) => String(p.name ?? '').trim()).filter(Boolean);

  const names = catalogNames.length > 0 ? catalogNames : await legacyProductNamesFromDistributors();

  const seen = new Map();
  for (const label of names) {
    let key = productToKey(label);
    if (!key) continue;
    // Distinct catalog names must not collapse onto one legacy key
    // (e.g. "Tokyo Cement …" and "Tokyo Superbond …" both used to become `tokyo`).
    if (seen.has(key)) {
      key = slugifyProduct(label);
      if (!key || seen.has(key)) continue;
    }
    seen.set(key, label);
  }
  return Array.from(seen.entries()).map(([key, label]) => ({
    key,
    label,
    bagsField: bagsField(key),
    costField: costField(key),
    cutOffPriceField: cutOffPriceField(key),
    unitPriceField: unitPriceField(key),
    invoiceField: invoiceField(key),
    chequeField: chequeField(key),
    convertingDateField: convertingDateField(key),
  }));
}

async function legacyProductNamesFromDistributors() {
  const distributors = await readDistributors();
  const names = [];
  const seen = new Set();
  for (const d of distributors) {
    const products = Array.isArray(d.products) ? d.products : [];
    for (const product of products) {
      const label = String(product ?? '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(label);
    }
  }
  return names;
}

async function getBagProductKeys() {
  const products = await getBagProducts();
  return products.map((p) => p.key);
}

function emptyBrandMap(keys) {
  const map = {};
  for (const k of keys) map[k] = 0;
  return map;
}

function sumBagsOnRow(row, keys) {
  const t = emptyBrandMap(keys);
  for (const k of keys) {
    t[k] += toNonNegNumber(row[bagsField(k)]);
  }
  return t;
}

function addBagsOnRow(target, row, keys) {
  for (const k of keys) {
    target[k] += toNonNegNumber(row[bagsField(k)]);
  }
}

function parseLoadBrandFields(body, products, helpers = {}) {
  const trimStr = helpers.trimStr || ((v) => String(v ?? '').trim());
  const cutOffNumberOrUndef =
    helpers.cutOffNumberOrUndef ||
    ((v) => {
      const s = String(v ?? '').trim();
      if (!s) return undefined;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) return undefined;
      return toNonNegNumber(n);
    });

  const fields = {};
  for (const p of products) {
    fields[p.bagsField] = toNonNegNumber(body[p.bagsField]);
    fields[p.costField] = toNonNegNumber(body[p.costField]);
    const cutOff = cutOffNumberOrUndef(body[p.cutOffPriceField]);
    if (cutOff !== undefined) fields[p.cutOffPriceField] = cutOff;
    fields[p.invoiceField] = trimStr(body[p.invoiceField]);
    fields[p.chequeField] = trimStr(body[p.chequeField]);
    fields[p.convertingDateField] = trimStr(body[p.convertingDateField]).slice(0, 10);
  }
  return fields;
}

function loadTotalCost(fields, products) {
  return products.reduce((sum, p) => sum + toNonNegNumber(fields[p.costField]), 0);
}

function validateLoadBrandRefs(row, products, loadDate) {
  const missingRefs = [];
  const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  for (const p of products) {
    if (toNonNegNumber(row[p.bagsField]) >= 1) {
      if (!row[p.invoiceField]) missingRefs.push(`${p.label} invoice number`);
      if (!row[p.chequeField]) missingRefs.push(`${p.label} cheque number`);
      const convertingDate = row[p.convertingDateField];
      if (!convertingDate || !YMD_RE.test(convertingDate)) {
        row[p.convertingDateField] = loadDate;
      }
    }
  }
  return missingRefs;
}

function parseBillBagFields(body, products, lineTotalFn) {
  const fields = {};
  let totalAmount = 0;
  for (const p of products) {
    const bags = toNonNegNumber(body[p.bagsField]);
    const unitPrice = lineTotalFn ? body[p.unitPriceField] : body[p.unitPriceField];
    fields[p.bagsField] = bags;
    fields[p.unitPriceField] = unitPrice;
    if (lineTotalFn) {
      const line = lineTotalFn(bags, unitPrice);
      fields[`${p.key}Line`] = line;
      totalAmount += line;
    }
  }
  if (lineTotalFn) {
    fields.totalAmount = Math.round(totalAmount * 100) / 100;
  }
  return fields;
}

function sumBagFields(fields, products) {
  return products.reduce((sum, p) => sum + toNonNegNumber(fields[p.bagsField]), 0);
}

function brandLabelsMap(products) {
  return Object.fromEntries(products.map((p) => [p.key, p.label]));
}

function totalBagsFromRecord(record, products) {
  return products.reduce((sum, p) => sum + toNonNegNumber(record[p.bagsField]), 0);
}

/** Products with a positive bag count on this row. */
function activeBagProductsOnRecord(record, products) {
  return products
    .map((p) => ({ product: p, bags: toNonNegNumber(record[p.bagsField]) }))
    .filter(({ bags }) => bags > 0);
}

module.exports = {
  LEGACY_KEYS,
  LEGACY_LABELS,
  productToKey,
  bagsField,
  costField,
  cutOffPriceField,
  unitPriceField,
  invoiceField,
  chequeField,
  convertingDateField,
  labelForKey,
  getBagProducts,
  getBagProductKeys,
  emptyBrandMap,
  sumBagsOnRow,
  addBagsOnRow,
  parseLoadBrandFields,
  loadTotalCost,
  validateLoadBrandRefs,
  parseBillBagFields,
  sumBagFields,
  brandLabelsMap,
  totalBagsFromRecord,
  activeBagProductsOnRecord,
};
