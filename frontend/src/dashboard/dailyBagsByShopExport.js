import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { BRANDS } from './brandTheme';
import { inDateRange } from './tableToolbar';

const MARGIN = 10;

function formatBags(n) {
  return (Number(n) || 0).toLocaleString();
}

function monthParts(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      monthIndex: now.getMonth(),
      monthSlug: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    };
  }
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    monthSlug: `${match[1]}-${match[2]}`,
  };
}

/**
 * One row per shop × brand: bags sold on each day of the selected month.
 * Columns conceptually: shop name | brand | 1 | 2 | … | daysInMonth | total
 */
export function buildDailyBagsByShopBrandRows(bills, monthValue, brandKey = '') {
  const { year, monthIndex, monthSlug } = monthParts(monthValue);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const mm = String(monthIndex + 1).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

  const brands = brandKey ? BRANDS.filter((b) => b.key === brandKey) : BRANDS;
  const map = new Map();

  for (const bill of Array.isArray(bills) ? bills : []) {
    if (!inDateRange(bill.date, from, to)) continue;
    const date = String(bill.date ?? '').slice(0, 10);
    const day = Number(date.slice(8, 10));
    if (!Number.isFinite(day) || day < 1 || day > daysInMonth) continue;

    const shop = String(bill.customerName ?? '').trim() || '—';
    for (const brand of brands) {
      const bags = Number(bill[brand.bagsField]) || 0;
      if (bags <= 0) continue;
      const key = `${shop.toLowerCase()}||${brand.key}`;
      if (!map.has(key)) {
        map.set(key, {
          rowKey: key,
          shop,
          brand: brand.label,
          brandKey: brand.key,
          dayBags: Array.from({ length: daysInMonth }, () => 0),
          total: 0,
        });
      }
      const row = map.get(key);
      row.dayBags[day - 1] += bags;
      row.total += bags;
    }
  }

  const sorted = [...map.values()].sort((a, b) => {
    const byShop = a.shop.localeCompare(b.shop, undefined, { sensitivity: 'base' });
    if (byShop !== 0) return byShop;
    return a.brand.localeCompare(b.brand);
  });

  // Merge shop name across consecutive brand rows for the same shop.
  const rows = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (
      j < sorted.length &&
      sorted[j].shop.localeCompare(sorted[i].shop, undefined, { sensitivity: 'base' }) === 0
    ) {
      j += 1;
    }
    const shopRowSpan = j - i;
    for (let k = i; k < j; k++) {
      rows.push({
        ...sorted[k],
        shopRowSpan: k === i ? shopRowSpan : 0,
      });
    }
    i = j;
  }

  const dayTotals = Array.from({ length: daysInMonth }, (_, i) =>
    rows.reduce((s, r) => s + (Number(r.dayBags[i]) || 0), 0),
  );
  const grandTotal = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const shopCount = rows.filter((r) => r.shopRowSpan > 0).length;

  return { daysInMonth, rows, dayTotals, grandTotal, shopCount, from, to, monthSlug };
}

function dayHeaders(daysInMonth) {
  return Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
}

function buildHead(daysInMonth) {
  return [['Shop name', 'Brand', ...dayHeaders(daysInMonth), 'Total']];
}

function buildBody(rows, daysInMonth) {
  return rows.map((r) => {
    const dayCells = Array.from({ length: daysInMonth }, (_, i) => formatBags(r.dayBags[i]));
    const totalCell = formatBags(r.total);
    if (r.shopRowSpan > 0) {
      return [
        { content: r.shop || '—', rowSpan: r.shopRowSpan, styles: { valign: 'middle', halign: 'left' } },
        r.brand || '—',
        ...dayCells,
        totalCell,
      ];
    }
    return [r.brand || '—', ...dayCells, totalCell];
  });
}

function buildFoot(dayTotals, grandTotal) {
  return [['Total', '', ...dayTotals.map(formatBags), formatBags(grandTotal)]];
}

/** Excel rows + vertical merges for repeated shop names. */
function buildExcelSheet(rows, daysInMonth, dayTotals, grandTotal) {
  const head = ['Shop name', 'Brand', ...dayHeaders(daysInMonth), 'Total'];
  const body = rows.map((r) => [
    r.shopRowSpan > 0 ? r.shop : '',
    r.brand,
    ...Array.from({ length: daysInMonth }, (_, i) => Number(r.dayBags[i]) || 0),
    Number(r.total) || 0,
  ]);
  const foot = ['Total', '', ...dayTotals.map((n) => Number(n) || 0), Number(grandTotal) || 0];

  const merges = [];
  let excelRow = 1; // header is row 0
  for (const r of rows) {
    if (r.shopRowSpan > 1) {
      merges.push({
        s: { r: excelRow, c: 0 },
        e: { r: excelRow + r.shopRowSpan - 1, c: 0 },
      });
    }
    excelRow += 1;
  }

  return { sheetData: [head, ...body, foot], merges };
}

function addPageFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4 landscape`, MARGIN, pageHeight - 6);
    doc.setTextColor(0, 0, 0);
  }
}

/**
 * @param {{ monthLabel: string, brandLabel?: string, daysInMonth: number, rows: Array, dayTotals: number[], grandTotal: number }} data
 */
export function downloadDailyBagsByShopPdf(data, options = {}) {
  const {
    monthLabel = '',
    brandLabel = 'All brands',
    daysInMonth = 31,
    rows = [],
    dayTotals = [],
    grandTotal = 0,
    generatedAt = new Date(),
  } = data;
  const { monthSlug = '' } = options;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('Daily bags sold by shop', MARGIN, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 17);
  doc.text(`Month: ${monthLabel} · Brand: ${brandLabel}`, MARGIN, 21);
  doc.text(
    'Bags sold per shop and brand for each day of the month (from credit bills).',
    MARGIN,
    25,
  );
  doc.setTextColor(0, 0, 0);

  const pageW = doc.internal.pageSize.getWidth();
  const head = buildHead(daysInMonth);
  const body = rows.length > 0 ? buildBody(rows, daysInMonth) : [['—', '—', ...Array(daysInMonth).fill('0'), '0']];
  const foot = buildFoot(
    dayTotals.length === daysInMonth ? dayTotals : Array(daysInMonth).fill(0),
    grandTotal,
  );

  // First body-row index of each shop (for separator lines between shops).
  const shopStartRowIndices = new Set();
  if (rows.length > 0) {
    rows.forEach((r, i) => {
      if (r.shopRowSpan > 0) shopStartRowIndices.add(i);
    });
  }

  autoTable(doc, {
    head,
    body,
    foot,
    startY: 28,
    margin: { top: 28, left: MARGIN, right: MARGIN, bottom: 12 },
    theme: 'grid',
    styles: {
      fontSize: 5.5,
      cellPadding: 0.8,
      overflow: 'linebreak',
      valign: 'middle',
      halign: 'right',
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [71, 85, 105],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 5.5,
      lineColor: [71, 85, 105],
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      lineColor: [148, 163, 184],
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: 'left', cellWidth: 28, fontStyle: 'bold' },
      1: { halign: 'left', cellWidth: 16 },
      [daysInMonth + 2]: { fontStyle: 'bold' },
    },
    tableWidth: pageW - MARGIN * 2,
    showHead: 'everyPage',
    didDrawCell: (hookData) => {
      if (hookData.section !== 'body') return;
      // Draw once per shop-start row (first column only).
      if (hookData.column.index !== 0) return;
      const rowIndex = hookData.row.index;
      if (!shopStartRowIndices.has(rowIndex) || rowIndex === 0) return;

      const table = hookData.table;
      const startX = table.settings.margin.left;
      const endX = startX + table.getWidth();
      const y = hookData.cell.y;

      doc.setDrawColor(51, 65, 85);
      doc.setLineWidth(0.55);
      doc.line(startX, y, endX, y);
      doc.setLineWidth(0.15);
    },
  });

  addPageFooters(doc);

  const slug = monthSlug || generatedAt.toISOString().slice(0, 7);
  doc.save(`daily-bags-by-shop-${slug}.pdf`);
}

/**
 * @param {{ monthLabel: string, brandLabel?: string, daysInMonth: number, rows: Array, dayTotals: number[], grandTotal: number }} data
 */
export function downloadDailyBagsByShopExcel(data, options = {}) {
  const {
    daysInMonth = 31,
    rows = [],
    dayTotals = [],
    grandTotal = 0,
    generatedAt = new Date(),
  } = data;
  const { monthSlug = '' } = options;

  const { sheetData, merges } = buildExcelSheet(
    rows,
    daysInMonth,
    dayTotals.length === daysInMonth ? dayTotals : Array(daysInMonth).fill(0),
    grandTotal,
  );

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  if (merges.length > 0) worksheet['!merges'] = merges;
  worksheet['!cols'] = [
    { wch: 28 },
    { wch: 12 },
    ...Array.from({ length: daysInMonth }, () => ({ wch: 5 })),
    { wch: 8 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily bags');

  const slug = monthSlug || generatedAt.toISOString().slice(0, 7);
  XLSX.writeFile(workbook, `daily-bags-by-shop-${slug}.xlsx`);
}

/** Download PDF and Excel. */
export function downloadDailyBagsByShopReport(data, options = {}) {
  downloadDailyBagsByShopPdf(data, options);
  window.setTimeout(() => downloadDailyBagsByShopExcel(data, options), 200);
}
