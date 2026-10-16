import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MARGIN = 14;

const PDF_HEAD = [
  ['Date', 'Shop name', 'Item name', 'Number of items', 'Free bag amount', 'Per bag price'],
];
const EXCEL_HEAD = [
  'Date',
  'Shop name',
  'Item name',
  'Number of items',
  'Free bag amount',
  'Per bag price',
];

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatBags(n) {
  return (Number(n) || 0).toLocaleString();
}

function moneyCell(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '—';
  return `LKR ${formatLkr(n)}`;
}

function display(value) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function fileSlug(options = {}) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const safeDate = generatedAt.toISOString().slice(0, 10);
  return { rangeSlug, safeDate };
}

function filterLine(options = {}) {
  const { dateFrom = '', dateTo = '', shop = '', search = '' } = options;
  const parts = [];
  if (dateFrom && dateTo) parts.push(`Period: ${dateFrom} to ${dateTo}`);
  else if (dateFrom) parts.push(`From: ${dateFrom}`);
  else if (dateTo) parts.push(`To: ${dateTo}`);
  else parts.push('Period: all dates');
  parts.push(`Shop: ${String(shop ?? '').trim() || 'All shops'}`);
  const query = String(search ?? '').trim();
  if (query) parts.push(`Search: ${query}`);
  return parts.join(' · ');
}

function totalsOf(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.reduce(
    (acc, row) => ({
      bagCount: acc.bagCount + (Number(row.bagCount) || 0),
      freeBags: acc.freeBags + (Number(row.freeBags) || 0),
    }),
    { bagCount: 0, freeBags: 0 },
  );
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

/**
 * Download the filtered company unloading report as a PDF.
 * @param {Array} rows
 * @param {{ dateFrom?: string, dateTo?: string, shop?: string, search?: string, generatedAt?: Date }} [options]
 */
export function downloadCompanyUnloadReportPdf(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totals = totalsOf(safeRows);
  const { generatedAt = new Date() } = options;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Unloading report for Company', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  const filterLines = doc.splitTextToSize(filterLine(options), doc.internal.pageSize.getWidth() - MARGIN * 2);
  doc.text(filterLines, MARGIN, 27);
  const summaryY = 27 + filterLines.length * 4;
  doc.text(
    `${safeRows.length} line${safeRows.length === 1 ? '' : 's'} · ${formatBags(totals.bagCount)} items · ${formatBags(totals.freeBags)} free bags`,
    MARGIN,
    summaryY,
  );
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    head: PDF_HEAD,
    body:
      safeRows.length > 0
        ? safeRows.map((row) => [
            display(row.date),
            display(row.shop),
            display(row.itemName),
            formatBags(row.bagCount),
            formatBags(row.freeBags),
            moneyCell(row.perBagPrice),
          ])
        : [['—', '—', '—', '0', '0', '—']],
    foot:
      safeRows.length > 0
        ? [
            [
              `Total (${safeRows.length} line${safeRows.length === 1 ? '' : 's'})`,
              '',
              '',
              formatBags(totals.bagCount),
              formatBags(totals.freeBags),
              '',
            ],
          ]
        : undefined,
    startY: summaryY + 6,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc);
  const { rangeSlug, safeDate } = fileSlug({ ...options, generatedAt });
  doc.save(`company-unloading-report-${rangeSlug}-${safeDate}.pdf`);
}

/**
 * Download the filtered company unloading report as an Excel workbook.
 * @param {Array} rows
 * @param {{ dateFrom?: string, dateTo?: string, shop?: string, search?: string, generatedAt?: Date }} [options]
 */
export function downloadCompanyUnloadReportExcel(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totals = totalsOf(safeRows);
  const { generatedAt = new Date() } = options;
  const sheetData = [
    ['Unloading report for Company'],
    [filterLine(options)],
    [`Generated: ${generatedAt.toISOString()}`],
    [],
    EXCEL_HEAD,
    ...safeRows.map((row) => [
      String(row.date ?? '').slice(0, 10),
      String(row.shop ?? '').trim(),
      String(row.itemName ?? '').trim(),
      Number(row.bagCount) || 0,
      Number(row.freeBags) || 0,
      row.perBagPrice == null || row.perBagPrice === '' || !Number.isFinite(Number(row.perBagPrice))
        ? ''
        : Number(row.perBagPrice),
    ]),
    [],
    [`Total (${safeRows.length} line${safeRows.length === 1 ? '' : 's'})`, '', '', totals.bagCount, totals.freeBags, ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 14 },
    { wch: 32 },
    { wch: 42 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Company unloads');
  const { rangeSlug, safeDate } = fileSlug({ ...options, generatedAt });
  XLSX.writeFile(workbook, `company-unloading-report-${rangeSlug}-${safeDate}.xlsx`);
}
