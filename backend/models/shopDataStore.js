const fs = require('fs').promises;
const path = require('path');
const { readDistributors } = require('./distributorsStore');

const SHOP_DATA_FILE = path.join(__dirname, '..', 'data', 'shopData.json');

const ACCOUNT_TYPES = ['Savings', 'Current', 'Fixed deposit', 'Other'];

const DEFAULT_SHOP_DATA = {
  shopName: '',
  addressLine1: '',
  addressLine2: '',
  contactNumber: '',
  email: '',
  ownerName: '',
  registrationNo: '',
  dealerCode: '',
  dealerTagline: '',
  deliveryNote: '',
  /** Supplier TIN for tax invoices (IRDA / VAT). */
  supplierTin: '',
  /** When true, collectors can enter cash per pending bill in one combined payment. */
  collectorSeparateBillSettlement: false,
  /** Commission % per days-to-settle bucket for collector payouts. */
  collectorCommissionRates: {
    '0-14': 0,
    '15-21': 0,
    '22-30': 0,
    '30-35': 0,
    'more than 35': 0,
  },
  bankAccounts: [],
  /** Master bag product catalog — suppliers pick from this list. */
  products: [],
  /** Door step transport invoice / export letterhead and per-brand locations. */
  doorStockTransportSettings: {
    companyName: '',
    companyAddress: '',
    companyTel: '',
    clientName: '',
    clientAddress: '',
    destination: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: '',
    bankBranch: '',
    nextInvoiceNumber: '',
    brandSettings: {},
    brandLocations: {},
  },
};

function normalizeBrandDoorStockSettings(val = {}, global = {}) {
  const trim = (s) => String(s ?? '').trim();
  const from = trim(val.from);
  const to = trim(val.to) || trim(global.destination);
  return {
    companyName: trim(val.companyName) || trim(global.companyName),
    companyAddress: trim(val.companyAddress) || trim(global.companyAddress),
    companyTel: trim(val.companyTel) || trim(global.companyTel),
    nextInvoiceNumber: trim(val.nextInvoiceNumber) || trim(global.nextInvoiceNumber),
    clientName: trim(val.clientName) || trim(global.clientName),
    clientAddress: trim(val.clientAddress) || trim(global.clientAddress),
    from,
    to,
    bankAccountName: trim(val.bankAccountName) || trim(global.bankAccountName),
    bankAccountNumber: trim(val.bankAccountNumber) || trim(global.bankAccountNumber),
    bankName: trim(val.bankName) || trim(global.bankName),
    bankBranch: trim(val.bankBranch) || trim(global.bankBranch),
  };
}

function normalizeDoorStockTransportSettings(data = {}) {
  const global = {
    companyName: String(data.companyName ?? '').trim(),
    companyAddress: String(data.companyAddress ?? '').trim(),
    companyTel: String(data.companyTel ?? '').trim(),
    clientName: String(data.clientName ?? '').trim(),
    clientAddress: String(data.clientAddress ?? '').trim(),
    destination: String(data.destination ?? '').trim(),
    bankAccountName: String(data.bankAccountName ?? '').trim(),
    bankAccountNumber: String(data.bankAccountNumber ?? '').trim(),
    bankName: String(data.bankName ?? '').trim(),
    bankBranch: String(data.bankBranch ?? '').trim(),
    nextInvoiceNumber: String(data.nextInvoiceNumber ?? '').trim(),
  };

  const brandSettings = {};
  const rawSettings =
    data.brandSettings && typeof data.brandSettings === 'object' ? data.brandSettings : {};
  for (const [key, val] of Object.entries(rawSettings)) {
    const k = String(key ?? '').trim();
    if (!k) continue;
    brandSettings[k] = normalizeBrandDoorStockSettings(val, global);
  }

  const rawLocations =
    data.brandLocations && typeof data.brandLocations === 'object' ? data.brandLocations : {};
  for (const [key, val] of Object.entries(rawLocations)) {
    const k = String(key ?? '').trim();
    if (!k) continue;
    brandSettings[k] = normalizeBrandDoorStockSettings(
      {
        ...(brandSettings[k] || {}),
        from: brandSettings[k]?.from || val?.from,
        to: brandSettings[k]?.to || val?.to,
      },
      global,
    );
  }

  const brandLocations = {};
  for (const [key, val] of Object.entries(brandSettings)) {
    brandLocations[key] = {
      from: String(val?.from ?? '').trim(),
      to: String(val?.to ?? '').trim(),
    };
  }

  return {
    ...global,
    brandSettings,
    brandLocations,
  };
}

function normalizeAccountType(value) {
  const t = String(value ?? '').trim();
  if (ACCOUNT_TYPES.includes(t)) return t;
  const lower = t.toLowerCase();
  if (lower === 'savings') return 'Savings';
  if (lower === 'current') return 'Current';
  if (lower.includes('fixed')) return 'Fixed deposit';
  if (t) return 'Other';
  return 'Savings';
}

function normalizeBankAccount(row, fallbackId) {
  const id = String(row?.id ?? fallbackId ?? '').trim();
  return {
    id: id || `bank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nickName: String(row?.nickName ?? row?.nickname ?? '').trim(),
    bank: String(row?.bank ?? '').trim(),
    accountNumber: String(row?.accountNumber ?? '').trim(),
    accountType: normalizeAccountType(row?.accountType),
    createdAt: String(row?.createdAt ?? '').trim() || new Date().toISOString(),
  };
}

function normalizeBankAccounts(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row, index) => normalizeBankAccount(row, `bank-${index}`));
}

function normalizeProduct(row, fallbackId) {
  const id = String(row?.id ?? fallbackId ?? '').trim();
  return {
    id: id || `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(row?.name ?? '').trim(),
    createdAt: String(row?.createdAt ?? '').trim() || new Date().toISOString(),
  };
}

function normalizeProducts(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const row of list) {
    const normalized = normalizeProduct(row);
    if (!normalized.name) continue;
    const key = normalized.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeCommissionRates(data) {
  const defaults = {
    '0-14': 0,
    '15-21': 0,
    '22-30': 0,
    '30-35': 0,
    'more than 35': 0,
  };
  const src = data?.collectorCommissionRates;
  if (!src || typeof src !== 'object') return defaults;
  const out = { ...defaults };
  if (src['1-14'] != null && src['0-14'] == null) {
    out['0-14'] = Math.round(Number(src['1-14']) * 100) / 100;
  }
  for (const key of Object.keys(defaults)) {
    const v = Number(src[key]);
    if (Number.isFinite(v) && v >= 0) out[key] = Math.round(v * 100) / 100;
  }
  return out;
}

function normalizeShopData(data = {}) {
  return {
    shopName: String(data.shopName ?? '').trim(),
    addressLine1: String(data.addressLine1 ?? '').trim(),
    addressLine2: String(data.addressLine2 ?? '').trim(),
    contactNumber: String(data.contactNumber ?? '').trim(),
    email: String(data.email ?? '').trim(),
    ownerName: String(data.ownerName ?? '').trim(),
    registrationNo: String(data.registrationNo ?? '').trim(),
    dealerCode: String(data.dealerCode ?? '').trim(),
    dealerTagline: String(data.dealerTagline ?? '').trim(),
    deliveryNote: String(data.deliveryNote ?? '').trim(),
    supplierTin: String(data.supplierTin ?? '').trim(),
    collectorSeparateBillSettlement: Boolean(data.collectorSeparateBillSettlement),
    collectorCommissionRates: normalizeCommissionRates(data),
    bankAccounts: normalizeBankAccounts(data.bankAccounts),
    products: normalizeProducts(data.products),
    doorStockTransportSettings: normalizeDoorStockTransportSettings(
      data.doorStockTransportSettings ?? DEFAULT_SHOP_DATA.doorStockTransportSettings,
    ),
  };
}

async function readShopDataRaw() {
  try {
    const raw = await fs.readFile(SHOP_DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_SHOP_DATA };
    throw e;
  }
}

async function seedProductsFromDistributors() {
  const distributors = await readDistributors();
  const seen = new Set();
  const rows = [];
  for (const d of distributors) {
    const products = Array.isArray(d.products) ? d.products : [];
    for (const product of products) {
      const name = String(product ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(
        normalizeProduct(
          {
            id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            name,
            createdAt: new Date().toISOString(),
          },
          null,
        ),
      );
    }
  }
  return rows;
}

async function readShopData() {
  const data = await readShopDataRaw();
  let next = normalizeShopData({ ...DEFAULT_SHOP_DATA, ...data });
  if (next.products.length === 0) {
    const seeded = await seedProductsFromDistributors();
    if (seeded.length > 0) {
      next = { ...next, products: seeded };
      await writeShopData(next);
    }
  }
  return next;
}

async function writeShopData(data) {
  const next = normalizeShopData(data);
  await fs.mkdir(path.dirname(SHOP_DATA_FILE), { recursive: true });
  await fs.writeFile(SHOP_DATA_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function validateBankAccountFields(body) {
  const nickName = String(body.nickName ?? body.nickname ?? '').trim();
  const bank = String(body.bank ?? '').trim();
  const accountNumber = String(body.accountNumber ?? '').trim();
  const accountType = normalizeAccountType(body.accountType);
  if (!nickName) return { error: 'Nick name is required' };
  if (!bank) return { error: 'Bank name is required' };
  if (!accountNumber) return { error: 'Account number is required' };
  return {
    nickName,
    bank,
    accountNumber,
    accountType,
  };
}

async function addBankAccount(body) {
  const fields = validateBankAccountFields(body);
  if (fields.error) return { error: fields.error };

  const shop = await readShopData();
  const row = normalizeBankAccount(
    {
      id: `bank-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...fields,
      createdAt: new Date().toISOString(),
    },
    null,
  );
  shop.bankAccounts = [...(shop.bankAccounts || []), row];
  await writeShopData(shop);
  return { account: row, shop };
}

async function updateBankAccount(id, body) {
  const accountId = String(id ?? '').trim();
  if (!accountId) return { error: 'Account id is required' };

  const shop = await readShopData();
  const idx = shop.bankAccounts.findIndex((a) => a.id === accountId);
  if (idx < 0) return { error: 'Bank account not found' };

  const fields = validateBankAccountFields({ ...shop.bankAccounts[idx], ...body });
  if (fields.error) return { error: fields.error };

  const updated = normalizeBankAccount(
    {
      ...shop.bankAccounts[idx],
      ...fields,
    },
    accountId,
  );
  const nextAccounts = [...shop.bankAccounts];
  nextAccounts[idx] = updated;
  shop.bankAccounts = nextAccounts;
  await writeShopData(shop);
  return { account: updated, shop };
}

async function deleteBankAccount(id) {
  const accountId = String(id ?? '').trim();
  if (!accountId) return { error: 'Account id is required' };

  const shop = await readShopData();
  const nextAccounts = shop.bankAccounts.filter((a) => a.id !== accountId);
  if (nextAccounts.length === shop.bankAccounts.length) {
    return { error: 'Bank account not found' };
  }
  shop.bankAccounts = nextAccounts;
  await writeShopData(shop);
  return { shop };
}

function validateProductFields(body) {
  const name = String(body.name ?? '').trim();
  if (!name) return { error: 'Product name is required' };
  return { name };
}

async function addProduct(body) {
  const fields = validateProductFields(body);
  if (fields.error) return { error: fields.error };

  const shop = await readShopData();
  const duplicate = shop.products.some((p) => p.name.toLowerCase() === fields.name.toLowerCase());
  if (duplicate) return { error: 'A product with this name already exists' };

  const row = normalizeProduct(
    {
      id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...fields,
      createdAt: new Date().toISOString(),
    },
    null,
  );
  shop.products = [...(shop.products || []), row];
  await writeShopData(shop);
  return { product: row, shop };
}

async function updateProduct(id, body) {
  const productId = String(id ?? '').trim();
  if (!productId) return { error: 'Product id is required' };

  const shop = await readShopData();
  const idx = shop.products.findIndex((p) => p.id === productId);
  if (idx < 0) return { error: 'Product not found' };

  const fields = validateProductFields({ ...shop.products[idx], ...body });
  if (fields.error) return { error: fields.error };

  const duplicate = shop.products.some(
    (p, i) => i !== idx && p.name.toLowerCase() === fields.name.toLowerCase(),
  );
  if (duplicate) return { error: 'A product with this name already exists' };

  const updated = normalizeProduct(
    {
      ...shop.products[idx],
      ...fields,
    },
    productId,
  );
  const nextProducts = [...shop.products];
  nextProducts[idx] = updated;
  shop.products = nextProducts;
  await writeShopData(shop);
  return { product: updated, shop };
}

async function updateDoorStockTransportSettings(body) {
  const shop = await readShopData();
  shop.doorStockTransportSettings = normalizeDoorStockTransportSettings(body);
  await writeShopData(shop);
  return shop.doorStockTransportSettings;
}

async function deleteProduct(id) {
  const productId = String(id ?? '').trim();
  if (!productId) return { error: 'Product id is required' };

  const shop = await readShopData();
  const nextProducts = shop.products.filter((p) => p.id !== productId);
  if (nextProducts.length === shop.products.length) {
    return { error: 'Product not found' };
  }
  shop.products = nextProducts;
  await writeShopData(shop);
  return { shop };
}

module.exports = {
  normalizeDoorStockTransportSettings,
  readShopData,
  writeShopData,
  normalizeShopData,
  normalizeBankAccount,
  normalizeBankAccounts,
  validateBankAccountFields,
  addBankAccount,
  updateBankAccount,
  deleteBankAccount,
  normalizeProduct,
  normalizeProducts,
  validateProductFields,
  addProduct,
  updateProduct,
  updateDoorStockTransportSettings,
  deleteProduct,
  ACCOUNT_TYPES,
  DEFAULT_SHOP_DATA,
  SHOP_DATA_FILE,
};
