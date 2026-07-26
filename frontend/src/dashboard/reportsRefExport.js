import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MARGIN = 14;

const TABLE_HEAD = [['Shop + location', 'Bill date', 'Bag type', 'Amount', 'Total bags']];

function formatBags(n) {
  return String(Number(n) || 0);
}

function fileSlug(options = {}) {
  const { dateFrom = '', dateTo = '', brandLabel = 'all-brands', generatedAt = new Date() } = options;
  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const brandSlug = String(brandLabel).toLowerCase().replace(/\s+/g, '-');
  const safeDate = generatedAt.toISOString().slice(0, 10);
  return { rangeSlug, brandSlug, safeDate };
}

function shopLocationLabel(shop, location) {
  const name = String(shop ?? '').trim() || '—';
  const loc = String(location ?? '').trim();
  return loc ? `${name} — ${loc}` : name;
}

function groupRowsByShop(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.shop)) map.set(row.shop, []);
    map.get(row.shop).push(row);
  }
  return [...map.entries()]
    .map(([shop, bills]) => ({
      shop,
      location: bills[0]?.location || '',
      bills: [...bills].sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date);
        if (dateCmp !== 0) return dateCmp;
        return String(a.bagType ?? '').localeCompare(String(b.bagType ?? ''));
      }),
    }))
    .sort((a, b) => a.shop.localeCompare(b.shop));
}

/** Build one combined table body with a shop-total row after each shop (A–Z). */
function buildSingleTableBody(rows) {
  const groups = groupRowsByShop(rows);
  const body = [];
  const subtotalRowIndices = new Set();
  let grandTotal = 0;

  for (const { shop, location, bills } of groups) {
    const shopLabel = shopLocationLabel(shop, location);
    for (const bill of bills) {
      body.push([shopLabel, bill.date, bill.bagType || '—', formatBags(bill.bagCount), '']);
    }
    const shopTotal = bills.reduce((s, r) => s + (Number(r.bagCount) || 0), 0);
    grandTotal += shopTotal;
    subtotalRowIndices.add(body.length);
    body.push([shopLabel, '', 'Shop total', '', formatBags(shopTotal)]);
  }

  return { body, subtotalRowIndices, grandTotal, shopCount: groups.length };
}

const EXCEL_HEAD = ['Shop', 'Location', 'Bill date', 'Bag type', 'Amount'];

/** Plain bill lines for Excel — no shop totals, separate shop and location columns. */
function buildExcelRows(rows) {
  return [...(rows || [])]
    .sort((a, b) => {
      const shopCmp = a.shop.localeCompare(b.shop);
      if (shopCmp !== 0) return shopCmp;
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return String(a.bagType ?? '').localeCompare(String(b.bagType ?? ''));
    })
    .map((r) => [
      r.shop,
      r.location || '',
      r.date,
      r.bagType || '',
      Number(r.bagCount) || 0,
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

function drawReportHeader(doc, pageW, data, shopCount, recordCount) {
  const {
    periodLabel = 'All dates',
    brandLabel = 'All brands',
    generatedAt = new Date(),
  } = data;
  const contentW = pageW - MARGIN * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('Ref report — bags per shop', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const meta = `Generated: ${dateStr} · Period: ${periodLabel} · Bag type filter: ${brandLabel} · ${shopCount} shop${shopCount === 1 ? '' : 's'} · ${recordCount} line${recordCount === 1 ? '' : 's'}`;
  const metaLines = doc.splitTextToSize(meta, contentW);
  doc.text(metaLines, MARGIN, 22);
  doc.setTextColor(0, 0, 0);

  return 22 + metaLines.length * 4 + 4;
}

/**
 * @param {Array<{ date: string, shop: string, location: string, bagType: string, bagCount: number }>} rows
 */
export function downloadRefPdf(rows, data = {}, options = {}) {
  const {
    periodLabel = 'All dates',
    brandLabel = 'All brands',
    generatedAt = new Date(),
  } = data;
  const safeRows = rows || [];
  const { body, subtotalRowIndices, grandTotal, shopCount } = buildSingleTableBody(safeRows);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const tableStartY = drawReportHeader(
    doc,
    pageW,
    { periodLabel, brandLabel, generatedAt },
    shopCount,
    safeRows.length,
  );

  const foot =
    body.length > 0
      ? [['', '', 'Grand total', '', formatBags(grandTotal)]]
      : null;

  autoTable(doc, {
    head: TABLE_HEAD,
    body: body.length > 0 ? body : [['—', '—', '—', '0', '0']],
    foot,
    startY: tableStartY,
    margin: { top: tableStartY, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 8.5, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
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
      0: { cellWidth: 52 },
      1: { cellWidth: 24 },
      2: { cellWidth: 24 },
      3: { halign: 'right', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 24 },
    },
    tableWidth: pageW - MARGIN * 2,
    showHead: 'everyPage',
    didParseCell(cellData) {
      if (cellData.section !== 'body' || !subtotalRowIndices.has(cellData.row.index)) return;
      cellData.cell.styles.fontStyle = 'bold';
      cellData.cell.styles.fillColor = [241, 245, 249];
      cellData.cell.styles.textColor = [15, 23, 42];
      if (cellData.column.index === 4) {
        cellData.cell.styles.textColor = [15, 23, 42];
      }
    },
  });

  addPageFooters(doc);

  const { rangeSlug, brandSlug, safeDate } = fileSlug({ ...options, brandLabel, generatedAt });
  doc.save(`ref-report-${rangeSlug}-${brandSlug}-${safeDate}.pdf`);
}

/**
 * @param {Array<{ date: string, shop: string, location: string, bagType: string, bagCount: number }>} rows
 */
export function downloadRefExcel(rows, options = {}) {
  const { brandLabel = 'all-brands', generatedAt = new Date() } = options;
  const sheetData = [EXCEL_HEAD, ...buildExcelRows(rows)];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 28 },
    { wch: 22 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ref report');
  const { rangeSlug, brandSlug, safeDate } = fileSlug({ ...options, brandLabel, generatedAt });
  XLSX.writeFile(workbook, `ref-report-${rangeSlug}-${brandSlug}-${safeDate}.xlsx`);
}

/** Download Ref PDF and Excel in one click. */
export function downloadRefReport(rows, data = {}, options = {}) {
  downloadRefPdf(rows, data, options);
  window.setTimeout(() => downloadRefExcel(rows, options), 200);
}
