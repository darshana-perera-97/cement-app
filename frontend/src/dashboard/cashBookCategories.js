export const BANK_DEPOSIT_TYPE_OPTIONS = [
  { value: 'transfer', label: 'Transfer' },
  { value: 'bank_deposit', label: 'Bank deposit' },
  { value: 'deposit_machine', label: 'Deposit machine' },
  { value: 'other', label: 'Other' },
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
    return desc ? `${who} — ${desc}` : who;
  }
  if (cat === 'fuel') {
    const v = String(entry.vehicleNumber ?? '').trim() || '—';
    const m = entry.meterReading != null ? entry.meterReading : '—';
    return `${v} · meter ${m}`;
  }
  if (cat === 'maintenance') {
    const v = String(entry.vehicleNumber ?? '').trim() || '—';
    const desc = String(entry.description ?? '').trim();
    return desc ? `${v} — ${desc}` : v;
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
  return String(entry.description ?? '').trim() || '—';
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
