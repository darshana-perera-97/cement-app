import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getCachedBrands } from './brandTheme';
import { normalizeBillInvoiceNumber } from './billInvoiceNumber';
import {
  purchaserTaxAddress,
  purchaserTaxName,
  purchaserTaxPhone,
  supplierTaxAddress,
} from './customerTaxUtils';

const MARGIN = 14;
const BLACK = [0, 0, 0];
const VAT_RATE = 0.18;

function display(v) {
  const s = String(v ?? '').trim();
  return s || '';
}

function formatAmount(n) {
  return new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatDisplayDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function lineTotal(bags, unitPrice) {
  const b = Number(bags) || 0;
  const u = Number(unitPrice) || 0;
  return Math.round(b * u * 100) / 100;
}

function buildBillLineItems(bill) {
  const brands = getCachedBrands();
  const items = [];
  for (const brand of brands) {
    const bags = Number(bill[`${brand.key}Bags`]) || 0;
    if (bags <= 0) continue;
    const unitPrice = Number(bill[`${brand.key}UnitPrice`]) || 0;
    items.push({
      reference: String(bill.stockId ?? '').trim() || '—',
      description: brand.label,
      quantity: bags,
      unitPrice,
      amountExVat: lineTotal(bags, unitPrice),
    });
  }
  return items;
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

function drawBox(doc, x, y, w, h) {
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.rect(x, y, w, h);
}

function labelColon(label) {
  const base = String(label ?? '')
    .trim()
    .replace(/\s*:\s*$/, '');
  return `${base} : `;
}

function drawLabeledField(doc, label, value, x, y, w, h) {
  drawBox(doc, x, y, w, h);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...BLACK);
  const labelText = labelColon(label);
  doc.text(labelText, x + 2, y + 6);
  const labelW = doc.getTextWidth(labelText);
  const valLines = doc.splitTextToSize(display(value) || '—', w - labelW - 4);
  doc.text(valLines[0] ?? '—', x + 2 + labelW, y + 6);
}

function drawPartyBox(doc, title, fields, x, y, w, h) {
  drawBox(doc, x, y, w, h);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(title, x + 2, y + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let cy = y + 9;
  for (const { label, value } of fields) {
    const labelText = labelColon(label);
    doc.setFont('helvetica', 'bold');
    doc.text(labelText, x + 2, cy);
    doc.setFont('helvetica', 'normal');
    const labelW = doc.getTextWidth(labelText);
    const valLines = doc.splitTextToSize(display(value) || '—', w - labelW - 4);
    doc.text(valLines[0] ?? '—', x + 2 + labelW, cy);
    cy += 5.5;
  }
}

const BELOW_TWENTY = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function wordsUnder1000(n) {
  const num = Math.floor(n);
  if (num === 0) return '';
  if (num < 20) return BELOW_TWENTY[num];
  if (num < 100) {
    const t = Math.floor(num / 10);
    const r = num % 10;
    return r ? `${TENS[t]} ${BELOW_TWENTY[r]}` : TENS[t];
  }
  const h = Math.floor(num / 100);
  const r = num % 100;
  return r ? `${BELOW_TWENTY[h]} Hundred ${wordsUnder1000(r)}` : `${BELOW_TWENTY[h]} Hundred`;
}

function integerToWords(n) {
  const num = Math.floor(Math.abs(n));
  if (num === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const rest = num % 1000;
  if (crore) parts.push(`${wordsUnder1000(crore)} Crore`);
  if (lakh) parts.push(`${wordsUnder1000(lakh)} Lakh`);
  if (thousand) parts.push(`${wordsUnder1000(thousand)} Thousand`);
  if (rest) parts.push(wordsUnder1000(rest));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function amountInWords(amount) {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(n);
  const cents = Math.round((n - rupees) * 100);
  let text = `${integerToWords(rupees)} Rupee${rupees === 1 ? '' : 's'}`;
  if (cents > 0) {
    text += ` and ${integerToWords(cents)} Cent${cents === 1 ? '' : 's'}`;
  }
  return `${text} Only`;
}

function resolveDeliveryDate(bill, unloads) {
  const billId = String(bill.id ?? '').trim();
  for (const row of Array.isArray(unloads) ? unloads : []) {
    if (String(row.billId ?? '').trim() === billId) {
      return formatDisplayDate(row.date || row.unloadDate);
    }
    if (String(row.id ?? '').trim() === String(bill.unloadRequestId ?? '').trim()) {
      return formatDisplayDate(row.date || row.unloadDate);
    }
  }
  return formatDisplayDate(bill.date);
}

function renderTaxInvoicePage(doc, bill, opts) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  const shop = opts.shop || {};
  const customer = opts.customer || {};
  const invoiceNo = normalizeBillInvoiceNumber(bill.invoiceNumber) || '—';
  const invoiceDate = formatDisplayDate(bill.date);
  const deliveryDate = resolveDeliveryDate(bill, opts.unloads);
  const placeOfSupply = display(customer.placeOfSupply || customer.location);
  const additionalInfo = display(customer.taxAdditionalInfo);

  drawBox(doc, MARGIN, y, contentWidth, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Tax Invoice', pageWidth / 2, y + 7, { align: 'center' });
  y += 10;

  const halfW = contentWidth / 2;
  drawLabeledField(doc, 'Date of Invoice:', invoiceDate, MARGIN, y, halfW, 10);
  drawLabeledField(doc, 'Tax Invoice No.:', invoiceNo, MARGIN + halfW, y, halfW, 10);
  y += 10;

  const partyH = 28;
  drawPartyBox(
    doc,
    "Supplier's",
    [
      { label: 'TIN', value: shop.supplierTin },
      { label: 'Name', value: shop.shopName },
      { label: 'Address', value: supplierTaxAddress(shop) },
      { label: 'Telephone No', value: shop.contactNumber },
    ],
    MARGIN,
    y,
    halfW,
    partyH,
  );
  drawPartyBox(
    doc,
    "Purchaser's",
    [
      { label: 'TIN', value: customer.purchaserTin },
      { label: 'Name', value: purchaserTaxName(customer) },
      { label: 'Address', value: purchaserTaxAddress(customer) },
      { label: 'Telephone No', value: purchaserTaxPhone(customer) },
    ],
    MARGIN + halfW,
    y,
    halfW,
    partyH,
  );
  y += partyH;

  drawLabeledField(doc, 'Date of Delivery:', deliveryDate, MARGIN, y, halfW, 10);
  drawLabeledField(doc, 'Place of Supply:', placeOfSupply, MARGIN + halfW, y, halfW, 10);
  y += 10;

  drawLabeledField(doc, 'Additional Information if any:', additionalInfo, MARGIN, y, contentWidth, 12);
  y += 12;

  const lineItems = buildBillLineItems(bill);
  const invoiceDiscount = sumInvoiceDiscountForBill(opts.promotions, bill.id);
  let subtotalExVat = lineItems.reduce((sum, row) => sum + row.amountExVat, 0);
  if (lineItems.length === 0) {
    subtotalExVat = Number(bill.totalAmount) || 0;
  }
  subtotalExVat = Math.max(0, Math.round((subtotalExVat - invoiceDiscount) * 100) / 100);
  const vatAmount = Math.round(subtotalExVat * VAT_RATE * 100) / 100;
  const totalIncVat = Math.round((subtotalExVat + vatAmount) * 100) / 100;

  const tableBody =
    lineItems.length > 0
      ? lineItems.map((row, i) => [
          row.reference || String(i + 1),
          row.description,
          String(row.quantity),
          formatAmount(row.unitPrice),
          formatAmount(row.amountExVat),
        ])
      : [['—', 'Credit sale (cement bags)', '—', '—', formatAmount(subtotalExVat)]];

  if (invoiceDiscount > 0) {
    tableBody.push(['', 'Promotion discount', '', '', formatAmount(-invoiceDiscount)]);
  }

  autoTable(doc, {
    startY: y,
    head: [
      [
        'Reference',
        'Description of Goods or Services',
        'Quantity',
        'Unit Price',
        'Amount Excluding VAT (Rs.)',
      ],
    ],
    body: tableBody,
    foot: [
      ['', 'Total Value of Supply:', '', '', formatAmount(subtotalExVat)],
      ['', `VAT Amount (Total Value of Supply @ ${VAT_RATE * 100}%):`, '', '', formatAmount(vatAmount)],
      ['', 'Total Amount including VAT:', '', '', formatAmount(totalIncVat)],
    ],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.35,
      cellPadding: 2,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 8,
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      halign: 'right',
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.14, halign: 'center' },
      1: { cellWidth: contentWidth * 0.36, halign: 'left' },
      2: { cellWidth: contentWidth * 0.12, halign: 'center' },
      3: { cellWidth: contentWidth * 0.18, halign: 'right' },
      4: { cellWidth: contentWidth * 0.2, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  y = (doc.lastAutoTable?.finalY || y) + 4;

  const modeOfPayment = opts.modeOfPayment || 'Credit';
  drawLabeledField(
    doc,
    'Total Amount in words:',
    amountInWords(totalIncVat),
    MARGIN,
    y,
    contentWidth,
    12,
  );
  y += 12;
  drawLabeledField(doc, 'Mode of Payment:', modeOfPayment, MARGIN, y, contentWidth, 10);
}

/**
 * Download a tax invoice PDF for a single credit bill.
 */
export function downloadTaxInvoicePdf(bill, opts = {}) {
  if (!bill) return;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  renderTaxInvoicePage(doc, bill, opts);
  const customerName = String(opts.customer?.name ?? bill.customerName ?? 'customer')
    .replace(/[^\w\-]+/g, '-')
    .slice(0, 40);
  const invoiceNo = normalizeBillInvoiceNumber(bill.invoiceNumber) || bill.id || 'invoice';
  const dateSlug = String(bill.date ?? '').slice(0, 10);
  doc.save(`tax-invoice-${customerName}-${invoiceNo}-${dateSlug}.pdf`);
}
