const fs = require('fs').promises;
const path = require('path');
const { toNonNegMoney } = require('./customersStore');

const BANK_GUARANTEES_FILE = path.join(__dirname, '..', 'data', 'bankGuarantees.json');

const GUARANTEE_TYPES = ['fixed_deposit', 'property', 'other'];

function normalizeYmd(value) {
  const d = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

function paymentDateDefaultYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeGuaranteeType(value) {
  const v = String(value ?? '').trim();
  if (GUARANTEE_TYPES.includes(v)) return v;
  const lower = v.toLowerCase();
  if (lower.includes('fixed') || lower.includes('deposit')) return 'fixed_deposit';
  if (lower.includes('property')) return 'property';
  if (lower === 'other') return 'other';
  return '';
}

function normalizeEntry(row) {
  const guaranteeType = normalizeGuaranteeType(row.guaranteeType);
  const entry = {
    id: String(row.id ?? '').trim(),
    date: normalizeYmd(row.date),
    amount: toNonNegMoney(row.amount),
    guaranteeType,
    description: String(row.description ?? '').trim(),
    recordedBy: String(row.recordedBy ?? '').trim(),
    createdAt: String(row.createdAt ?? '').trim() || new Date().toISOString(),
  };
  const guaranteeTypeOther = String(row.guaranteeTypeOther ?? '').trim();
  if (guaranteeTypeOther) entry.guaranteeTypeOther = guaranteeTypeOther;
  const bankAccountId = String(row.bankAccountId ?? '').trim();
  if (bankAccountId) entry.bankAccountId = bankAccountId;
  if (row.bankAccount && typeof row.bankAccount === 'object') {
    entry.bankAccount = {
      id: String(row.bankAccount.id ?? '').trim(),
      nickName: String(row.bankAccount.nickName ?? '').trim(),
      bank: String(row.bankAccount.bank ?? '').trim(),
      accountNumber: String(row.bankAccount.accountNumber ?? '').trim(),
      accountType: String(row.bankAccount.accountType ?? '').trim(),
    };
  }
  return entry;
}

function validateCreateBody(body, { bankAccountById } = {}) {
  const recordedBy = String(body.recordedBy ?? '').trim();
  if (!recordedBy) {
    return { error: 'recordedBy (username) is required' };
  }

  const amount = toNonNegMoney(body.amount);
  if (amount <= 0) {
    return { error: 'Amount must be greater than 0' };
  }

  const guaranteeType = normalizeGuaranteeType(body.guaranteeType);
  if (!guaranteeType) {
    return { error: 'Select a guarantee type' };
  }

  let date = normalizeYmd(body.date);
  if (!date) date = paymentDateDefaultYmd();

  const description = String(body.description ?? body.note ?? '').trim();
  const payload = {
    date,
    amount,
    guaranteeType,
    description,
    recordedBy,
  };

  const guaranteeTypeOther = String(body.guaranteeTypeOther ?? '').trim();
  if (guaranteeType === 'other') {
    if (!guaranteeTypeOther) {
      return { error: 'Describe the guarantee type when Other is selected' };
    }
    payload.guaranteeTypeOther = guaranteeTypeOther;
  } else if (guaranteeTypeOther) {
    payload.guaranteeTypeOther = guaranteeTypeOther;
  }

  const bankAccountId = String(body.bankAccountId ?? '').trim();
  if (bankAccountId) {
    const acc = bankAccountById?.get(bankAccountId);
    if (!acc) return { error: 'Selected bank account was not found' };
    payload.bankAccountId = bankAccountId;
    payload.bankAccount = {
      id: bankAccountId,
      nickName: String(acc.nickName ?? '').trim(),
      bank: String(acc.bank ?? '').trim(),
      accountNumber: String(acc.accountNumber ?? '').trim(),
      accountType: String(acc.accountType ?? '').trim(),
    };
  }

  return { payload };
}

async function readBankGuaranteesRaw() {
  try {
    const raw = await fs.readFile(BANK_GUARANTEES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeBankGuarantees(records) {
  await fs.mkdir(path.dirname(BANK_GUARANTEES_FILE), { recursive: true });
  await fs.writeFile(BANK_GUARANTEES_FILE, JSON.stringify(records, null, 2), 'utf8');
}

async function readBankGuarantees() {
  const rows = await readBankGuaranteesRaw();
  return rows.map(normalizeEntry).filter((r) => r.id && r.guaranteeType && r.date);
}

module.exports = {
  GUARANTEE_TYPES,
  BANK_GUARANTEES_FILE,
  readBankGuarantees,
  writeBankGuarantees,
  normalizeEntry,
  validateCreateBody,
  normalizeGuaranteeType,
  paymentDateDefaultYmd,
};
