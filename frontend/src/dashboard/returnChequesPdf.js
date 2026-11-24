import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getApiBase } from '../apiBase';
import { DEFAULT_SHOP_NAME } from '../shopConfig';

const MARGIN = 14;

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function moneyCell(n) {
  return `LKR ${formatLkr(n)}`;
}

function displayFilter(value, fallback = 'All') {
  const s = String(value ?? '').trim();
  return s || fallback;
}

function settlementFilterLabel(value) {
  if (value === 'settled') return 'Settled only';
  if (value === 'unsettled') return 'Not settled only';
  return 'All (settled & not settled)';
}

function dateSortLabel(value) {
  return value === 'desc' ? 'Newest first' : 'Oldest first';
}

function display(value) {
  const s = String(value ?? '').trim();
  return s || '—';
}

function formatDisplayDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '—';
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

function documentRef(row) {
  const raw = String(row?.id ?? row?.rowKey ?? '').replace(/[^a-zA-Z0-9]/g, '');
  const tail = raw.slice(-8).toUpperCase();
  return tail ? `RC-${tail}` : 'RC-00000000';
}

export function returnChequeDocumentFilename(row) {
  const num = String(row?.chequeNumber || 'cheque').replace(/[^\w.-]+/g, '_');
  const date = String(row?.returnDate || '').slice(0, 10) || 'undated';
  return `cheque-return-notice-${num}-${date}.pdf`;
}

async function loadShopForDocument() {
  try {
    const res = await fetch(`${getApiBase()}/api/shop`);
    if (!res.ok) return { shopName: DEFAULT_SHOP_NAME };
    const data = await res.json();
    return {
      shopName: String(data?.shopName ?? '').trim() || DEFAULT_SHOP_NAME,
      registrationNo: String(data?.registrationNo ?? '').trim(),
      addressLine1: String(data?.addressLine1 ?? '').trim(),
      addressLine2: String(data?.addressLine2 ?? '').trim(),
      email: String(data?.email ?? '').trim(),
      contactNumber: String(data?.contactNumber ?? '').trim(),
      dealerCode: String(data?.dealerCode ?? '').trim(),
      dealerTagline:
        String(data?.dealerTagline ?? '').trim() ||
        'Authorized dealer for the products of Tokyo Cement Company Lanka PLC',
    };
  } catch {
    return { shopName: DEFAULT_SHOP_NAME };
  }
}

const BLACK = [0, 0, 0];
const DOC_LINE = 4.2;

function underlineCentered(doc, text, x, y) {
  doc.text(text, x, y, { align: 'center' });
  const w = doc.getTextWidth(text);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(x - w / 2, y + 0.8, x + w / 2, y + 0.8);
}

function drawDoubleRule(doc, y, pageWidth) {
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.55);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  doc.setLineWidth(0.22);
  doc.line(MARGIN, y + 1.2, pageWidth - MARGIN, y + 1.2);
}

function formalGridOptions() {
  return {
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.28,
      cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left',
    },
    margin: { left: MARGIN, right: MARGIN },
  };
}

function addPageFooters(doc, generatedAt) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const stamp = formatPrintTimestamp(generatedAt);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.22);
    doc.line(MARGIN, pageHeight - 12, pageWidth - MARGIN, pageHeight - 12);
    doc.setTextColor(...BLACK);
    if (stamp) {
      doc.text(`Printed : ${stamp}`, MARGIN, pageHeight - 7);
    }
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 7, { align: 'right' });
  }
}

/**
 * Download the filtered return-cheques table as an A4 landscape PDF.
 */
export function downloadReturnChequesPdf(data = {}) {
  const {
    rows = [],
    filters = {},
    generatedAt = new Date(),
  } = data;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Return cheques', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.setTextColor(0, 0, 0);

  const filterBody = [
    ['Shop', displayFilter(filters.shop)],
    ['Settlement', settlementFilterLabel(filters.settlement)],
    ['From date', displayFilter(filters.dateFrom)],
    ['To date', displayFilter(filters.dateTo)],
    ['Date order', dateSortLabel(filters.dateSort)],
    ['Search', displayFilter(filters.search, 'None')],
  ];

  autoTable(doc, {
    startY: 26,
    head: [['Filter', 'Value']],
    body: filterBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, valign: 'middle' },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold', textColor: [71, 85, 105] },
      1: { cellWidth: 80 },
    },
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: 112,
  });

  const tableStartY = (doc.lastAutoTable?.finalY || 46) + 6;
  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalOutstanding = rows.reduce((s, r) => s + (Number(r.outstandingAmount) || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + (Number(r.paidAmount) || 0), 0);

  const body =
    rows.length === 0
      ? [['—', 'No return cheques match the current filters', '—', '—', '—', '—', '—', '—', '—']]
      : rows.map((r) => [
          String(r.returnDate || '—'),
          String(r.customerName || '—'),
          r.chequeNumber ? `#${r.chequeNumber}` : '—',
          String(r.chequeBank || '—'),
          String(r.chequeDate || '—'),
          String(r.receiptNumber || '—'),
          moneyCell(r.amount),
          moneyCell(r.outstandingAmount),
          r.settled ? (r.settledDate ? `Settled ${r.settledDate}` : 'Settled') : 'Not settled',
        ]);

  autoTable(doc, {
    startY: tableStartY,
    head: [
      [
        'Return date',
        'Shop',
        'Cheque #',
        'Bank',
        'Cheque date',
        'Receipt',
        'Amount',
        'Outstanding',
        'Status',
      ],
    ],
    body,
    foot:
      rows.length === 0
        ? undefined
        : [
            [
              'Total',
              `${rows.length} cheque${rows.length === 1 ? '' : 's'}`,
              '',
              '',
              '',
              '',
              moneyCell(totalAmount),
              moneyCell(totalOutstanding),
              `Paid ${moneyCell(totalPaid)}`,
            ],
          ],
    styles: { fontSize: 7.5, cellPadding: 1.5, overflow: 'linebreak', valign: 'middle' },
    headStyles: {
      fillColor: [71, 85, 105],
      textColor: 255,
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    showHead: 'everyPage',
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 42 },
      2: { cellWidth: 24, font: 'courier', fontSize: 7 },
      3: { cellWidth: 28 },
      4: { cellWidth: 24 },
      5: { cellWidth: 22 },
      6: { cellWidth: 30, halign: 'right' },
      7: { cellWidth: 30, halign: 'right' },
      8: { cellWidth: 32 },
    },
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
  });

  addPageFooters(doc);
  const stamp = generatedAt.toISOString().slice(0, 10);
  const scope =
    filters.settlement === 'settled'
      ? 'settled'
      : filters.settlement === 'unsettled'
        ? 'not-settled'
        : 'all';
  doc.save(`return-cheques-${scope}-${stamp}.pdf`);
}

/**
 * Build one formal A4 cheque-return notice for a single returned cheque.
 * @returns {Promise<{ doc: import('jspdf').jsPDF, filename: string }>}
 */
export async function buildReturnChequeDocument(row, generatedAt = new Date()) {
  if (!row || typeof row !== 'object') {
    throw new Error('Missing cheque return');
  }

  const shop = await loadShopForDocument();
  const shopName = String(shop.shopName || '').trim() || DEFAULT_SHOP_NAME;
  const registrationNo = String(shop.registrationNo || '').trim();
  const addressLine1 = String(shop.addressLine1 || '').trim();
  const addressLine2 = String(shop.addressLine2 || '').trim();
  const email = String(shop.email || '').trim();
  const contactNumber = String(shop.contactNumber || '').trim();
  const dealerCode = String(shop.dealerCode || '').trim();
  const dealerTagline =
    String(shop.dealerTagline || '').trim() ||
    'Authorized dealer for the products of Tokyo Cement Company Lanka PLC';

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const ref = documentRef(row);
  const filename = returnChequeDocumentFilename(row);
  const printAt = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  const noticeDate = formatDisplayDate(printAt.toISOString().slice(0, 10));
  const returnDate = formatDisplayDate(row.returnDate);
  const customerName = display(row.customerName).toUpperCase();
  const faceAmount = Number(row.amount) || 0;
  const paidAmount = Number(row.paidAmount) || 0;
  const outstandingAmount = Number(row.outstandingAmount) || 0;
  const status = row.settled
    ? row.settledDate
      ? `Settled on ${formatDisplayDate(row.settledDate)}`
      : 'Settled in full'
    : 'Outstanding — not settled';

  doc.setProperties({
    title: `Cheque Return Notice ${ref}`,
    subject: 'Cheque return notice',
    author: shopName,
  });

  let y = 14;

  doc.setFont('times', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BLACK);
  const shopLines = doc.splitTextToSize(shopName, contentWidth);
  doc.text(shopLines, MARGIN, y);
  y += shopLines.length * 5.6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  if (registrationNo) {
    doc.text(`( Reg. No: ${registrationNo} )`, MARGIN, y);
    y += DOC_LINE;
  }
  const addressParts = [addressLine1, addressLine2].filter(Boolean);
  if (addressParts.length > 0) {
    const addrLines = doc.splitTextToSize(addressParts.join(', '), contentWidth);
    doc.text(addrLines, MARGIN, y);
    y += addrLines.length * DOC_LINE;
  }
  if (email) {
    doc.text(`E-Mail : ${email}`, MARGIN, y);
    y += DOC_LINE;
  }
  if (contactNumber) {
    doc.text(`Tele : ${contactNumber}`, MARGIN, y);
    y += DOC_LINE;
  }

  y += 0.8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  const tagLines = doc.splitTextToSize(dealerTagline, contentWidth);
  doc.text(tagLines, MARGIN, y);
  y += tagLines.length * DOC_LINE + 1.5;

  drawDoubleRule(doc, y, pageWidth);
  y += 7;

  if (dealerCode) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Dealer Code : ${dealerCode}`, MARGIN, y);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Document No : ${ref}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 5.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  underlineCentered(doc, 'CHEQUE RETURN NOTICE', pageWidth / 2, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`DATE : ${noticeDate}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const toLines = doc.splitTextToSize(`To : ${customerName}`, contentWidth);
  doc.text(toLines, MARGIN, y);
  y += toLines.length * DOC_LINE + 1.5;

  const intro = doc.splitTextToSize(
    'This is to formally notify that the cheque detailed below, received towards settlement of your account, has been returned unpaid by the bank. The face value of the returned cheque remains payable and continues as an outstanding balance on your account until settled in full.',
    contentWidth,
  );
  doc.text(intro, MARGIN, y);
  y += intro.length * DOC_LINE + 3;

  autoTable(doc, {
    startY: y,
    head: [[{ content: 'CUSTOMER PARTICULARS', colSpan: 2, styles: { halign: 'center' } }]],
    body: [
      ['Customer / Shop', display(row.customerName)],
      ['Contact number', display(row.customerContact)],
      ['Location / Address', display(row.customerLocation)],
      ['Collection receipt No.', display(row.receiptNumber)],
      ['Original payment date', formatDisplayDate(row.paymentDate)],
    ],
    ...formalGridOptions(),
    columnStyles: {
      0: { cellWidth: contentWidth * 0.34, fontStyle: 'bold' },
      1: { cellWidth: contentWidth * 0.66 },
    },
  });
  y = (doc.lastAutoTable?.finalY || y) + 4;

  autoTable(doc, {
    startY: y,
    head: [[{ content: 'RETURNED CHEQUE PARTICULARS', colSpan: 4, styles: { halign: 'center' } }]],
    body: [
      [
        { content: 'Cheque No.', styles: { fontStyle: 'bold' } },
        row.chequeNumber ? String(row.chequeNumber) : '—',
        { content: 'Bank', styles: { fontStyle: 'bold' } },
        display(row.chequeBank),
      ],
      [
        { content: 'Cheque date', styles: { fontStyle: 'bold' } },
        formatDisplayDate(row.chequeDate),
        { content: 'Return date', styles: { fontStyle: 'bold' } },
        returnDate,
      ],
      [
        { content: 'Returned by', styles: { fontStyle: 'bold' } },
        display(row.returnedBy),
        { content: 'Days since return', styles: { fontStyle: 'bold' } },
        row.daysFromReturn != null ? String(row.daysFromReturn) : '—',
      ],
      [
        { content: 'Settlement status', styles: { fontStyle: 'bold' } },
        { content: status, colSpan: 3 },
      ],
    ],
    ...formalGridOptions(),
    columnStyles: {
      0: { cellWidth: contentWidth * 0.22 },
      1: { cellWidth: contentWidth * 0.28 },
      2: { cellWidth: contentWidth * 0.22 },
      3: { cellWidth: contentWidth * 0.28 },
    },
  });
  y = (doc.lastAutoTable?.finalY || y) + 4;

  autoTable(doc, {
    startY: y,
    head: [
      [
        { content: 'AMOUNT SUMMARY', colSpan: 2, styles: { halign: 'center' } },
      ],
    ],
    body: [
      ['Face value of returned cheque (Rs.)', formatLkr(faceAmount)],
      ['Amount settled against return (Rs.)', formatLkr(paidAmount)],
      [
        { content: 'Outstanding balance (Rs.)', styles: { fontStyle: 'bold' } },
        { content: formatLkr(outstandingAmount), styles: { fontStyle: 'bold', halign: 'right' } },
      ],
    ],
    ...formalGridOptions(),
    columnStyles: {
      0: { cellWidth: contentWidth * 0.68 },
      1: { cellWidth: contentWidth * 0.32, halign: 'right' },
    },
  });
  y = (doc.lastAutoTable?.finalY || y) + 3.5;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  const words = `Amount in words (face value) : ${amountInWords(faceAmount)}`;
  const wordLines = doc.splitTextToSize(words, contentWidth);
  doc.text(wordLines, MARGIN, y);
  y += wordLines.length * DOC_LINE + 2;

  const note = String(row.returnNote ?? '').trim();
  if (note) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Return remarks', MARGIN, y);
    y += 4;
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.28);
    const noteLines = doc.splitTextToSize(note, contentWidth - 4);
    const boxH = Math.max(12, 4 + noteLines.length * 4.2);
    doc.rect(MARGIN, y - 1, contentWidth, boxH);
    doc.setFont('helvetica', 'normal');
    doc.text(noteLines, MARGIN + 2, y + 3.5);
    y += boxH + 4;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const notice = doc.splitTextToSize(
    'You are kindly requested to settle the outstanding amount without delay by cash, bank transfer, or a fresh cheque. This notice is issued for your records and does not waive any rights available to the business under applicable law.',
    contentWidth,
  );
  doc.text(notice, MARGIN, y);
  y += noticeLinesSafeHeight(notice) + 10;

  if (y > pageHeight - 55) {
    doc.addPage();
    y = 18;
  }

  const colW = contentWidth / 3;
  const lineW = Math.min(48, colW - 6);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, y, MARGIN + lineW, y);
  doc.line(MARGIN + colW, y, MARGIN + colW + lineW, y);
  doc.line(MARGIN + colW * 2, y, MARGIN + colW * 2 + lineW, y);
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Prepared by', MARGIN, y);
  doc.text('Authorized by', MARGIN + colW, y);
  doc.text('Customer acknowledgement', MARGIN + colW * 2, y);
  y += 4;
  doc.setFontSize(7.5);
  doc.text('(Name / Signature)', MARGIN, y);
  doc.text('(Name / Signature / Stamp)', MARGIN + colW, y);
  doc.text('(Signature / Rubber stamp)', MARGIN + colW * 2, y);
  y += 6;

  const returnedBy = String(row.returnedBy ?? '').trim();
  if (returnedBy) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Recorded as returned by : ${returnedBy}`, MARGIN, y);
  }

  addPageFooters(doc, printAt);
  return { doc, filename };
}

function noticeLinesSafeHeight(lines) {
  return (Array.isArray(lines) ? lines.length : 1) * DOC_LINE;
}

/** Open a blob URL preview for one cheque-return notice. */
export async function returnChequeDocumentBlobUrl(row, generatedAt = new Date()) {
  const built = await buildReturnChequeDocument(row, generatedAt);
  const blob = built.doc.output('blob');
  return { url: URL.createObjectURL(blob), filename: built.filename };
}

/** Download one A4 cheque-return notice for a single returned cheque. */
export async function downloadReturnChequeDocument(row, generatedAt = new Date()) {
  const built = await buildReturnChequeDocument(row, generatedAt);
  built.doc.save(built.filename);
}
