import { formatBrandLabel, getCachedBrands } from '../dashboard/brandTheme';
import { cashPortion, cdmPortion, chequePortion, getPaymentCheques, onlineTransferPortion } from '../dashboard/paymentCheques';
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

function shopLines(shop) {
  const lines = [];
  const name = display(shop?.shopName || 'Shop');
  lines.push({ kind: 'align', value: 'center' });
  lines.push({ text: name, bold: true, double: true });
  const address = [shop?.addressLine1, shop?.addressLine2].map((x) => String(x ?? '').trim()).filter(Boolean);
  for (const line of address) lines.push({ text: line });
  if (shop?.contactNumber) lines.push({ text: `Tel: ${shop.contactNumber}` });
  if (shop?.registrationNo) lines.push({ text: `Reg: ${shop.registrationNo}` });
  lines.push({ kind: 'rule' });
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
      label: formatBrandLabel(brand) || brand.label || brand.key,
      bags,
      unitPrice,
      amount: Math.round(bags * unitPrice * 100) / 100,
    });
  }
  return items;
}

function footerLines() {
  return [
    { kind: 'blank' },
    { kind: 'align', value: 'center' },
    { text: 'Thank you' },
    { text: new Date().toLocaleString() },
  ];
}

export function buildUnloadReceiptLines(unload, shop) {
  const items = bagLinesFromRow(unload);
  const totalBags = items.reduce((s, i) => s + i.bags, 0);
  const lines = [
    ...shopLines(shop),
    { kind: 'align', value: 'center' },
    { text: 'UNLOAD SLIP', bold: true },
    { kind: 'rule' },
    { kind: 'align', value: 'left' },
    { kind: 'cols', left: 'Date', right: formatDate(unload?.date) },
    { kind: 'cols', left: 'Shop', right: display(unload?.customerName) },
    { kind: 'cols', left: 'Driver', right: display(unload?.driverName || unload?.recordedBy) },
    { kind: 'cols', left: 'Status', right: display(unload?.status || 'pending') },
    { kind: 'rule' },
  ];
  if (items.length === 0) {
    lines.push({ text: 'No bag lines' });
  } else {
    lines.push({ kind: 'cols', left: 'Product', right: 'Bags' });
    for (const item of items) {
      lines.push({ kind: 'cols', left: item.label, right: String(item.bags) });
    }
  }
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'cols', left: 'Total bags', right: String(totalBags) });
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
  const lines = [
    ...shopLines(shop),
    { kind: 'align', value: 'center' },
    { text: 'PAYMENT RECEIPT', bold: true },
    { kind: 'rule' },
    { kind: 'align', value: 'left' },
    { kind: 'cols', left: 'Receipt #', right: display(payment?.billNumber) },
    { kind: 'cols', left: 'Date', right: formatDate(payment?.date) },
    { kind: 'cols', left: 'Customer', right: display(payment?.customerName) },
    { kind: 'cols', left: 'Collected by', right: display(payment?.recordedBy) },
    { kind: 'rule' },
  ];
  if (cash > 0) lines.push({ kind: 'cols', left: 'Cash', right: money(cash) });
  if (cheque > 0) lines.push({ kind: 'cols', left: 'Cheque', right: money(cheque) });
  if (cdm > 0) lines.push({ kind: 'cols', left: 'CDM', right: money(cdm) });
  if (online > 0) lines.push({ kind: 'cols', left: 'Online', right: money(online) });
  if (cheques.length > 0) {
    lines.push({ kind: 'blank' });
    for (const c of cheques) {
      const num = c.chequeNumber ? `#${c.chequeNumber}` : 'Cheque';
      const bank = c.chequeBank ? ` ${c.chequeBank}` : '';
      lines.push({ kind: 'cols', left: `${num}${bank}`.trim(), right: money(c.amount) });
    }
  }
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'cols', left: 'TOTAL', right: money(payment?.amount) });
  if (payment?.note) {
    lines.push({ kind: 'blank' });
    lines.push({ text: `Note: ${payment.note}` });
  }
  lines.push(...footerLines());
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
};

export async function printScenarioReceipt(scenarioKey, payload, shop) {
  const builder = BUILDERS[scenarioKey];
  if (!builder) throw new Error('Unknown print scenario.');
  await printEscPosLines(builder(payload, shop));
}
