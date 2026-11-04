import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getApiBase } from '../apiBase';
import { DEFAULT_SHOP_NAME } from '../shopConfig';
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

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Promotion amounts are VAT-inclusive, matching tax invoices. */
function splitInclusiveVat(inclusiveTotal) {
  const total = roundMoney(inclusiveTotal);
  const valueOfSupply = roundMoney(total / (1 + VAT_RATE));
  return {
    valueOfSupply,
    vatAmount: roundMoney(total - valueOfSupply),
    totalIncVat: total,
  };
}

export function targetPromotionCreditNoteNumber(row) {
  const stored = String(row?.creditNoteNumber ?? '').trim();
  if (stored) return stored;
  const id = String(row?.id ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase();
  return id ? `CN-${id}` : 'CN-001';
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
  const valLines = doc.splitTextToSize(display(value) || '—', Math.max(8, w - labelW - 4));
  doc.text(valLines[0] ?? '—', x + 2 + labelW, y + 6);
}

function drawWrappedField(doc, label, value, x, y, w) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const labelText = labelColon(label);
  const labelW = doc.getTextWidth(labelText);
  const text = display(value) || '—';
  const sameLine = doc.splitTextToSize(text, Math.max(8, w - labelW - 4));
  const useSameLine = sameLine.length === 1;
  const lines = useSameLine ? sameLine : doc.splitTextToSize(text, w - 4);
  const h = useSameLine ? 10 : Math.max(16, 8 + lines.length * 4);
  drawBox(doc, x, y, w, h);
  doc.setTextColor(...BLACK);
  doc.text(labelText, x + 2, y + 6);
  if (useSameLine) {
    doc.text(lines[0], x + 2 + labelW, y + 6);
  } else {
    doc.text(lines, x + 2, y + 11);
  }
  return h;
}

function drawPartyBox(doc, title, fields, x, y, w, h) {
  drawBox(doc, x, y, w, h);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...BLACK);
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
    const valLines = doc.splitTextToSize(display(value) || '—', Math.max(8, w - labelW - 4));
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
  const n = roundMoney(amount);
  const rupees = Math.floor(n);
  const cents = Math.round((n - rupees) * 100);
  let text = `${integerToWords(rupees)} Rupee${rupees === 1 ? '' : 's'}`;
  if (cents > 0) {
    text += ` and ${integerToWords(cents)} Cent${cents === 1 ? '' : 's'}`;
  }
  return `${text} Only`;
}

function drawAcknowledgement(doc, startY, generatedAt, recordedBy) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = startY + 4;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  const ack =
    'This credit note is issued for a target promotion. The total amount including VAT is credited to the customer ledger.';
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
  doc.setFontSize(8.5);
  doc.text('Customer Signature & Rubber Stamp', MARGIN, y);
  doc.text('Approved By', MARGIN + colW, y);
  y += 8;

  const stamp = formatPrintTimestamp(generatedAt);
  if (stamp) {
    doc.setFontSize(8);
    doc.text(stamp, MARGIN, y);
    y += 4;
  }
  const recorder = display(recordedBy);
  if (recorder) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Recorded by : ${recorder}`, MARGIN, y + 1);
    y += 5;
  }
  return y;
}

async function loadShopForCreditNote() {
  try {
    const res = await fetch(`${getApiBase()}/api/shop`);
    if (!res.ok) return { shopName: DEFAULT_SHOP_NAME };
    const data = await res.json();
    return {
      shopName: String(data?.shopName ?? '').trim() || DEFAULT_SHOP_NAME,
      addressLine1: data?.addressLine1 ?? '',
      addressLine2: data?.addressLine2 ?? '',
      contactNumber: data?.contactNumber ?? '',
      supplierTin: data?.supplierTin ?? '',
    };
  } catch {
    return { shopName: DEFAULT_SHOP_NAME };
  }
}

/**
 * Standard credit note for a target promotion, laid out like the tax invoice.
 * @returns {{ doc: import('jspdf').jsPDF, filename: string } | null}
 */
export function buildTargetPromotionCreditNotePdf(promotion, opts = {}) {
  if (!promotion || String(promotion.type ?? '').trim() !== 'target_promotion') return null;

  const shop = opts.shop || {};
  const customer = opts.customer || {};
  const creditNoteNo = targetPromotionCreditNoteNumber(promotion);
  const creditDate = formatDisplayDate(promotion.date);
  const reason = display(promotion.reason) || 'Target promotion';
  const placeOfSupply = display(customer.placeOfSupply || customer.location);
  const totals = splitInclusiveVat(promotion.discountAmount);
  const generatedAt = opts.generatedAt instanceof Date ? opts.generatedAt : new Date();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  drawBox(doc, MARGIN, y, contentWidth, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...BLACK);
  doc.text('Credit Note', pageWidth / 2, y + 7, { align: 'center' });
  y += 10;

  const halfW = contentWidth / 2;
  drawLabeledField(doc, 'Date of Credit Note', creditDate, MARGIN, y, halfW, 10);
  drawLabeledField(doc, 'Credit Note No.', creditNoteNo, MARGIN + halfW, y, halfW, 10);
  y += 10;

  const partyH = 34;
  drawPartyBox(
    doc,
    "Supplier's",
    [
      { label: 'TIN', value: shop.supplierTin },
      { label: 'Name', value: shop.shopName || DEFAULT_SHOP_NAME },
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
      { label: 'Name', value: purchaserTaxName(customer) || promotion.customerName },
      { label: 'Address', value: purchaserTaxAddress(customer) },
      { label: 'Telephone No', value: purchaserTaxPhone(customer) },
    ],
    MARGIN + halfW,
    y,
    halfW,
    partyH,
  );
  y += partyH;

  drawLabeledField(doc, 'Reference', 'Target promotion', MARGIN, y, halfW, 10);
  drawLabeledField(doc, 'Place of Supply', placeOfSupply, MARGIN + halfW, y, halfW, 10);
  y += 10;

  y += drawWrappedField(doc, 'Reason for credit note', reason, MARGIN, y, contentWidth);

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
    body: [[creditNoteNo, 'Target promotion reward', '—', '—', formatAmount(totals.valueOfSupply)]],
    foot: [
      ['', 'Total Value of Supply:', '', '', formatAmount(totals.valueOfSupply)],
      ['', `VAT Amount (Total Value of Supply @ ${VAT_RATE * 100}%):`, '', '', formatAmount(totals.vatAmount)],
      ['', 'Total Amount including VAT:', '', '', formatAmount(totals.totalIncVat)],
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
      0: { cellWidth: contentWidth * 0.16, halign: 'center' },
      1: { cellWidth: contentWidth * 0.34, halign: 'left' },
      2: { cellWidth: contentWidth * 0.12, halign: 'center' },
      3: { cellWidth: contentWidth * 0.16, halign: 'right' },
      4: { cellWidth: contentWidth * 0.22, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  y = (doc.lastAutoTable?.finalY || y) + 4;
  if (y > pageHeight - 70) {
    doc.addPage();
    y = MARGIN;
  }

  drawLabeledField(doc, 'Total Amount in words', amountInWords(totals.totalIncVat), MARGIN, y, contentWidth, 12);
  y += 12;
  drawLabeledField(doc, 'Nature of adjustment', 'Credit to customer ledger', MARGIN, y, contentWidth, 10);

  const endY = drawAcknowledgement(doc, y + 10, generatedAt, promotion.enteredBy || promotion.updatedBy);
  const shopId = display(customer.id || promotion.customerId);
  if (shopId) {
    let footerY = endY + 8;
    if (footerY > pageHeight - 16) {
      doc.addPage();
      footerY = 16;
    }
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.35);
    doc.line(MARGIN, footerY, pageWidth - MARGIN, footerY);
    footerY += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BLACK);
    doc.text(`Shop ID : ${shopId}`, pageWidth / 2, footerY, { align: 'center' });
  }

  const customerName = String(promotion.customerName || customer.name || 'customer')
    .replace(/[^\w-]+/g, '-')
    .slice(0, 40);
  const dateSlug = String(promotion.date ?? '').slice(0, 10);
  const noteSlug = creditNoteNo.replace(/[^\w.-]+/g, '-');
  return {
    doc,
    filename: `credit-note-${customerName}-${noteSlug}-${dateSlug}.pdf`,
  };
}

export async function downloadTargetPromotionCreditNote(promotion, customer = {}) {
  const shop = await loadShopForCreditNote();
  const built = buildTargetPromotionCreditNotePdf(promotion, { shop, customer });
  if (!built) return;
  built.doc.save(built.filename);
}
