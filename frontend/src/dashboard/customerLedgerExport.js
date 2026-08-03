import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MARGIN = 14;

const PDF_HEAD = [['Date', 'Type', 'Details', 'Debit (LKR)', 'Credit (LKR)', 'Balance (LKR)']];
const EXCEL_HEAD = ['Date', 'Type', 'Details', 'Debit (LKR)', 'Credit (LKR)', 'Balance (LKR)'];

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function safeFilePart(name) {
  return String(name || 'customer')
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'customer';
}

function dateCell(ymd) {
  const d = String(ymd ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '—';
}

function addPageFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4`, MARGIN, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }
}

function sumTotals(rows) {
  let debit = 0;
  let credit = 0;
  let count = 0;
  for (const r of rows) {
    if (r.kind === 'starting') continue;
    count += 1;
    debit += Number(r.debit) || 0;
    credit += Number(r.credit) || 0;
  }
  const closing = rows.length > 0 ? Number(rows[rows.length - 1].balance) || 0 : 0;
  return { debit, credit, closing, count };
}

function buildPdfBody(rows) {
  return rows.map((r) => [
    dateCell(r.date),
    r.type || '—',
    r.details || '—',
    r.debit != null && r.debit > 0 ? formatLkr(r.debit) : '—',
    r.credit != null && r.credit > 0 ? formatLkr(r.credit) : '—',
    formatLkr(r.balance),
  ]);
}

function buildExcelBody(rows) {
  return rows.map((r) => [
    /^\d{4}-\d{2}-\d{2}$/.test(dateCell(r.date)) ? dateCell(r.date) : '',
    r.type || '',
    r.details || '',
    r.debit != null && r.debit > 0 ? Number(r.debit) : '',
    r.credit != null && r.credit > 0 ? Number(r.credit) : '',
    Number(r.balance) || 0,
  ]);
}

/**
 * @param {object} customer
 * @param {Array} rows — ledger rows from buildCustomerLedgerRows
 * @param {{ dateFrom?: string, dateTo?: string, generatedAt?: Date }} options
 */
export function downloadCustomerLedgerPdf(customer, rows, options = {}) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const list = Array.isArray(rows) ? rows : [];
  const totals = sumTotals(list);
  const customerName = String(customer?.name ?? '').trim() || 'Customer';

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(`Ledger — ${customerName}`, MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  let metaY = 22;
  doc.text(`Generated: ${dateStr}`, MARGIN, metaY);
  metaY += 5;
  const range =
    dateFrom || dateTo
      ? `Period: ${dateFrom || '…'} to ${dateTo || '…'}`
      : 'Period: all dates';
  doc.text(range, MARGIN, metaY);
  metaY += 5;
  doc.text(
    'Debits increase amount owed; credits are payments. Balance is amount still owed (negative = overpaid).',
    MARGIN,
    metaY,
  );
  doc.setTextColor(0, 0, 0);

  const tableStartY = metaY + 8;
  const body = buildPdfBody(list);
  const foot = [
    [
      '',
      '',
      `Totals (${totals.count} entr${totals.count === 1 ? 'y' : 'ies'})`,
      formatLkr(totals.debit),
      formatLkr(totals.credit),
      formatLkr(totals.closing),
    ],
  ];

  autoTable(doc, {
    head: PDF_HEAD,
    body: body.length > 0 ? body : [['—', '—', '—', '—', '—', '0.00']],
    foot,
    startY: tableStartY,
    margin: { top: tableStartY, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', valign: 'middle' },
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
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc);

  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`ledger-${safeFilePart(customerName)}-${stamp}.pdf`);
}

export function downloadCustomerLedgerExcel(customer, rows, options = {}) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const list = Array.isArray(rows) ? rows : [];
  const totals = sumTotals(list);
  const customerName = String(customer?.name ?? '').trim() || 'Customer';

  const sheetData = [
    [`Ledger — ${customerName}`],
    [
      dateFrom || dateTo
        ? `Period: ${dateFrom || '…'} to ${dateTo || '…'}`
        : 'Period: all dates',
    ],
    [`Generated: ${generatedAt.toISOString()}`],
    [],
    EXCEL_HEAD,
    ...buildExcelBody(list),
    [],
    [
      '',
      '',
      `Totals (${totals.count})`,
      totals.debit,
      totals.credit,
      totals.closing,
    ],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 22 },
    { wch: 40 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ledger');

  const stamp = generatedAt.toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `ledger-${safeFilePart(customerName)}-${stamp}.xlsx`);
}

/** Download PDF and Excel for the current filtered ledger. */
export function downloadCustomerLedgerReport(customer, rows, options = {}) {
  downloadCustomerLedgerPdf(customer, rows, options);
  window.setTimeout(() => downloadCustomerLedgerExcel(customer, rows, options), 200);
}
