import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MARGIN = 14;

const PDF_HEAD = [
  [
    'Bill date',
    'Details',
    'Settled date',
    'Days to settle',
    'Total (LKR)',
    'Paid (LKR)',
    'Balance (LKR)',
    'Status',
  ],
];
const EXCEL_HEAD = [
  'Bill date',
  'Details',
  'Settled date',
  'Days to settle',
  'Total (LKR)',
  'Paid (LKR)',
  'Balance (LKR)',
  'Status',
];

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function statusLabel(row) {
  if (row.status === 'settled') return 'Settled';
  if (row.status === 'partial') return 'Partial';
  if (row.isOverdue) return 'Overdue';
  return 'Open';
}

function settledDateCell(row) {
  const d = String(row.settledDate ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '—';
}

function daysToSettleCell(row) {
  if (row.daysToSettle == null) return '—';
  return String(row.daysToSettle);
}

function safeFilePart(name) {
  return String(name || 'customer')
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'customer';
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

function buildPdfBody(rows) {
  return rows.map((r) => [
    r.billDate || '—',
    r.details || '—',
    settledDateCell(r),
    daysToSettleCell(r),
    formatLkr(r.billTotal),
    r.paidAmount > 0 ? formatLkr(r.paidAmount) : '—',
    r.outstandingAmount > 0 ? formatLkr(r.outstandingAmount) : '—',
    statusLabel(r),
  ]);
}

function buildExcelBody(rows) {
  return rows.map((r) => [
    r.billDate || '',
    r.details || '',
    /^\d{4}-\d{2}-\d{2}$/.test(String(r.settledDate ?? '').slice(0, 10))
      ? String(r.settledDate).slice(0, 10)
      : '',
    r.daysToSettle != null ? r.daysToSettle : '',
    Number(r.billTotal) || 0,
    r.paidAmount > 0 ? Number(r.paidAmount) : '',
    r.outstandingAmount > 0 ? Number(r.outstandingAmount) : '',
    statusLabel(r),
  ]);
}

function sumTotals(rows) {
  let billed = 0;
  let paid = 0;
  let due = 0;
  for (const r of rows) {
    billed += Number(r.billTotal) || 0;
    paid += Number(r.paidAmount) || 0;
    due += Number(r.outstandingAmount) || 0;
  }
  return { billed, paid, due, count: rows.length };
}

/**
 * @param {object} customer
 * @param {Array} rows — filtered invoice rows from buildCustomerInvoiceRows
 * @param {{ dateFrom?: string, dateTo?: string, generatedAt?: Date }} options
 */
export function downloadCustomerInvoicesPdf(customer, rows, options = {}) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const list = Array.isArray(rows) ? rows : [];
  const totals = sumTotals(list);
  const customerName = String(customer?.name ?? '').trim() || 'Customer';
  const settlementDays = customer?.overdueDays ?? 14;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(`Invoices — ${customerName}`, MARGIN, 16);

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
      ? `Bill date filter: ${dateFrom || '…'} to ${dateTo || '…'}`
      : 'Bill date filter: all dates';
  doc.text(range, MARGIN, metaY);
  metaY += 5;
  doc.text(
    `Credit bills · settle within ${settlementDays} day${settlementDays === 1 ? '' : 's'} of bill date. Payments apply to opening balance first, then oldest bills.`,
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
      '',
      `Totals (${totals.count} invoice${totals.count === 1 ? '' : 's'})`,
      formatLkr(totals.billed),
      formatLkr(totals.paid),
      formatLkr(totals.due),
      '',
    ],
  ];

  autoTable(doc, {
    head: PDF_HEAD,
    body: body.length > 0 ? body : [['—', '—', '—', '—', '0.00', '—', '—', '—']],
    foot,
    startY: tableStartY,
    margin: { top: tableStartY, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak', valign: 'middle' },
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
      6: { halign: 'right' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc);

  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`invoices-${safeFilePart(customerName)}-${stamp}.pdf`);
}

export function downloadCustomerInvoicesExcel(customer, rows, options = {}) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const list = Array.isArray(rows) ? rows : [];
  const totals = sumTotals(list);
  const customerName = String(customer?.name ?? '').trim() || 'Customer';

  const sheetData = [
    [`Invoices — ${customerName}`],
    [
      dateFrom || dateTo
        ? `Bill date: ${dateFrom || '…'} to ${dateTo || '…'}`
        : 'Bill date: all dates',
    ],
    [`Generated: ${generatedAt.toISOString()}`],
    [],
    EXCEL_HEAD,
    ...buildExcelBody(list),
    [],
    [
      '',
      '',
      '',
      `Totals (${totals.count})`,
      totals.billed,
      totals.paid,
      totals.due,
      '',
    ],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 36 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoices');

  const stamp = generatedAt.toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `invoices-${safeFilePart(customerName)}-${stamp}.xlsx`);
}

/** Download PDF and Excel for the current filtered invoice list. */
export function downloadCustomerInvoicesReport(customer, rows, options = {}) {
  downloadCustomerInvoicesPdf(customer, rows, options);
  window.setTimeout(() => downloadCustomerInvoicesExcel(customer, rows, options), 200);
}
