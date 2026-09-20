import { formatBrandLabel, getCachedBrands } from '../dashboard/brandTheme';
import { cashPortion, cdmPortion, chequePortion, getPaymentCheques, getPaymentCdmDeposits, getPaymentOnlineTransfers, onlineTransferPortion } from '../dashboard/paymentCheques';
import { getPaymentReceiptInvoices } from '../dashboard/paymentReceipt';
import { printEscPosLines } from './bluetoothPrinter';

function display(v) {
  const s = String(v ?? '').trim();
  return s || '—';
}

function money(n) {
  return new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatDate(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }
  return display(s);
}

function formatPrintStamp(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${dd}/${mm}/${yyyy}  ${String(hours).padStart(2, '0')}:${minutes}:${seconds}${ampm}`;
}

function bankNameFromSnap(snap) {
  if (snap && typeof snap === 'object') {
    return String(snap.bank ?? '').trim();
  }
  return '';
}

function accountNoFromSnap(snap) {
  if (snap && typeof snap === 'object') {
    return String(snap.accountNumber ?? '').trim();
  }
  return '';
}

function invoiceTitle(inv) {
  const num = String(inv.invoiceNumber ?? '').trim();
  if (num) return num.toLowerCase() === 'opening' ? 'Opening balance' : `Invoice ${num}`;
  const details = String(inv.details ?? '').trim();
  const invMatch = details.match(/^Inv\s+(.+?)(?:\s*·|$)/i);
  if (invMatch) {
    const extracted = invMatch[1].trim();
    if (extracted.toLowerCase() === 'opening') return 'Opening balance';
    return `Invoice ${extracted}`;
  }
  return 'Invoice';
}

function shopLines(shop) {
  const lines = [];
  const name = display(shop?.shopName || 'Shop');
  lines.push({ kind: 'align', value: 'center' });
  lines.push({ text: name, bold: true, double: true });
  const address = [shop?.addressLine1, shop?.addressLine2].map((x) => String(x ?? '').trim()).filter(Boolean);
  for (const line of address) lines.push({ text: line });
  if (shop?.contactNumber) lines.push({ text: `Tel ${shop.contactNumber}` });
  if (shop?.registrationNo) lines.push({ text: `Reg ${shop.registrationNo}` });
  lines.push({ kind: 'rule', char: '=' });
  return lines;
}

function bagLinesFromRow(row) {
  const brands = getCachedBrands();
  const items = [];
  for (const brand of brands) {
    const bags = Number(row?.[`${brand.key}Bags`]) || 0;
    if (bags <= 0) continue;
    const unitPrice = Number(row?.[`${brand.key}UnitPrice`]) || 0;
    items.push({
      code: String(brand?.code ?? '').trim(),
      name: String(brand?.label ?? '').trim() || brand.key,
      label: formatBrandLabel(brand) || brand.label || brand.key,
      bags,
      unitPrice,
      amount: Math.round(bags * unitPrice * 100) / 100,
    });
  }
  return items;
}

function itemTableLines(items, { includeAmount = false } = {}) {
  const qtyHeader = includeAmount ? 'QTY' : 'ITEMS';
  const header = [
    { text: 'CODE', width: 8 },
    { text: 'ITEM NAME', flex: true },
    { text: qtyHeader, width: 6, align: 'right' },
  ];
  if (includeAmount) header.push({ text: 'AMOUNT', width: 10, align: 'right' });
  const lines = [
    { kind: 'cells', bold: true, items: header },
    { kind: 'rule' },
  ];
  if (!items.length) {
    lines.push({ text: 'No items' });
    return lines;
  }
  for (const item of items) {
    const row = [
      { text: item.code || '—', width: 8 },
      { text: item.name, flex: true },
      { text: String(item.bags), width: 6, align: 'right' },
    ];
    if (includeAmount) row.push({ text: money(item.amount), width: 10, align: 'right' });
    lines.push({ kind: 'cells', items: row });
  }
  return lines;
}

function footerLines() {
  return [
    { kind: 'blank' },
    { kind: 'align', value: 'center' },
    { text: 'Thank you' },
    { text: formatPrintStamp() },
  ];
}

function paymentFooterLines() {
  return [
    { kind: 'blank' },
    { kind: 'align', value: 'center' },
    { text: 'Thank you for your payment', bold: true },
    { text: 'This is an official receipt' },
    { text: formatPrintStamp() },
  ];
}

function pushInvoiceLines(lines, payment) {
  const invoices = getPaymentReceiptInvoices(payment);
  if (invoices.length === 0) return;

  lines.push({ kind: 'align', value: 'center' });
  lines.push({ text: 'INVOICES', bold: true });
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'align', value: 'left' });

  invoices.forEach((inv) => {
    lines.push({
      kind: 'cols',
      left: invoiceTitle(inv),
      right: inv.date ? formatDate(inv.date) : '',
    });
    if (inv.billTotal > 0) {
      lines.push({ kind: 'cols', left: 'Invoice amt', right: money(inv.billTotal) });
    }
    if (inv.remainingAfter != null) {
      lines.push({ kind: 'cols', left: 'Remaining', right: money(inv.remainingAfter) });
    }
  });

  lines.push({ kind: 'rule' });
}

export function buildUnloadReceiptLines(unload, shop) {
  const items = bagLinesFromRow(unload);
  const totalBags = items.reduce((s, i) => s + i.bags, 0);
  const lines = [
    ...shopLines(shop),
    { kind: 'align', value: 'center' },
    { text: 'UNLOADING INVOICE', bold: true, double: true },
    { kind: 'rule', char: '=' },
    { kind: 'align', value: 'left' },
    { kind: 'cols', left: 'Invoice #', right: display(unload?.invoiceNumber) },
    { kind: 'cols', left: 'Date', right: formatDate(unload?.date) },
    { kind: 'cols', left: 'Customer', right: display(unload?.customerName) },
    ...(unload?.driverName
      ? [{ kind: 'cols', left: 'Driver', right: display(unload.driverName) }]
      : []),
    { kind: 'rule' },
    ...itemTableLines(items),
    { kind: 'rule' },
    {
      kind: 'cells',
      bold: true,
      items: [
        { text: '', width: 8 },
        { text: 'TOTAL BAGS', flex: true },
        { text: String(totalBags), width: 6, align: 'right' },
      ],
    },
  ];
  lines.push({ kind: 'blank' });
  lines.push({ text: 'Received the above goods in correct quantity and in good condition.' });
  lines.push({ kind: 'blank' });
  lines.push({ kind: 'cols', left: 'Customer sign', right: 'Approved' });
  if (unload?.note) {
    lines.push({ kind: 'blank' });
    lines.push({ text: `Note: ${unload.note}` });
  }
  lines.push(...footerLines());
  return lines;
}

export function buildPaymentReceiptLines(payment, shop) {
  const cash = cashPortion(payment);
  const cheque = chequePortion(payment);
  const cdm = cdmPortion(payment);
  const online = onlineTransferPortion(payment);
  const cheques = getPaymentCheques(payment);
  const cdmDeposits = getPaymentCdmDeposits(payment);
  const onlineTransfers = getPaymentOnlineTransfers(payment);
  const lines = [
    ...shopLines(shop),
    { kind: 'align', value: 'center' },
    { text: 'PAYMENT RECEIPT', bold: true, double: true },
    { text: `No. ${display(payment?.billNumber)}`, bold: true },
    { kind: 'rule', char: '=' },
    { kind: 'align', value: 'left' },
    { kind: 'cols', left: 'Date', right: formatDate(payment?.date) },
    { kind: 'cols', left: 'Customer', right: display(payment?.customerName) },
    { kind: 'cols', left: 'Collected by', right: display(payment?.recordedBy) },
    { kind: 'rule', char: '=' },
    { kind: 'align', value: 'center' },
    { text: 'AMOUNT RECEIVED', bold: true },
    { kind: 'rule' },
    { kind: 'align', value: 'left' },
  ];
  if (cash > 0) lines.push({ kind: 'cols', left: 'Cash', right: money(cash) });
  if (cheque > 0) lines.push({ kind: 'cols', left: 'Cheque', right: money(cheque) });
  if (cdm > 0) lines.push({ kind: 'cols', left: 'CDM deposit', right: money(cdm) });
  if (online > 0) lines.push({ kind: 'cols', left: 'Online transfer', right: money(online) });
  if (cash <= 0 && cheque <= 0 && cdm <= 0 && online <= 0 && Number(payment?.amount) > 0) {
    lines.push({ kind: 'cols', left: 'Received', right: money(payment.amount) });
  }

  if (cheques.length > 0) {
    lines.push({ kind: 'blank' });
    lines.push({ text: cheques.length === 1 ? 'Cheque details' : 'Cheques', bold: true });
    for (const c of cheques) {
      const bits = [
        c.chequeNumber ? `#${c.chequeNumber}` : null,
        c.chequeBank || null,
        c.chequeDate ? formatDate(c.chequeDate) : null,
      ].filter(Boolean);
      lines.push({
        kind: 'cols',
        left: bits.join('  ') || 'Cheque',
        right: money(c.amount),
      });
    }
  }
  if (cdmDeposits.length > 0) {
    lines.push({ kind: 'blank' });
    lines.push({ text: cdmDeposits.length === 1 ? 'CDM details' : 'CDM deposits', bold: true });
    for (const d of cdmDeposits) {
      const bits = [
        d.cdmNumber ? `#${d.cdmNumber}` : null,
        bankNameFromSnap(d.bankAccount) || null,
        accountNoFromSnap(d.bankAccount) || null,
      ].filter(Boolean);
      lines.push({
        kind: 'cols',
        left: bits.join('  ') || 'CDM deposit',
        right: money(d.amount),
      });
    }
  }
  if (onlineTransfers.length > 0) {
    lines.push({ kind: 'blank' });
    lines.push({ text: onlineTransfers.length === 1 ? 'Transfer details' : 'Online transfers', bold: true });
    for (const t of onlineTransfers) {
      const bits = [
        t.reference ? `#${t.reference}` : null,
        bankNameFromSnap(t.bankAccount) || null,
        accountNoFromSnap(t.bankAccount) || null,
      ].filter(Boolean);
      lines.push({
        kind: 'cols',
        left: bits.join('  ') || 'Online transfer',
        right: money(t.amount),
      });
    }
  }

  lines.push({ kind: 'rule', char: '=' });
  lines.push({ kind: 'cols', left: 'TOTAL RECEIVED', right: money(payment?.amount), bold: true, invert: true });
  lines.push({ kind: 'rule', char: '=' });

  pushInvoiceLines(lines, payment);

  if (payment?.note) {
    lines.push({ kind: 'blank' });
    lines.push({ text: 'Note', bold: true });
    lines.push({ text: String(payment.note).trim() });
  }

  lines.push({ kind: 'blank' });
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'cols', left: 'Received by', right: 'Customer' });
  lines.push({ kind: 'blank' });
  lines.push({ kind: 'cols', left: '______________', right: '______________' });
  lines.push(...paymentFooterLines());
  return lines;
}

function listIdentifier(value, fallback) {
  const s = String(value ?? '').trim();
  if (!s || s === '—') return fallback;
  return s;
}

function pushCollectionList(lines, rows, identifierForRow) {
  if (!Array.isArray(rows) || rows.length === 0) {
    lines.push({ text: 'None' });
    return;
  }
  rows.forEach((row, index) => {
    if (index > 0) lines.push({ kind: 'blank' });
    lines.push({ text: display(row?.customerName), bold: true });
    lines.push({
      kind: 'cols',
      left: identifierForRow(row),
      right: money(row?.amount),
    });
  });
}

export function buildDailyCollectionsSummaryLines(report, shop) {
  const cashTotal = Number(report?.cashTotal) || 0;
  const cdmRows = Array.isArray(report?.cdmRows) ? report.cdmRows : [];
  const bankRows = Array.isArray(report?.bankTransferRows) ? report.bankTransferRows : [];
  const chequeRows = Array.isArray(report?.chequeRows) ? report.chequeRows : [];
  const cdmTotal = report?.cdmTotal != null ? Number(report.cdmTotal) || 0 : cdmRows.reduce((s, r) => s + (Number(r?.amount) || 0), 0);
  const bankTotal =
    report?.bankTransferTotal != null
      ? Number(report.bankTransferTotal) || 0
      : bankRows.reduce((s, r) => s + (Number(r?.amount) || 0), 0);
  const chequeTotal =
    report?.chequeTotal != null
      ? Number(report.chequeTotal) || 0
      : chequeRows.reduce((s, r) => s + (Number(r?.amount) || 0), 0);
  const collectorName = String(report?.collectorName ?? '').trim();
  const lines = [
    ...shopLines(shop),
    { kind: 'align', value: 'center' },
    { text: 'DAILY COLLECTIONS', bold: true, double: true },
    { text: formatDate(report?.reportDate), bold: true },
  ];
  if (collectorName) lines.push({ text: collectorName });
  lines.push({ kind: 'rule', char: '=' });
  lines.push({ kind: 'align', value: 'left' });
  lines.push({ kind: 'cols', left: 'Cash', right: money(cashTotal), bold: true, invert: true });

  lines.push({ kind: 'blank' });
  lines.push({ kind: 'align', value: 'center' });
  lines.push({ text: 'CDM DEPOSIT LIST', bold: true });
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'align', value: 'left' });
  pushCollectionList(lines, cdmRows, (row) => {
    const num = listIdentifier(row?.cdmNumber, '');
    const date = row?.cdmDate ? formatDate(row.cdmDate) : '';
    const label = num ? `CDM ${num}` : 'CDM deposit';
    return date ? `${label}  ${date}` : label;
  });
  lines.push({ kind: 'rule' });
  lines.push({
    kind: 'cols',
    left: `CDM total (${cdmRows.length})`,
    right: money(cdmTotal),
    bold: true,
  });

  lines.push({ kind: 'blank' });
  lines.push({ kind: 'align', value: 'center' });
  lines.push({ text: 'BANK TRANSFER LIST', bold: true });
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'align', value: 'left' });
  pushCollectionList(lines, bankRows, (row) => {
    const ref = listIdentifier(row?.reference, '');
    const date = row?.transferDate ? formatDate(row.transferDate) : '';
    const label = ref ? `Ref ${ref}` : 'Bank transfer';
    return date ? `${label}  ${date}` : label;
  });
  lines.push({ kind: 'rule' });
  lines.push({
    kind: 'cols',
    left: `Transfer total (${bankRows.length})`,
    right: money(bankTotal),
    bold: true,
  });

  lines.push({ kind: 'blank' });
  lines.push({ kind: 'align', value: 'center' });
  lines.push({ text: 'CHEQUE LIST', bold: true });
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'align', value: 'left' });
  pushCollectionList(lines, chequeRows, (row) => {
    const num = listIdentifier(row?.chequeNumber, '');
    const date = formatDate(row?.chequeDate);
    const bits = [];
    if (num) bits.push(`#${num.replace(/^#/, '')}`);
    if (date && date !== '—') bits.push(date);
    return bits.join('  ') || 'Cheque';
  });
  lines.push({ kind: 'rule' });
  lines.push({
    kind: 'cols',
    left: `Cheque total (${chequeRows.length})`,
    right: money(chequeTotal),
    bold: true,
  });

  lines.push({ kind: 'blank' });
  if (report?.collectionOver) {
    lines.push({ kind: 'align', value: 'center' });
    lines.push({ kind: 'rule', char: '=' });
    lines.push({ text: 'COLLECTION OVER', bold: true, double: true });
    lines.push({ text: 'FOR THIS DAY', bold: true });
    lines.push({ text: 'No further payments will be added' });
    lines.push({ kind: 'rule', char: '=' });
    lines.push({ kind: 'blank' });
  }
  lines.push({ kind: 'align', value: 'center' });
  lines.push({ text: formatPrintStamp() });
  return lines;
}

export function buildBillReceiptLines(bill, shop) {
  const items = bagLinesFromRow(bill);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const lines = [
    ...shopLines(shop),
    { kind: 'align', value: 'center' },
    { text: 'INVOICE', bold: true },
    { kind: 'rule' },
    { kind: 'align', value: 'left' },
    { kind: 'cols', left: 'Invoice #', right: display(bill?.invoiceNumber) },
    { kind: 'cols', left: 'Date', right: formatDate(bill?.date) },
    { kind: 'cols', left: 'Customer', right: display(bill?.customerName) },
    ...(bill?.driverName
      ? [{ kind: 'cols', left: 'Driver', right: display(bill.driverName) }]
      : []),
    { kind: 'rule' },
  ];
  if (items.length === 0) {
    lines.push({ text: 'No bag lines' });
  } else {
    for (const item of items) {
      lines.push({ text: item.label, bold: true });
      lines.push({
        kind: 'cols',
        left: `${item.bags} x ${money(item.unitPrice)}`,
        right: money(item.amount),
      });
    }
  }
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'cols', left: 'TOTAL', right: money(total) });
  lines.push({ kind: 'blank' });
  lines.push({ text: 'Received the above goods in correct quantity and in good condition.' });
  lines.push({ kind: 'blank' });
  lines.push({ kind: 'cols', left: 'Customer sign', right: 'Approved' });
  if (bill?.note) {
    lines.push({ kind: 'blank' });
    lines.push({ text: `Note: ${bill.note}` });
  }
  lines.push(...footerLines());
  return lines;
}

const BUILDERS = {
  unload: buildUnloadReceiptLines,
  cashCollection: buildPaymentReceiptLines,
  billGenerate: buildBillReceiptLines,
  dailyCollections: buildDailyCollectionsSummaryLines,
};

export async function printScenarioReceipt(scenarioKey, payload, shop) {
  const builder = BUILDERS[scenarioKey];
  if (!builder) throw new Error('Unknown print scenario.');
  await printEscPosLines(builder(payload, shop));
}
