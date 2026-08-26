const fs = require('fs').promises;
const path = require('path');
const { toNonNegMoney } = require('./customersStore');

const CASH_BOOK_FILE = path.join(__dirname, '..', 'data', 'cashBookEntries.json');

const CATEGORIES = [
  'bank_deposit',
  'salary',
  'fuel',
  'maintenance',
  'purchase_order',
  'other',
  'company_cheque',
  'owner_share',
];

const OWNER_SHARE_DIRECTIONS = ['from_owner', 'to_owner'];
const OWNER_SHARE_PAYMENT_METHODS = ['cash', 'cheque'];

function isIncomingChequeEntry(entry) {
  const category = String(entry?.category ?? '').trim();
  if (category === 'company_cheque') return true;
  if (category !== 'owner_share') return false;
  return (
    String(entry.ownerShareDirection ?? '').trim() === 'from_owner' &&
    String(entry.paymentMethod ?? '').trim() === 'cheque'
  );
}

const BANK_DEPOSIT_TYPES = ['transfer', 'bank_deposit', 'deposit_machine', 'other'];

function normalizeDepositType(value) {
  const v = String(value ?? '').trim();
  if (BANK_DEPOSIT_TYPES.includes(v)) return v;
  const lower = v.toLowerCase();
  if (lower === 'transfer') return 'transfer';
  if (lower.includes('machine')) return 'deposit_machine';
  if (lower === 'other') return 'other';
  if (v) return 'bank_deposit';
  return '';
}

async function readCashBookEntriesRaw() {
  try {
    const raw = await fs.readFile(CASH_BOOK_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeCashBookEntries(records) {
  await fs.mkdir(path.dirname(CASH_BOOK_FILE), { recursive: true });
  await fs.writeFile(CASH_BOOK_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function normalizeYmd(value) {
  const d = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

function normalizeMeterReading(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeEntry(row) {
  const category = String(row.category ?? '').trim();
  const entry = {
    id: String(row.id ?? '').trim(),
    date: normalizeYmd(row.date),
    category,
    amount: toNonNegMoney(row.amount),
    description: String(row.description ?? '').trim(),
    recordedBy: String(row.recordedBy ?? '').trim(),
    createdAt: String(row.createdAt ?? '').trim() || new Date().toISOString(),
  };
  const staffUserId = String(row.staffUserId ?? '').trim();
  const staffName = String(row.staffName ?? '').trim();
  const lorryId = String(row.lorryId ?? '').trim();
  const vehicleNumber = String(row.vehicleNumber ?? '').trim();
  const meterReading = normalizeMeterReading(row.meterReading);
  if (staffUserId) entry.staffUserId = staffUserId;
  if (staffName) entry.staffName = staffName;
  if (lorryId) entry.lorryId = lorryId;
  if (vehicleNumber) entry.vehicleNumber = vehicleNumber;
  if (meterReading != null) entry.meterReading = meterReading;
  const bankAccountIds = Array.isArray(row.bankAccountIds)
    ? [...new Set(row.bankAccountIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
    : [];
  if (bankAccountIds.length > 0) entry.bankAccountIds = bankAccountIds;
  if (Array.isArray(row.bankAccounts) && row.bankAccounts.length > 0) {
    entry.bankAccounts = row.bankAccounts.map((a) => ({
      id: String(a.id ?? '').trim(),
      nickName: String(a.nickName ?? '').trim(),
      bank: String(a.bank ?? '').trim(),
      accountNumber: String(a.accountNumber ?? '').trim(),
      accountType: String(a.accountType ?? '').trim(),
    }));
  }
  const depositType = normalizeDepositType(row.depositType);
  if (depositType) entry.depositType = depositType;
  const depositTypeOther = String(row.depositTypeOther ?? '').trim();
  if (depositTypeOther) entry.depositTypeOther = depositTypeOther;
  const chequeNumber = String(row.chequeNumber ?? '').trim();
  const chequeDate = normalizeYmd(row.chequeDate);
  const amountToAdd = toNonNegMoney(row.amountToAdd);
  if (chequeNumber) entry.chequeNumber = chequeNumber;
  if (chequeDate) entry.chequeDate = chequeDate;
  if (amountToAdd > 0) entry.amountToAdd = amountToAdd;
  const ownerShareDirection = String(row.ownerShareDirection ?? '').trim();
  const paymentMethod = String(row.paymentMethod ?? '').trim();
  if (ownerShareDirection) entry.ownerShareDirection = ownerShareDirection;
  if (paymentMethod) entry.paymentMethod = paymentMethod;
  if (category === 'company_cheque' || (category === 'owner_share' && isIncomingChequeEntry({ category, ownerShareDirection, paymentMethod }))) {
    entry.chequeDeposited = !!row.chequeDeposited;
    entry.chequeDepositedAt = String(row.chequeDepositedAt ?? '').trim();
    entry.chequeDepositedBy = String(row.chequeDepositedBy ?? '').trim();
    const depBankId = String(row.chequeDepositedBankAccountId ?? '').trim();
    if (depBankId) entry.chequeDepositedBankAccountId = depBankId;
    if (row.chequeDepositedBankAccount && typeof row.chequeDepositedBankAccount === 'object') {
      entry.chequeDepositedBankAccount = {
        id: String(row.chequeDepositedBankAccount.id ?? '').trim(),
        nickName: String(row.chequeDepositedBankAccount.nickName ?? '').trim(),
        bank: String(row.chequeDepositedBankAccount.bank ?? '').trim(),
        accountNumber: String(row.chequeDepositedBankAccount.accountNumber ?? '').trim(),
        accountType: String(row.chequeDepositedBankAccount.accountType ?? '').trim(),
      };
    }
    const depNote = String(row.chequeDepositedNote ?? '').trim();
    if (depNote) entry.chequeDepositedNote = depNote;
  }
  const poId = String(row.poId ?? '').trim();
  const poNumber = String(row.poNumber ?? '').trim();
  const batchId = String(row.batchId ?? '').trim();
  if (poId) entry.poId = poId;
  if (poNumber) entry.poNumber = poNumber;
  if (batchId) entry.batchId = batchId;
  if (row.cancelled) {
    entry.cancelled = true;
    const cancelledAt = String(row.cancelledAt ?? '').trim();
    const cancelledBy = String(row.cancelledBy ?? '').trim();
    if (cancelledAt) entry.cancelledAt = cancelledAt;
    if (cancelledBy) entry.cancelledBy = cancelledBy;
  }
  return entry;
}

function paymentDateDefaultYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function validateCreateBody(body, { staffById, lorryById, bankAccountById } = {}) {
  const recordedBy = String(body.recordedBy ?? '').trim();
  if (!recordedBy) {
    return { error: 'recordedBy (username) is required' };
  }

  const category = String(body.category ?? '').trim();
  if (!CATEGORIES.includes(category)) {
    return { error: 'Invalid expense category' };
  }

  const amount = toNonNegMoney(body.amount);
  if (amount <= 0) {
    return { error: 'Amount must be greater than 0' };
  }

  let date = normalizeYmd(body.date);
  if (!date) date = paymentDateDefaultYmd();

  const description = String(body.description ?? body.note ?? '').trim();
  const payload = {
    date,
    category,
    amount,
    description,
    recordedBy,
  };

  if (category === 'salary') {
    const staffUserId = String(body.staffUserId ?? '').trim();
    if (!staffUserId) return { error: 'Select a person for salary payment' };
    const staff = staffById?.get(staffUserId);
    if (!staff) return { error: 'Selected person was not found' };
    payload.staffUserId = staffUserId;
    payload.staffName = String(staff.name || '').trim() || staffUserId;
    if (!description) return { error: 'Description is required for salary payment' };
  }

  if (category === 'fuel') {
    const lorryId = String(body.lorryId ?? '').trim();
    if (!lorryId) return { error: 'Select a lorry for fuel cost' };
    const lorry = lorryById?.get(lorryId);
    if (!lorry) return { error: 'Selected lorry was not found' };
    payload.lorryId = lorryId;
    payload.vehicleNumber = String(lorry.number || '').trim();
    const meterReading = normalizeMeterReading(body.meterReading);
    if (meterReading == null) return { error: 'Current meter reading is required for fuel cost' };
    payload.meterReading = meterReading;
  }

  if (category === 'maintenance') {
    const lorryId = String(body.lorryId ?? '').trim();
    if (!lorryId) return { error: 'Select a vehicle for maintenance' };
    const lorry = lorryById?.get(lorryId);
    if (!lorry) return { error: 'Selected vehicle was not found' };
    payload.lorryId = lorryId;
    payload.vehicleNumber = String(lorry.number || '').trim();
    if (!description) return { error: 'Description is required for maintenance' };
  }

  if (category === 'purchase_order') {
    if (!description) {
      const poRef = String(body.poNumber ?? '').trim();
      payload.description = poRef ? `Purchase order ${poRef}` : 'Purchase order payment';
    }
    const poId = String(body.poId ?? '').trim();
    const poNumber = String(body.poNumber ?? '').trim();
    const batchId = String(body.batchId ?? '').trim();
    if (poId) payload.poId = poId;
    if (poNumber) payload.poNumber = poNumber;
    if (batchId) payload.batchId = batchId;
  }

  if (category === 'other') {
    if (!description) return { error: 'Description is required' };
  }

  if (category === 'company_cheque') {
    const chequeNumber = String(body.chequeNumber ?? '').trim();
    if (!chequeNumber) return { error: 'Cheque number is required' };
    const chequeDate = normalizeYmd(body.chequeDate);
    if (!chequeDate) return { error: 'Cheque date is required' };
    payload.chequeNumber = chequeNumber;
    payload.chequeDate = chequeDate;
    if (!description) {
      payload.description = `Cheque #${chequeNumber}`;
    }
  }

  if (category === 'owner_share') {
    const ownerShareDirection = String(body.ownerShareDirection ?? '').trim();
    if (!OWNER_SHARE_DIRECTIONS.includes(ownerShareDirection)) {
      return { error: 'Select whether money is from owner or taken by owner' };
    }
    const paymentMethod = String(body.paymentMethod ?? '').trim();
    if (!OWNER_SHARE_PAYMENT_METHODS.includes(paymentMethod)) {
      return { error: 'Select cash or cheque' };
    }
    payload.ownerShareDirection = ownerShareDirection;
    payload.paymentMethod = paymentMethod;
    if (paymentMethod === 'cheque') {
      const chequeNumber = String(body.chequeNumber ?? '').trim();
      if (!chequeNumber) return { error: 'Cheque number is required' };
      const chequeDate = normalizeYmd(body.chequeDate);
      if (!chequeDate) return { error: 'Cheque date is required' };
      payload.chequeNumber = chequeNumber;
      payload.chequeDate = chequeDate;
    }
    if (!description) {
      const dirLabel = ownerShareDirection === 'from_owner' ? 'From owner' : 'Taken by owner';
      const methodLabel = paymentMethod === 'cheque' ? 'cheque' : 'cash';
      payload.description = `${dirLabel} · ${methodLabel}`;
    }
  }

  if (category === 'bank_deposit') {
    const rawIds = body.bankAccountIds;
    const ids = Array.isArray(rawIds)
      ? [...new Set(rawIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
      : [];
    if (ids.length === 0) {
      return { error: 'Select at least one bank account' };
    }
    const snapshots = [];
    for (const id of ids) {
      const acc = bankAccountById?.get(id);
      if (!acc) return { error: 'One or more selected bank accounts were not found' };
      snapshots.push({
        id,
        nickName: String(acc.nickName ?? '').trim(),
        bank: String(acc.bank ?? '').trim(),
        accountNumber: String(acc.accountNumber ?? '').trim(),
        accountType: String(acc.accountType ?? '').trim(),
      });
    }
    payload.bankAccountIds = ids;
    payload.bankAccounts = snapshots;

    const depositType = normalizeDepositType(body.depositType);
    if (!depositType) {
      return { error: 'Select a deposit type' };
    }
    payload.depositType = depositType;
    const depositTypeOther = String(body.depositTypeOther ?? '').trim();
    if (depositType === 'other') {
      if (!depositTypeOther) {
        return { error: 'Describe the deposit type when Other is selected' };
      }
      payload.depositTypeOther = depositTypeOther;
    } else if (depositTypeOther) {
      payload.depositTypeOther = depositTypeOther;
    }
  }

  return { payload };
}

function markCompanyChequeDeposited(entry, { recordedBy, depositedAt, bankAccountId, bankAccount, note }) {
  const e = { ...entry };
  if (!isIncomingChequeEntry(e)) {
    return { entry: e, error: 'Not a depositable incoming cheque entry' };
  }
  if (e.chequeDeposited) {
    return { entry: e, error: 'This cheque is already marked as deposited' };
  }
  e.chequeDeposited = true;
  e.chequeDepositedAt = depositedAt;
  e.chequeDepositedBy = recordedBy;
  if (bankAccountId) e.chequeDepositedBankAccountId = bankAccountId;
  if (bankAccount) e.chequeDepositedBankAccount = bankAccount;
  if (note) e.chequeDepositedNote = note;
  return { entry: e };
}

async function readCashBookEntries() {
  const rows = await readCashBookEntriesRaw();
  return rows.map(normalizeEntry).filter((r) => r.id && r.category && r.date);
}

module.exports = {
  CATEGORIES,
  CASH_BOOK_FILE,
  readCashBookEntries,
  writeCashBookEntries,
  normalizeEntry,
  validateCreateBody,
  markCompanyChequeDeposited,
  isIncomingChequeEntry,
  OWNER_SHARE_DIRECTIONS,
  OWNER_SHARE_PAYMENT_METHODS,
  BANK_DEPOSIT_TYPES,
  normalizeDepositType,
  paymentDateDefaultYmd,
};
