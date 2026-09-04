import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doorStepNotesText, isPoCashPayment, poChequeBankLabel } from './poChequeDisplay';
import { formatProductNameWithCode } from './brandTheme';

const MARGIN = 10;
const BLACK = [0, 0, 0];
const MUTED = [40, 40, 40];
const FONT = {
  shop: 16,
  header: 10.5,
  title: 14,
  section: 12,
  body: 11,
  table: 11,
};
const LINE = 4.8;

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

function formatPrice(n) {
  return new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
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

function orderNumberDisplay(poNumber) {
  const raw = String(poNumber ?? '').trim();
  if (!raw) return '—';
  const digits = raw.replace(/^PO-/i, '').replace(/\D/g, '');
  if (digits) return digits.padStart(Math.max(6, digits.length), '0');
  return raw;
}

function poPaymentRefDisplay(c, bankAccounts) {
  if (isPoCashPayment(c)) return 'Cash';
  const num = display(c?.chequeNumber);
  const bank = poChequeBankLabel(c, bankAccounts);
  if (bank && num !== '—') return `${bank} · ${num}`;
  if (bank) return bank;
  return num;
}

function poPaymentTypeLabel(c) {
  return String(c?.paymentType ?? '').trim().toLowerCase() === 'cash' ? 'Cash' : 'Cheque';
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

/**
 * Download a single-page A5 Purchase Order PDF in ORDER REQUEST letterhead format.
 * @param {object} po
 * @param {{
 *   shopName?: string,
 *   registrationNo?: string,
 *   addressLine1?: string,
 *   addressLine2?: string,
 *   email?: string,
 *   contactNumber?: string,
 *   dealerCode?: string,
 *   dealerTagline?: string,
 *   distributorName?: string,
 *   distributorLocation?: string,
 *   driverLicense?: string,
 *   bankAccounts?: object[],
 * }} [opts]
 */
export function downloadPurchaseOrderPdf(po, opts = {}) {
  const bankAccounts = Array.isArray(opts.bankAccounts) ? opts.bankAccounts : [];
  if (!po || typeof po !== 'object') return;

  const shopName = String(opts.shopName || '').trim() || 'CS Store';
  const registrationNo = String(opts.registrationNo || '').trim();
  const addressLine1 = String(opts.addressLine1 || '').trim();
  const addressLine2 = String(opts.addressLine2 || '').trim();
  const email = String(opts.email || '').trim();
  const contactNumber = String(opts.contactNumber || '').trim();
  const dealerCode = String(opts.dealerCode || '').trim();
  const dealerTagline =
    String(opts.dealerTagline || '').trim() ||
    'Authorized dealer for the products of Tokyo Cement Company Lanka PLC';

  const distributorName = String(opts.distributorName || po.distributorName || '').trim();
  const distributorLocation = String(
    opts.distributorLocation || po.distributionLocation || '',
  ).trim();
  const driverLicense = String(opts.driverLicense || po.driverLicense || '').trim();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;

  let y = 10;

  // ——— Header / letterhead ———
  doc.setFont('times', 'bold');
  doc.setFontSize(FONT.shop);
  doc.setTextColor(...BLACK);
  const shopLines = doc.splitTextToSize(shopName, contentWidth);
  doc.text(shopLines, MARGIN, y);
  y += shopLines.length * 5.6;

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

  y += 1;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(FONT.header);
  doc.setTextColor(...BLACK);
  const tagLines = doc.splitTextToSize(dealerTagline, contentWidth);
  doc.text(tagLines, MARGIN, y);
  y += tagLines.length * LINE;

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 5.5;

  // ——— Meta: Dealer Code / Order NO / Title / Date ———
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.body);
  doc.setTextColor(...BLACK);

  const orderNo = orderNumberDisplay(po.poNumber);
  const orderDate = formatDisplayDate(po.date);

  doc.text(`Dealer Code : ${display(dealerCode)}`, MARGIN, y);
  doc.text(`Order NO : ${orderNo}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.title);
  underlineText(doc, 'ORDER REQUEST', pageWidth / 2, y, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.body);
  doc.text(`DATE : ${orderDate}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 7;

  // ——— Recipient ———
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.body);
  doc.text('The Manager ,', MARGIN, y);
  y += LINE;
  doc.setFont('helvetica', 'bold');
  const nameLines = doc.splitTextToSize(display(distributorName).toUpperCase(), contentWidth);
  doc.text(nameLines, MARGIN, y);
  y += nameLines.length * LINE;
  doc.setFont('helvetica', 'normal');
  if (distributorLocation) {
    const locLines = doc.splitTextToSize(distributorLocation, contentWidth);
    doc.text(locLines, MARGIN, y);
    y += locLines.length * LINE;
  }
  y += 2.5;

  doc.text('Dear Sir,', MARGIN, y);
  y += 5;
  const intro =
    'Please be kindly enough to issue these products. Details of the Vehicle and products are given bellow. Thank You.';
  const introLines = doc.splitTextToSize(intro, contentWidth);
  doc.text(introLines, MARGIN, y);
  y += introLines.length * LINE + 4;

  // ——— Product Details ———
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.section);
  underlineText(doc, 'Product Details', MARGIN, y);
  y += 3.5;

  const lineTotal = po.lineTotal ?? po.totalAmount;
  autoTable(doc, {
    startY: y,
    head: [['Descriptions', 'Price', 'Quantity', 'Amount(Rs:)']],
    body: [
      [
        display(formatProductNameWithCode(po.product) || po.product),
        formatPrice(po.unitPrice),
        String(Number(po.quantity) || 0),
        formatAmount(lineTotal),
      ],
    ],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: FONT.table,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.35,
      cellPadding: 1.8,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.46, halign: 'left' },
      1: { cellWidth: contentWidth * 0.18, halign: 'right' },
      2: { cellWidth: contentWidth * 0.16, halign: 'center' },
      3: { cellWidth: contentWidth * 0.2, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = (doc.lastAutoTable?.finalY || y) + 5.5;

  // ——— Payment Details ———
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.section);
  underlineText(doc, 'PAYMENT DETAILS', MARGIN, y);
  y += 3.5;

  const cheques = Array.isArray(po.cheques) ? po.cheques : [];
  const paymentBody =
    cheques.length > 0
      ? cheques.map((c) => [
          poPaymentTypeLabel(c),
          poPaymentRefDisplay(c, bankAccounts),
          String(c?.paymentType ?? '').trim().toLowerCase() === 'cash'
            ? formatDisplayDate(po.date)
            : formatDisplayDate(c.chequeDate),
          c.amount != null && Number(c.amount) > 0
            ? formatAmount(c.amount)
            : formatAmount(lineTotal),
        ])
      : [['Cheque', '—', '—', formatAmount(lineTotal)]];

  autoTable(doc, {
    startY: y,
    head: [['Type/Mode', 'Bank / Cheque No', 'Date', 'Amount(Rs:)']],
    body: paymentBody,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: FONT.table,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.35,
      cellPadding: 1.8,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.22, halign: 'center' },
      1: { cellWidth: contentWidth * 0.3, halign: 'center' },
      2: { cellWidth: contentWidth * 0.22, halign: 'center' },
      3: { cellWidth: contentWidth * 0.26, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = (doc.lastAutoTable?.finalY || y) + 5.5;

  // ——— Vehicle Details ———
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.section);
  underlineText(doc, 'VEHICAL DETAILS', MARGIN, y);
  y += 3.5;

  const vehicleLines = [
    `Driver Name : ${display(po.driverName).toUpperCase()}`,
    `Driver License : ${display(driverLicense).toUpperCase()}`,
    `Lorry No : ${display(po.vehicleNumber).toUpperCase()}`,
  ];

  autoTable(doc, {
    startY: y,
    body: vehicleLines.map((line) => [line]),
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: FONT.table,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.35,
      cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.85 },
    },
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: contentWidth * 0.85,
  });
  y = (doc.lastAutoTable?.finalY || y) + 5.5;

  const notesText = doorStepNotesText(po);
  if (notesText) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.section);
    underlineText(doc, 'NOTES', MARGIN, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT.body);
    const noteLines = doc.splitTextToSize(notesText, contentWidth);
    doc.text(noteLines, MARGIN, y);
  }

  const safePo = String(po.poNumber || po.id || 'PO').replace(/[^\w.-]+/g, '_');
  doc.save(`${safePo}.pdf`);
}
