import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getCachedBrands, formatBrandLabel } from './brandTheme';
import { normalizeBillInvoiceNumber } from './billInvoiceNumber';

const MARGIN = 16;
const BLACK = [0, 0, 0];
const MUTED = [40, 40, 40];

function display(v) {
  const s = String(v ?? '').trim();
  return s || '—';
}

function formatAmount(n) {
  return new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

/** YYYY-MM-DD or Date → DD/MM/YYYY */
function formatDisplayDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
}

/** Print stamp matching typical invoice footers, e.g. 04/09/2026 10:08:41PM */
function formatPrintTimestamp(value = new Date()) {
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
  const hh = String(hours).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${minutes}:${seconds}${ampm}`;
}

function drawInvoiceAcknowledgement(doc, startY, generatedAt) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = startY + 4;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9.5);
  doc.setTextColor(...BLACK);
  const ack = 'Received the above goods in correct quantity and in good condition.';
  const ackLines = doc.splitTextToSize(ack, contentWidth);
  doc.text(ackLines, MARGIN, y);
  y += ackLines.length * 5 + 16;

  const colW = contentWidth / 2;
  const lineW = Math.min(72, colW - 8);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, y, MARGIN + lineW, y);
  doc.line(MARGIN + colW, y, MARGIN + colW + lineW, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Customer Signature & Rubber Stamp', MARGIN, y);
  doc.text('Approved By', MARGIN + colW, y);
  y += 8;

  const stamp = formatPrintTimestamp(generatedAt);
  if (stamp) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(stamp, MARGIN, y);
    doc.setTextColor(...BLACK);
    y += 4;
  }
  return y;
}

function underlineText(doc, text, x, y, options = {}) {
  doc.text(text, x, y, options);
  const w = doc.getTextWidth(text);
  const align = options.align || 'left';
  let x1 = x;
  if (align === 'center') x1 = x - w / 2;
  else if (align === 'right') x1 = x - w;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(x1, y + 0.8, x1 + w, y + 0.8);
}

function lineTotal(bags, unitPrice) {
  const b = Number(bags) || 0;
  const u = Number(unitPrice) || 0;
  return Math.round(b * u * 100) / 100;
}

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function invoiceNumberForBill(bill) {
  return normalizeBillInvoiceNumber(bill.invoiceNumber) || '—';
}

function buildBillLineItems(bill) {
  const brands = getCachedBrands();
  const items = [];

  for (const brand of brands) {
    const bags = Number(bill[`${brand.key}Bags`]) || 0;
    if (bags <= 0) continue;
    const unitPrice = Number(bill[`${brand.key}UnitPrice`]) || 0;
    items.push({
      brandLabel: formatBrandLabel(brand) || brand.label,
      bags,
      unitPrice,
      amount: lineTotal(bags, unitPrice),
    });
  }

  return items;
}

function sortBillsForExport(bills) {
  return [...bills].sort((a, b) => {
    const dateCmp = String(a.date ?? '').localeCompare(String(b.date ?? ''));
    if (dateCmp !== 0) return dateCmp;
    const shopCmp = String(a.customerName ?? '').localeCompare(String(b.customerName ?? ''));
    if (shopCmp !== 0) return shopCmp;
    const stockCmp = String(a.stockId ?? '').localeCompare(String(b.stockId ?? ''));
    if (stockCmp !== 0) return stockCmp;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
}

function buildLoadByStockId(loads) {
  const map = new Map();
  for (const row of Array.isArray(loads) ? loads : []) {
    const stockId = String(row.stockId ?? '').trim();
    if (stockId && !map.has(stockId)) map.set(stockId, row);
  }
  return map;
}

function buildCustomerByName(customers) {
  const map = new Map();
  for (const c of Array.isArray(customers) ? customers : []) {
    const nk = normalizeCustomerName(c.name);
    if (nk && !map.has(nk)) map.set(nk, c);
  }
  return map;
}

function buildUnloadLookups(unloads) {
  const byId = new Map();
  const byBillId = new Map();
  for (const row of Array.isArray(unloads) ? unloads : []) {
    const id = String(row.id ?? '').trim();
    if (id) byId.set(id, row);
    const billId = String(row.billId ?? '').trim();
    if (billId) byBillId.set(billId, row);
  }
  return { byId, byBillId };
}

function resolveUnloadForBill(bill, unloadLookups) {
  const reqId = String(bill.unloadRequestId ?? '').trim();
  if (reqId && unloadLookups.byId.has(reqId)) return unloadLookups.byId.get(reqId);
  const billId = String(bill.id ?? '').trim();
  if (billId && unloadLookups.byBillId.has(billId)) return unloadLookups.byBillId.get(billId);
  return null;
}

function resolveDeliveryInfo(bill, loadByStockId, unload) {
  const stockId = String(bill.stockId ?? '').trim();
  const load = stockId ? loadByStockId.get(stockId) : null;
  const lorryNumber = String(load?.vehicleNumber ?? unload?.vehicleNumber ?? '').trim();
  const driverName = String(unload?.driverName ?? '').trim();
  return { lorryNumber, driverName };
}

function drawLetterhead(doc, opts, yStart) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = yStart;

  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...BLACK);
  doc.text(display(opts.shopName), MARGIN, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);

  if (opts.registrationNo) {
    doc.text(`( Reg. No: ${display(opts.registrationNo)} )`, MARGIN, y);
    y += 5;
  }

  const addressParts = [opts.addressLine1, opts.addressLine2].filter(Boolean);
  if (addressParts.length > 0) {
    const addr = addressParts.join(', ');
    doc.text(addr, MARGIN, y);
    y += 5;
  }

  if (opts.email) {
    doc.text(`E-Mail : ${display(opts.email)}`, MARGIN, y);
    y += 5;
  }

  if (opts.contactNumber) {
    doc.text(`Tele : ${display(opts.contactNumber)}`, MARGIN, y);
    y += 5;
  }

  y += 1;
  if (opts.dealerTagline) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...BLACK);
    doc.text(display(opts.dealerTagline), MARGIN, y);
    y += 5;
  }

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);

  return y + 8;
}

function sumInvoiceDiscountForBill(promotions, billId) {
  const id = String(billId ?? '').trim();
  if (!id) return 0;
  let sum = 0;
  for (const row of Array.isArray(promotions) ? promotions : []) {
    if (String(row?.type ?? '').trim() !== 'invoice_discount') continue;
    if (String(row.billId ?? '').trim() !== id) continue;
    sum += Number(row.discountAmount) || 0;
  }
  return Math.round(sum * 100) / 100;
}

function renderInvoicePage(doc, bill, index, opts, loadByStockId, customerByName, unloadLookups, generatedAt) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = drawLetterhead(doc, opts, 16);

  const invoiceNo = invoiceNumberForBill(bill);
  const invoiceDate = formatDisplayDate(bill.date);
  const customerName = display(bill.customerName);
  const customer = customerByName.get(normalizeCustomerName(bill.customerName));
  const customerLocation = display(customer?.location);
  const unload = resolveUnloadForBill(bill, unloadLookups);
  const { lorryNumber, driverName } = resolveDeliveryInfo(bill, loadByStockId, unload);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  underlineText(doc, 'INVOICE', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  doc.text(`Invoice No : ${invoiceNo}`, MARGIN, y);
  doc.text(`Date : ${invoiceDate}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 7;

  doc.setFont('helvetica', 'bold');
  doc.text('Bill To :', MARGIN, y);
  y += 5;
  doc.text(customerName.toUpperCase(), MARGIN, y);
  y += 5;
  if (customerLocation !== '—') {
    doc.setFont('helvetica', 'normal');
    doc.text(customerLocation, MARGIN, y);
    y += 5;
  }
  y += 2;

  if (lorryNumber || driverName) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    underlineText(doc, 'Delivery Details', MARGIN, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...BLACK);
    if (lorryNumber) {
      doc.text(`Lorry No : ${lorryNumber.toUpperCase()}`, MARGIN, y);
      y += 5;
    }
    if (driverName) {
      doc.text(`Driver Name : ${driverName.toUpperCase()}`, MARGIN, y);
      y += 5;
    }
    y += 3;
  }

  const lineItems = buildBillLineItems(bill);
  const subtotal = lineItems.reduce((sum, row) => sum + row.amount, 0);
  const invoiceDiscount = sumInvoiceDiscountForBill(opts.promotions, bill.id);
  const totalAmount = Math.max(0, Math.round((subtotal - invoiceDiscount) * 100) / 100);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  underlineText(doc, 'Product Details', MARGIN, y);
  y += 4;

  const tableBody =
    lineItems.length > 0
      ? lineItems.map((row) => [
          row.brandLabel,
          String(row.bags),
          formatAmount(row.unitPrice),
          formatAmount(row.amount),
        ])
      : [['Credit sale', '—', '—', formatAmount(bill.totalAmount)]];

  if (invoiceDiscount > 0) {
    tableBody.push(['Promotion discount', '', '', formatAmount(-invoiceDiscount)]);
  }

  autoTable(doc, {
    startY: y,
    head: [['Description', 'Qty (bags)', 'Price / bag (Rs)', 'Amount (Rs)']],
    body: tableBody,
    foot: [['Total', '', '', formatAmount(totalAmount || bill.totalAmount)]],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 10,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.35,
      cellPadding: 2.5,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      halign: 'center',
    },
    footStyles: {
      fillColor: [245, 245, 245],
      textColor: BLACK,
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.42, halign: 'left' },
      1: { cellWidth: contentWidth * 0.16, halign: 'center' },
      2: { cellWidth: contentWidth * 0.2, halign: 'right' },
      3: { cellWidth: contentWidth * 0.22, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  y = (doc.lastAutoTable?.finalY || y) + 8;
  y = drawInvoiceAcknowledgement(doc, y, generatedAt);

  if (opts.deliveryNote) {
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const noteLines = doc.splitTextToSize(String(opts.deliveryNote), contentWidth);
    doc.text(noteLines, MARGIN, y);
  }
}

/**
 * Download one PDF with one invoice page per credit bill (one unload to a shop per day).
 * @param {Array} bills — filtered bill rows
 * @param {{
 *   shopName?: string,
 *   registrationNo?: string,
 *   addressLine1?: string,
 *   addressLine2?: string,
 *   email?: string,
 *   contactNumber?: string,
 *   dealerTagline?: string,
 *   deliveryNote?: string,
 *   loads?: object[],
 *   unloads?: object[],
 *   customers?: object[],
 *   dateFrom?: string,
 *   dateTo?: string,
 *   generatedAt?: Date,
 * }} [opts]
 */
export function downloadBillsInvoicesPdf(bills, opts = {}) {
  const list = sortBillsForExport(Array.isArray(bills) ? bills : []);
  if (list.length === 0) return;

  const loadByStockId = buildLoadByStockId(opts.loads);
  const unloadLookups = buildUnloadLookups(opts.unloads);
  const customerByName = buildCustomerByName(opts.customers);
  const generatedAt = opts.generatedAt instanceof Date ? opts.generatedAt : new Date();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  list.forEach((bill, index) => {
    if (index > 0) doc.addPage();
    renderInvoicePage(doc, bill, index, opts, loadByStockId, customerByName, unloadLookups, generatedAt);
  });

  const { dateFrom = '', dateTo = '' } = opts;
  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`invoices-${rangeSlug}-${stamp}.pdf`);
}
