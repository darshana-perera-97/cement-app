import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MARGIN = 14;

const PDF_HEAD = [['Shop', 'Location', 'Contact', 'Due date', 'Outstanding (LKR)', 'Credit (LKR)']];
const EXCEL_HEAD = ['Shop', 'Location', 'Contact', 'Due date', 'Outstanding (LKR)', 'Credit (LKR)'];

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function normalizeRows(customers) {
  return [...(customers || [])]
    .map((c) => ({
      name: String(c.name ?? '').trim() || '—',
      location: String(c.location ?? '').trim(),
      contact: String(c.contactNumber ?? '').trim(),
      dueDate: String(c.dueDate ?? '').slice(0, 10) || '—',
      outstanding: Math.max(0, Number(c.remainingAmount) || 0),
      credit: Math.max(0, Number(c.overpaymentAmount) || 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function buildTableBody(rows) {
  return rows.map((r) => [
    r.name,
    r.location || '—',
    r.contact || '—',
    r.dueDate,
    formatLkr(r.outstanding),
    r.credit > 0 ? formatLkr(r.credit) : '—',
  ]);
}

function buildExcelRows(rows) {
  return rows.map((r) => [
    r.name,
    r.location,
    r.contact,
    r.dueDate === '—' ? '' : r.dueDate,
    r.outstanding,
    r.credit > 0 ? r.credit : '',
  ]);
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

function drawHeader(doc, pageW, options = {}) {
  const { asOfDate = '', generatedAt = new Date() } = options;
  const contentW = pageW - MARGIN * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Customer outstanding', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const meta = `As of: ${asOfDate || 'today'} · Generated: ${dateStr}`;
  const metaLines = doc.splitTextToSize(meta, contentW);
  doc.text(metaLines, MARGIN, 22);
  doc.text(
    'Current balance owed by each customer (past bill + credit sales − payments). Credit column shows overpayment balance.',
    MARGIN,
    22 + metaLines.length * 4 + 2,
  );
  doc.setTextColor(0, 0, 0);

  return 22 + metaLines.length * 4 + 10;
}

/**
 * @param {Array<{ name: string, location?: string, contactNumber?: string, dueDate?: string, remainingAmount?: number, overpaymentAmount?: number }>} customers
 */
export function downloadCustomerOutstandingPdf(customers, options = {}) {
  const { asOfDate = '', generatedAt = new Date() } = options;
  const rows = normalizeRows(customers);
  const body = buildTableBody(rows);
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const tableStartY = drawHeader(doc, pageW, { asOfDate, generatedAt });

  const foot = [
    [
      '',
      '',
      '',
      'Grand total',
      formatLkr(totalOutstanding),
      totalCredit > 0 ? formatLkr(totalCredit) : '—',
    ],
  ];

  autoTable(doc, {
    head: PDF_HEAD,
    body: body.length > 0 ? body : [['—', '—', '—', '—', '0.00', '—']],
    foot,
    startY: tableStartY,
    margin: { top: tableStartY, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
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
      0: { cellWidth: 36 },
      1: { cellWidth: 28 },
      2: { cellWidth: 28 },
      3: { cellWidth: 22 },
      4: { halign: 'right', cellWidth: 28 },
      5: { halign: 'right', cellWidth: 24 },
    },
    tableWidth: pageW - MARGIN * 2,
    showHead: 'everyPage',
  });

  addPageFooters(doc);

  const safeDate = asOfDate || generatedAt.toISOString().slice(0, 10);
  doc.save(`customer-outstanding-${safeDate}.pdf`);
}

/**
 * @param {Array<{ name: string, location?: string, contactNumber?: string, dueDate?: string, remainingAmount?: number, overpaymentAmount?: number }>} customers
 */
export function downloadCustomerOutstandingExcel(customers, options = {}) {
  const { asOfDate = '', generatedAt = new Date() } = options;
  const rows = normalizeRows(customers);
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  const sheetData = [
    EXCEL_HEAD,
    ...buildExcelRows(rows),
    ['', '', '', 'Grand total', totalOutstanding, totalCredit > 0 ? totalCredit : ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 28 },
    { wch: 22 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Outstanding');

  const safeDate = asOfDate || generatedAt.toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `customer-outstanding-${safeDate}.xlsx`);
}

/** Download PDF and Excel in one click. */
export function downloadCustomerOutstandingReport(customers, options = {}) {
  downloadCustomerOutstandingPdf(customers, options);
  window.setTimeout(() => downloadCustomerOutstandingExcel(customers, options), 200);
}
