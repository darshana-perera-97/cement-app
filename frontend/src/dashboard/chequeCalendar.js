import { buildChequeTableRows, depositQueueRowKey } from './paymentCheques';
import {
  collectPoOutgoingCheques,
  formatPoChequeWithBank,
  isPoBankTransferPayment,
} from './poChequeDisplay';

export function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
}

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const CHEQUE_CALENDAR_KINDS = [
  {
    id: 'from_shops',
    label: 'Pending from shops',
    short: 'From shops',
    description: 'Shop cheques not yet due for deposit',
    dot: 'bg-violet-500',
    badge: 'bg-violet-50 text-violet-800 ring-violet-100',
    amount: 'text-violet-800',
    cell: 'bg-violet-100 text-violet-800',
  },
  {
    id: 'to_company',
    label: 'Pending to company',
    short: 'To company',
    description: 'Company cheques not yet due for deposit',
    dot: 'bg-sky-500',
    badge: 'bg-sky-50 text-sky-900 ring-sky-100',
    amount: 'text-sky-800',
    cell: 'bg-sky-100 text-sky-900',
  },
  {
    id: 'pending_deposit',
    label: 'Pending to deposit',
    short: 'To deposit',
    description: 'Converting date reached, not yet deposited',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-900 ring-amber-100',
    amount: 'text-amber-900',
    cell: 'bg-amber-100 text-amber-900',
  },
  {
    id: 'deposited',
    label: 'Deposited',
    short: 'Deposited',
    description: 'Deposited at the bank, converting date still ahead',
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-900 ring-indigo-100',
    amount: 'text-indigo-800',
    cell: 'bg-indigo-100 text-indigo-900',
  },
  {
    id: 'realized',
    label: 'Realized',
    short: 'Realized',
    description: 'Deposited and converting date reached',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-900 ring-emerald-100',
    amount: 'text-emerald-800',
    cell: 'bg-emerald-100 text-emerald-900',
  },
  {
    id: 'outgoing',
    label: 'Outgoing PO',
    short: 'Outgoing',
    description: 'Purchase-order cheques by converting date',
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-900 ring-rose-100',
    amount: 'text-rose-800',
    cell: 'bg-rose-100 text-rose-900',
  },
];

export const CHEQUE_CALENDAR_KIND_MAP = Object.fromEntries(
  CHEQUE_CALENDAR_KINDS.map((kind) => [kind.id, kind]),
);

export function classifyIncomingChequeStatus({ deposited, chequeDate, source, asOf }) {
  const future = String(chequeDate) > String(asOf);
  if (deposited) return future ? 'deposited' : 'realized';
  if (!future) return 'pending_deposit';
  return source === 'shop' ? 'from_shops' : 'to_company';
}

function pushIncomingItem(items, { id, chequeDate, deposited, source, title, subtitle, amount, asOf }) {
  if (!isYmd(chequeDate)) return;
  const amt = Math.max(0, Number(amount) || 0);
  if (amt <= 0) return;
  items.push({
    id,
    date: chequeDate,
    kind: classifyIncomingChequeStatus({
      deposited: !!deposited,
      chequeDate,
      source,
      asOf,
    }),
    source,
    title,
    subtitle,
    amount: amt,
  });
}

function appendCompanyLikeCheques(items, entries, { sourceTitle, idPrefix, source, asOf }) {
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e?.cancelled) continue;
    const amount = Math.max(0, Number(e.amount) || 0);
    if (amount <= 0) continue;
    const chequeDate = String(e.chequeDate ?? e.date ?? '').slice(0, 10);
    const chequeNumber = String(e.chequeNumber ?? '').trim();
    const note = String(e.description ?? '').trim();
    pushIncomingItem(items, {
      id: `${idPrefix}:${e.id}`,
      chequeDate,
      deposited: !!e.chequeDeposited,
      source,
      title: sourceTitle,
      subtitle: [chequeNumber ? `#${chequeNumber}` : '', note].filter(Boolean).join(' · ') || 'Company cheque',
      amount,
      asOf,
    });
  }
}

/** All cheque events placed by converting date for the month calendar. */
export function buildChequeCalendarItems({
  payments = [],
  companyCheques = [],
  ownerCheques = [],
  purchaseOrders = [],
  bankAccounts = [],
} = {}) {
  const items = [];
  const asOf = todayYmdLocal();

  buildChequeTableRows(payments, (p, c, flat) => {
    if (c.chequeReturned) return null;
    const customerName = String(p.customerName ?? '').trim() || 'Shop';
    const billNumber = p.billNumber != null ? String(p.billNumber) : '';
    pushIncomingItem(items, {
      id: depositQueueRowKey({ id: p.id, chequeId: c.id }),
      chequeDate: String(flat.chequeDate ?? '').slice(0, 10),
      deposited: !!c.chequeDeposited,
      source: 'shop',
      title: customerName,
      subtitle: [
        billNumber ? `Bill #${billNumber}` : '',
        flat.chequeNumber && flat.chequeNumber !== '—' ? `#${flat.chequeNumber}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      amount: flat.amount,
      asOf,
    });
    return null;
  });

  appendCompanyLikeCheques(items, companyCheques, {
    sourceTitle: 'Company',
    idPrefix: 'company',
    source: 'company',
    asOf,
  });

  for (const e of Array.isArray(ownerCheques) ? ownerCheques : []) {
    if (e?.cancelled) continue;
    if (String(e.ownerShareDirection ?? '').trim() !== 'from_owner') continue;
    if (String(e.paymentMethod ?? '').trim() !== 'cheque') continue;
    const amount = Math.max(0, Number(e.amount) || 0);
    if (amount <= 0) continue;
    const chequeDate = String(e.chequeDate ?? e.date ?? '').slice(0, 10);
    const chequeNumber = String(e.chequeNumber ?? '').trim();
    const note = String(e.description ?? '').trim();
    pushIncomingItem(items, {
      id: `owner:${e.id}`,
      chequeDate,
      deposited: !!e.chequeDeposited,
      source: 'company',
      title: 'Owner',
      subtitle: [chequeNumber ? `#${chequeNumber}` : '', note].filter(Boolean).join(' · ') || 'Owner cheque',
      amount,
      asOf,
    });
  }

  for (const c of collectPoOutgoingCheques(purchaseOrders)) {
    if (isPoBankTransferPayment(c)) continue;
    const chequeDate = String(c.chequeDate ?? '').slice(0, 10);
    if (!isYmd(chequeDate)) continue;
    const amount = Math.max(0, Number(c.amount) || 0);
    if (amount <= 0) continue;
    const converted = chequeDate <= asOf;
    items.push({
      id: `po:${c.poId}:${c.chequeNumber}:${chequeDate}:${c.bankAccountId}`,
      date: chequeDate,
      kind: 'outgoing',
      source: 'outgoing',
      title: c.product || 'Purchase',
      subtitle: [
        c.distributorName,
        formatPoChequeWithBank(c, bankAccounts),
        converted ? 'Converted' : 'Pending',
      ]
        .filter(Boolean)
        .join(' · '),
      amount,
    });
  }

  items.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const k = a.kind.localeCompare(b.kind);
    if (k !== 0) return k;
    return a.id.localeCompare(b.id);
  });
  return items;
}

export function monthGrid(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) {
    const d = new Date(year, monthIndex, 1 - (startPad - i));
    cells.push({ ymd: toYmd(d), day: d.getDate(), inMonth: false });
  }
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      ymd: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      inMonth: true,
    });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const [y, m, d] = last.ymd.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    cells.push({ ymd: toYmd(next), day: next.getDate(), inMonth: false });
  }
  return cells;
}

export function summarizeChequeItems(items) {
  const totals = Object.fromEntries(
    CHEQUE_CALENDAR_KINDS.map((kind) => [kind.id, { count: 0, amount: 0 }]),
  );
  for (const item of Array.isArray(items) ? items : []) {
    const bucket = totals[item.kind];
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += Number(item.amount) || 0;
  }
  return totals;
}

export function itemsByDate(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const list = map.get(item.date);
    if (list) list.push(item);
    else map.set(item.date, [item]);
  }
  return map;
}
