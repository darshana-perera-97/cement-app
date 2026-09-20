import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getApiBase } from '../apiBase';
import { DEFAULT_SHOP_NAME } from '../shopConfig';
import {
  cashPortion,
  cdmPortion,
  chequePortion,
  getPaymentCdmDeposits,
  getPaymentCheques,
  getPaymentOnlineTransfers,
  onlineTransferPortion,
} from './paymentCheques';
import { getPaymentReceiptInvoices } from './paymentReceipt';

const MARGIN = 8;
const BLACK = [0, 0, 0];
const MUTED = [40, 40, 40];
const FONT = {
  shop: 12.5,
  header: 8,
  title: 11,
  section: 9,
  body: 8.5,
  table: 8,
};
const LINE = 3.6;
const SHOP_LINE = 4.4;

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

function underlineText(doc, text, x, y, options = {}) {
  doc.text(text, x, y, options);
  const w = doc.getTextWidth(text);
  const align = options.align || 'left';
  let x1 = x;
  if (align === 'center') x1 = x - w / 2;
  else if (align === 'right') x1 = x - w;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.22);
  doc.line(x1, y + 0.55, x1 + w, y + 0.55);
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

function gridTableOptions() {
  return {
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: FONT.table,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.22,
      cellPadding: { top: 1.05, bottom: 1.05, left: 1.2, right: 1.2 },
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      fontSize: FONT.table,
      halign: 'center',
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      fontSize: FONT.table,
      halign: 'right',
    },
    margin: { left: MARGIN, right: MARGIN },
  };
}

function drawSectionTitle(doc, title, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.section);
  doc.setTextColor(...BLACK);
  underlineText(doc, title, MARGIN, y);
  return y + 2.4;
}

function receiptFilename(payment) {
  const safe = String(payment?.billNumber || payment?.id || 'receipt').replace(/[^\w.-]+/g, '_');
  return `receipt-${safe}.pdf`;
}

export async function loadShopDetailsForPdf() {
  try {
    const res = await fetch(`${getApiBase()}/api/shop`);
    if (!res.ok) return { shopName: DEFAULT_SHOP_NAME };
    const data = await res.json();
    return {
      shopName: String(data?.shopName ?? '').trim() || DEFAULT_SHOP_NAME,
      registrationNo: data?.registrationNo ?? '',
      addressLine1: data?.addressLine1 ?? '',
      addressLine2: data?.addressLine2 ?? '',
      email: data?.email ?? '',
      contactNumber: data?.contactNumber ?? '',
      dealerCode: data?.dealerCode ?? '',
      dealerTagline: data?.dealerTagline ?? '',
    };
  } catch {
    return { shopName: DEFAULT_SHOP_NAME };
  }
}

/**
 * Build a single A5 payment receipt PDF (same letterhead format as the PO).
 * @returns {{ doc: import('jspdf').jsPDF, filename: string } | null}
 */
export function buildPaymentReceiptPdf(payment, opts = {}) {
  if (!payment || typeof payment !== 'object') return null;

  const shopName = String(opts.shopName || '').trim() || DEFAULT_SHOP_NAME;
  const registrationNo = String(opts.registrationNo || '').trim();
  const addressLine1 = String(opts.addressLine1 || '').trim();
  const addressLine2 = String(opts.addressLine2 || '').trim();
  const email = String(opts.email || '').trim();
  const contactNumber = String(opts.contactNumber || '').trim();
  const dealerCode = String(opts.dealerCode || '').trim();
  const dealerTagline =
    String(opts.dealerTagline || '').trim() ||
    'Authorized dealer for the products of Tokyo Cement Company Lanka PLC';

  const cash = cashPortion(payment);
  const cheque = chequePortion(payment);
  const cdm = cdmPortion(payment);
  const online = onlineTransferPortion(payment);
  const total = Number(payment.amount) || cash + cheque + cdm + online;
  const cheques = getPaymentCheques(payment);
  const cdmDeposits = getPaymentCdmDeposits(payment);
  const onlineTransfers = getPaymentOnlineTransfers(payment);
  const invoices = getPaymentReceiptInvoices(payment);
  const generatedAt = opts.generatedAt instanceof Date ? opts.generatedAt : new Date();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;

  doc.setProperties({
    title: `Payment Receipt ${display(payment.billNumber)}`,
    subject: 'Payment receipt',
  });

  let y = 8;

  doc.setFont('times', 'bold');
  doc.setFontSize(FONT.shop);
  doc.setTextColor(...BLACK);
  const shopLines = doc.splitTextToSize(shopName, contentWidth);
  doc.text(shopLines, MARGIN, y);
  y += shopLines.length * SHOP_LINE;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.header);
  doc.setTextColor(...MUTED);

  if (registrationNo) {
    doc.text(`( Reg. No: ${registrationNo} )`, MARGIN, y);
    y += LINE;
  }

  const addressParts = [addressLine1, addressLine2].filter(Boolean);
  if (addressParts.length > 0) {
    const addrLines = doc.splitTextToSize(addressParts.join(', '), contentWidth);
    doc.text(addrLines, MARGIN, y);
    y += addrLines.length * LINE;
  }

  if (email) {
    doc.text(`E-Mail : ${email}`, MARGIN, y);
    y += LINE;
  }

  if (contactNumber) {
    doc.text(`Tele : ${contactNumber}`, MARGIN, y);
    y += LINE;
  }

  y += 0.6;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(FONT.header);
  doc.setTextColor(...BLACK);
  const tagLines = doc.splitTextToSize(dealerTagline, contentWidth);
  doc.text(tagLines, MARGIN, y);
  y += tagLines.length * LINE;

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.body);
  doc.setTextColor(...BLACK);

  const receiptNo = display(payment.billNumber);
  const receiptDate = formatDisplayDate(payment.date);

  if (dealerCode) {
    doc.text(`Dealer Code : ${display(dealerCode)}`, MARGIN, y);
  }
  doc.text(`Receipt NO : ${receiptNo}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 4.4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.title);
  underlineText(doc, 'PAYMENT RECEIPT', pageWidth / 2, y, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.body);
  doc.text(`DATE : ${receiptDate}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 5.2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.body);
  const customerName = display(payment.customerName).toUpperCase();
  const customerLines = doc.splitTextToSize(`Received from : ${customerName}`, contentWidth);
  doc.text(customerLines, MARGIN, y);
  y += customerLines.length * LINE;
  doc.text(`Collected by : ${display(payment.recordedBy)}`, MARGIN, y);
  y += LINE + 1.8;

  y = drawSectionTitle(doc, 'AMOUNT RECEIVED', y);

  const breakdown = [];
  if (cash > 0) breakdown.push(['Cash', formatAmount(cash)]);
  if (cheque > 0) breakdown.push(['Cheque', formatAmount(cheque)]);
  if (cdm > 0) breakdown.push(['CDM deposit', formatAmount(cdm)]);
  if (online > 0) breakdown.push(['Online transfer', formatAmount(online)]);
  if (breakdown.length === 0 && total > 0) {
    breakdown.push(['Received', formatAmount(total)]);
  }
  if (breakdown.length === 0) {
    breakdown.push(['Received', formatAmount(0)]);
  }

  autoTable(doc, {
    startY: y,
    head: [['Type / Mode', 'Amount(Rs:)']],
    body: breakdown,
    foot: [
      [
        { content: 'TOTAL RECEIVED', styles: { halign: 'left', fontStyle: 'bold' } },
        { content: formatAmount(total), styles: { halign: 'right', fontStyle: 'bold' } },
      ],
    ],
    ...gridTableOptions(),
    columnStyles: {
      0: { cellWidth: contentWidth * 0.62, halign: 'left' },
      1: { cellWidth: contentWidth * 0.38, halign: 'right' },
    },
  });
  y = (doc.lastAutoTable?.finalY || y) + 3.2;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(FONT.header);
  doc.setTextColor(...BLACK);
  const words = `Amount in words : ${amountInWords(total)}`;
  const wordLines = doc.splitTextToSize(words, contentWidth);
  doc.text(wordLines, MARGIN, y);
  y += wordLines.length * LINE + 2.2;

  if (cheques.length > 0) {
    y = drawSectionTitle(doc, cheques.length === 1 ? 'CHEQUE DETAILS' : 'CHEQUES', y);
    autoTable(doc, {
      startY: y,
      head: [['Cheque No', 'Bank', 'Date', 'Amount(Rs:)']],
      body: cheques.map((c) => [
        display(c.chequeNumber),
        display(c.chequeBank),
        formatDisplayDate(c.chequeDate),
        formatAmount(c.amount),
      ]),
      ...gridTableOptions(),
      columnStyles: {
        0: { cellWidth: contentWidth * 0.24, halign: 'center' },
        1: { cellWidth: contentWidth * 0.28, halign: 'center' },
        2: { cellWidth: contentWidth * 0.22, halign: 'center' },
        3: { cellWidth: contentWidth * 0.26, halign: 'right' },
      },
    });
    y = (doc.lastAutoTable?.finalY || y) + 3.6;
  }

  if (cdmDeposits.length > 0) {
    y = drawSectionTitle(doc, cdmDeposits.length === 1 ? 'CDM DETAILS' : 'CDM DEPOSITS', y);
    autoTable(doc, {
      startY: y,
      head: [['Ref No', 'Amount(Rs:)', 'Bank', 'Acc No']],
      body: cdmDeposits.map((d) => [
        display(d.cdmNumber),
        formatAmount(d.amount),
        display(bankNameFromSnap(d.bankAccount)),
        display(accountNoFromSnap(d.bankAccount)),
      ]),
      ...gridTableOptions(),
      columnStyles: {
        0: { cellWidth: contentWidth * 0.24, halign: 'center' },
        1: { cellWidth: contentWidth * 0.26, halign: 'right' },
        2: { cellWidth: contentWidth * 0.24, halign: 'center' },
        3: { cellWidth: contentWidth * 0.26, halign: 'center' },
      },
    });
    y = (doc.lastAutoTable?.finalY || y) + 3.6;
  }

  if (onlineTransfers.length > 0) {
    y = drawSectionTitle(doc, onlineTransfers.length === 1 ? 'TRANSFER DETAILS' : 'ONLINE TRANSFERS', y);
    autoTable(doc, {
      startY: y,
      head: [['Ref No', 'Amount(Rs:)', 'Bank', 'Acc No']],
      body: onlineTransfers.map((t) => [
        display(t.reference),
        formatAmount(t.amount),
        display(bankNameFromSnap(t.bankAccount)),
        display(accountNoFromSnap(t.bankAccount)),
      ]),
      ...gridTableOptions(),
      columnStyles: {
        0: { cellWidth: contentWidth * 0.24, halign: 'center' },
        1: { cellWidth: contentWidth * 0.26, halign: 'right' },
        2: { cellWidth: contentWidth * 0.24, halign: 'center' },
        3: { cellWidth: contentWidth * 0.26, halign: 'center' },
      },
    });
    y = (doc.lastAutoTable?.finalY || y) + 3.6;
  }

  if (invoices.length > 0) {
    y = drawSectionTitle(doc, 'INVOICES', y);
    autoTable(doc, {
      startY: y,
      head: [['Invoice', 'Date', 'Invoice Amt', 'Remaining']],
      body: invoices.map((inv) => [
        invoiceTitle(inv),
        formatDisplayDate(inv.date),
        inv.billTotal > 0 ? formatAmount(inv.billTotal) : '—',
        inv.remainingAfter == null ? '—' : formatAmount(inv.remainingAfter),
      ]),
      ...gridTableOptions(),
      columnStyles: {
        0: { cellWidth: contentWidth * 0.28, halign: 'left' },
        1: { cellWidth: contentWidth * 0.22, halign: 'center' },
        2: { cellWidth: contentWidth * 0.25, halign: 'right' },
        3: { cellWidth: contentWidth * 0.25, halign: 'right' },
      },
    });
    y = (doc.lastAutoTable?.finalY || y) + 3.6;
  }

  const note = String(payment.note ?? '').trim();
  if (note) {
    y = drawSectionTitle(doc, 'NOTES', y) + 1;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.body);
    const noteLines = doc.splitTextToSize(note, contentWidth);
    doc.text(noteLines, MARGIN, y);
    y += noteLines.length * LINE + 3;
  }

  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 28) {
    doc.addPage();
    y = 14;
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(FONT.header);
  doc.setTextColor(...BLACK);
  doc.text('This is an official receipt. Thank you for your payment.', MARGIN, y);
  y += 14;

  const colW = contentWidth / 2;
  const lineW = Math.min(48, colW - 6);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, y, MARGIN + lineW, y);
  doc.line(MARGIN + colW, y, MARGIN + colW + lineW, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.header);
  doc.text('Received by', MARGIN, y);
  doc.text('Customer', MARGIN + colW, y);
  y += 6;

  const stamp = formatPrintTimestamp(generatedAt);
  if (stamp) {
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(stamp, MARGIN, y);
  }

  return { doc, filename: receiptFilename(payment) };
}

export function downloadPaymentReceiptPdf(payment, opts = {}) {
  const built = buildPaymentReceiptPdf(payment, opts);
  if (!built) return;
  built.doc.save(built.filename);
}

/** Create a blob URL for in-app preview. Caller must revoke with URL.revokeObjectURL. */
export function paymentReceiptPdfBlobUrl(payment, opts = {}) {
  const built = buildPaymentReceiptPdf(payment, opts);
  if (!built) return null;
  const blob = built.doc.output('blob');
  return { url: URL.createObjectURL(blob), filename: built.filename };
}
