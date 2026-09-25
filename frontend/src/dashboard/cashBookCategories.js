export const BANK_DEPOSIT_TYPE_OPTIONS = [
  { value: 'transfer', label: 'Transfer' },
  { value: 'bank_deposit', label: 'Bank deposit' },
  { value: 'deposit_machine', label: 'Deposit machine' },
  { value: 'other', label: 'Other' },
];

export const BANK_WITHDRAWAL_TYPE_OPTIONS = [
  { value: 'cash_cheque', label: 'Cash cheque' },
  { value: 'atm', label: 'ATM machine' },
  { value: 'bank_slip', label: 'Bank slip' },
];

export const BANK_CHARGE_TYPE_OPTIONS = [
  { value: 'chequebook_charges', label: 'Chequebook charges' },
  { value: 'od_interest', label: 'OD interest' },
  { value: 'service_charges', label: 'Service charges' },
  { value: 'return_charges', label: 'Return charges' },
  { value: 'other', label: 'Others' },
];

export const BANK_INCOME_TYPE_OPTIONS = [
  { value: 'bank_interest', label: 'Bank interest' },
  { value: 'other', label: 'Others' },
];

export const BANK_GUARANTEE_TYPE_OPTIONS = [
  { value: 'fixed_deposit', label: 'Fixed deposit' },
  { value: 'property', label: 'Property' },
  { value: 'other', label: 'Other' },
];

export function bankGuaranteeTypeLabel(entry) {
  if (!entry || typeof entry !== 'object') return '—';
  const type = String(entry.guaranteeType ?? '').trim();
  if (type === 'other') {
    const custom = String(entry.guaranteeTypeOther ?? '').trim();
    return custom || 'Other';
  }
  const found = BANK_GUARANTEE_TYPE_OPTIONS.find((o) => o.value === type);
  return found?.label || type || '—';
}

export function bankIncomeTypeLabel(entry) {
  if (!entry || typeof entry !== 'object') return '—';
  const type = String(entry.incomeType ?? '').trim();
  const found = BANK_INCOME_TYPE_OPTIONS.find((o) => o.value === type);
  return found?.label || type || '—';
}

export function bankChargeTypeLabel(entry) {
  if (!entry || typeof entry !== 'object') return '—';
  const type = String(entry.chargeType ?? '').trim();
  if (type === 'other') {
    const note = String(entry.description ?? '').trim();
    return note ? `Others · ${note}` : 'Others';
  }
  const found = BANK_CHARGE_TYPE_OPTIONS.find((o) => o.value === type);
  return found?.label || type || '—';
}

export function bankWithdrawalTypeLabel(entry) {
  if (!entry || typeof entry !== 'object') return '—';
  const type = String(entry.withdrawalType ?? '').trim();
  const found = BANK_WITHDRAWAL_TYPE_OPTIONS.find((o) => o.value === type);
  return found?.label || type || '—';
}

export function bankDepositTypeLabel(entry) {
  if (!entry || typeof entry !== 'object') return '—';
  const type = String(entry.depositType ?? '').trim();
  if (type === 'other') {
    const custom = String(entry.depositTypeOther ?? '').trim();
    return custom || 'Other';
  }
  const found = BANK_DEPOSIT_TYPE_OPTIONS.find((o) => o.value === type);
  return found?.label || type || '—';
}

export const CASH_BOOK_CATEGORY_LABELS = {
  bank_deposit: 'Bank deposit',
  bank_withdrawal: 'Bank withdrawal',
  bank_charge: 'Bank expense',
  bank_income: 'Bank cash in',
  salary: 'Salary payment',
  fuel: 'Fuel cost',
  maintenance: 'Maintenance',
  purchase_order: 'Purchase order',
  other: 'Other',
  company_cheque: 'Company cheque',
  owner_share: 'Owner share',
};

export const OWNER_SHARE_DIRECTION_LABELS = {
  from_owner: 'From owner',
  to_owner: 'Taken by owner',
};

export const OWNER_SHARE_PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  cheque: 'Cheque',
};

export const EXPENSE_PAYMENT_CATEGORIES = ['salary', 'fuel', 'maintenance', 'other'];

export const EXPENSE_PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

export const EXPENSE_PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

export function expensePaymentMethod(entry) {
  const method = String(entry?.paymentMethod ?? '').trim();
  if (method === 'bank_transfer' || method === 'cheque' || method === 'cash') return method;
  return 'cash';
}

export function isBankPaidExpense(entry) {
  const category = String(entry?.category ?? '').trim();
  if (!EXPENSE_PAYMENT_CATEGORIES.includes(category)) return false;
  const method = String(entry?.paymentMethod ?? '').trim();
  return method === 'bank_transfer' || method === 'cheque';
}

export const CASHIER_EXPENSE_ACTIONS = [
  { category: 'bank_deposit', label: 'Bank deposit', short: 'To bank' },
  { category: 'salary', label: 'Salary payment', short: 'Salary' },
  { category: 'fuel', label: 'Fuel cost', short: 'Fuel' },
  { category: 'maintenance', label: 'Maintenance', short: 'Maint.' },
  { category: 'other', label: 'Other', short: 'Other' },
];

export function cashBookEntryDetail(entry) {
  if (!entry || typeof entry !== 'object') return '—';
  const cat = entry.category;
  if (cat === 'salary') {
    const who = String(entry.staffName ?? '').trim() || '—';
    const desc = String(entry.description ?? '').trim();
    return withExpensePayment(entry, desc ? `${who} — ${desc}` : who);
  }
  if (cat === 'fuel') {
    const v = String(entry.vehicleNumber ?? '').trim() || '—';
    const m = entry.meterReading != null ? entry.meterReading : '—';
    return withExpensePayment(entry, `${v} · meter ${m}`);
  }
  if (cat === 'maintenance') {
    const v = String(entry.vehicleNumber ?? '').trim() || '—';
    const desc = String(entry.description ?? '').trim();
    return withExpensePayment(entry, desc ? `${v} — ${desc}` : v);
  }
  if (cat === 'bank_deposit') {
    const typeLabel = bankDepositTypeLabel(entry);
    const accounts = Array.isArray(entry.bankAccounts)
      ? entry.bankAccounts.map((a) => a.nickName || a.bank).filter(Boolean).join(', ')
      : '';
    const note = String(entry.description ?? '').trim();
    const parts = [typeLabel, accounts, note].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Cash deposited to bank';
  }
  if (cat === 'bank_withdrawal') {
    const typeLabel = bankWithdrawalTypeLabel(entry);
    const accounts = Array.isArray(entry.bankAccounts)
      ? entry.bankAccounts.map((a) => a.nickName || a.bank).filter(Boolean).join(', ')
      : '';
    const cheque = String(entry.chequeNumber ?? '').trim();
    const note = String(entry.description ?? '').trim();
    const parts = [typeLabel, accounts, cheque ? `#${cheque}` : '', note].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Cash withdrawn from bank';
  }
  if (cat === 'bank_charge') {
    const typeLabel = bankChargeTypeLabel(entry);
    const accounts = Array.isArray(entry.bankAccounts)
      ? entry.bankAccounts.map((a) => a.nickName || a.bank).filter(Boolean).join(', ')
      : '';
    const parts = [typeLabel, accounts].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Bank expense';
  }
  if (cat === 'bank_income') {
    const typeLabel = bankIncomeTypeLabel(entry);
    const accounts = Array.isArray(entry.bankAccounts)
      ? entry.bankAccounts.map((a) => a.nickName || a.bank).filter(Boolean).join(', ')
      : '';
    const note = String(entry.description ?? '').trim();
    const parts = [typeLabel, accounts, note].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Bank cash in';
  }
  if (cat === 'purchase_order') {
    const desc = String(entry.description ?? '').trim();
    const poRef = String(entry.poNumber ?? '').trim();
    if (desc) return desc;
    return poRef ? `PO ${poRef}` : 'Purchase order payment';
  }
  if (cat === 'company_cheque') {
    const num = String(entry.chequeNumber ?? '').trim();
    const chequeDate = String(entry.chequeDate ?? '').trim();
    const chequeAmt = Math.max(0, Number(entry.amount) || 0);
    const parts = [
      num ? `#${num}` : '',
      chequeDate || '',
      chequeAmt > 0 ? chequeAmt.toLocaleString() : '',
    ].filter(Boolean);
    const note = String(entry.description ?? '').trim();
    if (parts.length > 0) return note ? `${parts.join(' · ')} — ${note}` : parts.join(' · ');
    return note || 'Company cheque';
  }
  if (cat === 'owner_share') {
    const dir = OWNER_SHARE_DIRECTION_LABELS[String(entry.ownerShareDirection ?? '').trim()] || '';
    const method = OWNER_SHARE_PAYMENT_METHOD_LABELS[String(entry.paymentMethod ?? '').trim()] || '';
    const num = String(entry.chequeNumber ?? '').trim();
    const chequeDate = String(entry.chequeDate ?? '').trim();
    const parts = [dir, method, num ? `#${num}` : '', chequeDate].filter(Boolean);
    const note = String(entry.description ?? '').trim();
    if (parts.length > 0) return note ? `${parts.join(' · ')} — ${note}` : parts.join(' · ');
    return note || 'Owner share';
  }
  const desc = String(entry.description ?? '').trim();
  if (cat === 'other') {
    const who = String(entry.staffName ?? '').trim();
    if (who && desc) return withExpensePayment(entry, `${who} — ${desc}`);
    if (who) return withExpensePayment(entry, who);
    return withExpensePayment(entry, desc || '—');
  }
  return desc || '—';
}

function withExpensePayment(entry, detail) {
  const method = String(entry?.paymentMethod ?? '').trim();
  if (method !== 'cash' && method !== 'bank_transfer' && method !== 'cheque') return detail;
  const label = EXPENSE_PAYMENT_METHOD_LABELS[method] || method;
  const accounts = Array.isArray(entry.bankAccounts)
    ? entry.bankAccounts.map((a) => a.nickName || a.bank).filter(Boolean).join(', ')
    : '';
  const num = String(entry.chequeNumber ?? '').trim();
  const dated = String(entry.chequeDate ?? '').trim();
  const parts = [
    label,
    accounts,
    method === 'cheque' && num ? `#${num}` : '',
    method === 'bank_transfer' && num ? `ref ${num}` : '',
    method !== 'cash' && dated ? dated : '',
  ].filter(Boolean);
  return parts.length > 0 ? `${detail} · ${parts.join(' · ')}` : detail;
}

export function modalTitleForCategory(category) {
  switch (category) {
    case 'bank_deposit':
      return 'Record bank deposit';
    case 'salary':
      return 'Salary payment';
    case 'fuel':
      return 'Fuel cost';
    case 'maintenance':
      return 'Maintenance';
    case 'other':
      return 'Other expense';
    default:
      return 'Record expense';
  }
}
