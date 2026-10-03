import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MARGIN = 14;

const PDF_HEAD = [
  ['Date', 'Customer', 'Invoice', 'Discount type', 'Value (LKR)', 'Total discount (LKR)', 'Reason'],
];

const EXCEL_HEAD = [
  'Date',
  'Customer',
  'Invoice',
  'Discount type',
  'Value (LKR)',
  'Total discount (LKR)',
  'Reason',
];

function display(v) {
  const s = String(v ?? '').trim();
  return s || '—';
}

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function fileSlug(options = {}) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const safeDate = generatedAt.toISOString().slice(0, 10);
  return { rangeSlug, safeDate };
}

function filterLine(options = {}) {
  const { dateFrom = '', dateTo = '', discountTypeLabel = '', customer = '' } = options;
  const parts = [];
  if (dateFrom && dateTo) parts.push(`Period: ${dateFrom} to ${dateTo}`);
  else if (dateFrom) parts.push(`From: ${dateFrom}`);
  else if (dateTo) parts.push(`To: ${dateTo}`);
  else parts.push('Period: all dates');
  parts.push(`Discount type: ${discountTypeLabel || 'All'}`);
  parts.push(`Customer: ${customer || 'All'}`);
  return parts.join(' · ');
}

function addPageFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4 landscape`, MARGIN, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }
}

function bodyRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => [
    display(r.date),
    display(r.customerName),
    display(r.invoiceNumber),
    display(r.discountMode),
    formatLkr(r.discountValue),
    formatLkr(r.discountAmount),
    display(r.reason),
  ]);
}

function excelBodyRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => [
    String(r.date ?? '').slice(0, 10),
    String(r.customerName ?? '').trim(),
    String(r.invoiceNumber ?? '').trim(),
    String(r.discountMode ?? '').trim(),
    Number(r.discountValue) || 0,
    Number(r.discountAmount) || 0,
    String(r.reason ?? '').trim(),
  ]);
}

function totalAmount(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (sum, r) => sum + (Number(r.discountAmount) || 0),
    0,
  );
}

/**
 * Download the filtered invoice discount promotions as a PDF.
 * @param {Array} rows
 * @param {{ dateFrom?: string, dateTo?: string, discountTypeLabel?: string, customer?: string, generatedAt?: Date }} [options]
 */
export function downloadInvoiceDiscountPdf(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const { generatedAt = new Date() } = options;
  const total = totalAmount(safeRows);
  const filters = filterLine(options);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Invoice Discount Promotions', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(filters, MARGIN, 27);
  doc.text(
    `${safeRows.length} discount${safeRows.length === 1 ? '' : 's'} · Total ${formatLkr(total)} LKR`,
    MARGIN,
    32,
  );
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    head: PDF_HEAD,
    body:
      safeRows.length > 0
        ? bodyRows(safeRows)
        : [['—', '—', '—', '—', '—', '—', '—']],
    foot: [
      [
        '',
        '',
        '',
        `Total (${safeRows.length})`,
        '',
        formatLkr(total),
        '',
      ],
    ],
    startY: 38,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc);
  const { rangeSlug, safeDate } = fileSlug({ ...options, generatedAt });
  doc.save(`invoice-discount-promotions-${rangeSlug}-${safeDate}.pdf`);
}

/**
 * Download the filtered invoice discount promotions as an Excel workbook.
 * @param {Array} rows
 * @param {{ dateFrom?: string, dateTo?: string, discountTypeLabel?: string, customer?: string, generatedAt?: Date }} [options]
 */
export function downloadInvoiceDiscountExcel(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const { generatedAt = new Date() } = options;
  const total = totalAmount(safeRows);

  const sheetData = [
    ['Invoice Discount Promotions'],
    [filterLine(options)],
    [`Generated: ${generatedAt.toISOString()}`],
    [],
    EXCEL_HEAD,
    ...excelBodyRows(safeRows),
    [],
    ['', '', '', `Total (${safeRows.length})`, '', total, ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 28 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 36 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoice discounts');

  const { rangeSlug, safeDate } = fileSlug({ ...options, generatedAt });
  XLSX.writeFile(workbook, `invoice-discount-promotions-${rangeSlug}-${safeDate}.xlsx`);
}
