const fs = require('fs').promises;
const path = require('path');

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
  /** When true, collectors can enter cash per pending bill in one combined payment. */
  collectorSeparateBillSettlement: false,
  bankAccounts: [],
};

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
    collectorSeparateBillSettlement: Boolean(data.collectorSeparateBillSettlement),
    bankAccounts: normalizeBankAccounts(data.bankAccounts),
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

async function readShopData() {
  const data = await readShopDataRaw();
  return normalizeShopData({ ...DEFAULT_SHOP_DATA, ...data });
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

module.exports = {
  readShopData,
  writeShopData,
  normalizeShopData,
  normalizeBankAccount,
  normalizeBankAccounts,
  validateBankAccountFields,
  addBankAccount,
  updateBankAccount,
  deleteBankAccount,
  ACCOUNT_TYPES,
  DEFAULT_SHOP_DATA,
  SHOP_DATA_FILE,
};
