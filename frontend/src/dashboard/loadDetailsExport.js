import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { productToBrandKey } from './brandTheme';
import { poLineItems } from './poItems';

const MARGIN = 14;

const PDF_HEAD = [
  [
    'Date',
    'Lorry number',
    'Driver name',
    'Item name',
    'Bags',
    'Invoice number',
    'Transport location',
    'Door step',
  ],
];

function display(v) {
  const s = String(v ?? '').trim();
  return s || '—';
}

function formatBags(n) {
  return (Number(n) || 0).toLocaleString();
}

function isDoorStockPo(po) {
  return Boolean(po?.doorStock) || String(po?.notes ?? '').trim().toLowerCase() === 'door step';
}

function uniqueJoin(values) {
  const seen = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    if (seen.some((existing) => existing.toLowerCase() === text.toLowerCase())) continue;
    seen.push(text);
  }
  return seen.join(', ');
}

function doorstepText(matchedPos, load) {
  if (matchedPos.length > 0) {
    const flags = matchedPos.map(isDoorStockPo);
    if (flags.every(Boolean)) return 'Yes';
    if (flags.some(Boolean)) return 'Mixed';
    return 'No';
  }
  return Number(load?.doorStockTransportCostPerBag) > 0 ? 'Yes' : 'No';
}

function slugPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function fileSlug(options = {}) {
  const {
    dateFrom = '',
    dateTo = '',
    transportLocation = '',
    brand = '',
    generatedAt = new Date(),
  } = options;
  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const extra = [slugPart(transportLocation), slugPart(brand)].filter(Boolean).join('_');
  const safeDate = generatedAt.toISOString().slice(0, 10);
  return {
    rangeSlug: extra ? `${rangeSlug}_${extra}` : rangeSlug,
    safeDate,
  };
}

function filterLine(options = {}) {
  const { dateFrom = '', dateTo = '', transportLocation = '', brand = '' } = options;
  const parts = [];
  if (dateFrom && dateTo) parts.push(`Period: ${dateFrom} to ${dateTo}`);
  else if (dateFrom) parts.push(`From: ${dateFrom}`);
  else if (dateTo) parts.push(`To: ${dateTo}`);
  else parts.push('Period: all dates');
  parts.push(
    String(transportLocation || '').trim()
      ? `Transport location: ${String(transportLocation).trim()}`
      : 'Transport location: all',
  );
  parts.push(String(brand || '').trim() ? `Brand: ${String(brand).trim()}` : 'Brand: all');
  return parts.join(' · ');
}

function addPageFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4 landscape`, MARGIN, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }
}

/**
 * One row per load × item. Item name is the product name only (no product code).
 * Driver, transport location, and door step come from purchase orders linked to that item.
 */
export function buildLoadDetailRows(loads, purchaseOrders, brands) {
  const brandList = Array.isArray(brands) ? brands : [];
  const poById = new Map(
    (Array.isArray(purchaseOrders) ? purchaseOrders : []).map((po) => [String(po.id), po]),
  );
  const rows = [];

  for (const load of Array.isArray(loads) ? loads : []) {
    const poIds = Array.isArray(load?.purchaseOrderIds) ? load.purchaseOrderIds : [];
    const pos = poIds.map((id) => poById.get(String(id || '').trim())).filter(Boolean);
    const date = String(load?.date ?? '').slice(0, 10);
    const lorryNumber = String(load?.vehicleNumber ?? '').trim();
    const stockId = String(load?.stockId ?? '').trim();

    for (const brand of brandList) {
      const bags = Number(load?.[`${brand.key}Bags`]) || 0;
      if (bags <= 0) continue;
      const matched = pos.filter((po) =>
        poLineItems(po).some((line) => productToBrandKey(line.product, brandList) === brand.key),
      );
      rows.push({
        rowKey: `${load.id || stockId}-${brand.key}`,
        date,
        lorryNumber,
        driverName: uniqueJoin(matched.map((po) => po.driverName)),
        itemName: String(brand.label ?? '').trim() || String(brand.key ?? ''),
        bags,
        invoiceNumber: String(load?.[`${brand.key}Invoice`] ?? '').trim(),
        transportLocation: uniqueJoin(matched.map((po) => po.distributionLocation)),
        doorstep: doorstepText(matched, load),
        stockId,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate !== 0) return byDate;
    const byLorry = String(a.lorryNumber).localeCompare(String(b.lorryNumber));
    if (byLorry !== 0) return byLorry;
    return String(a.itemName).localeCompare(String(b.itemName));
  });
  return rows;
}

export function loadDetailBagTotal(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (Number(row.bags) || 0), 0);
}

function bodyRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => [
    display(row.date),
    display(row.lorryNumber),
    display(row.driverName),
    display(row.itemName),
    formatBags(row.bags),
    display(row.invoiceNumber),
    display(row.transportLocation),
    display(row.doorstep),
  ]);
}

export function downloadLoadDetailsPdf(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const { generatedAt = new Date() } = options;
  const totalBags = loadDetailBagTotal(safeRows);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Load details', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(filterLine(options), MARGIN, 27);
  doc.text(
    `${safeRows.length} line${safeRows.length === 1 ? '' : 's'} · ${formatBags(totalBags)} bags`,
    MARGIN,
    32,
  );
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    head: PDF_HEAD,
    body: safeRows.length > 0 ? bodyRows(safeRows) : [PDF_HEAD[0].map(() => '—')],
    foot: [['Total', '', '', '', formatBags(totalBags), '', '', '']],
    startY: 38,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      4: { halign: 'right' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc);
  const { rangeSlug, safeDate } = fileSlug({ ...options, generatedAt });
  doc.save(`load-details-${rangeSlug}-${safeDate}.pdf`);
}

export function downloadLoadDetailsExcel(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const { generatedAt = new Date() } = options;
  const totalBags = loadDetailBagTotal(safeRows);
  const sheetData = [
    ['Load details'],
    [filterLine(options)],
    [`Generated: ${generatedAt.toISOString()}`],
    [],
    PDF_HEAD[0],
    ...safeRows.map((row) => [
      String(row.date ?? '').slice(0, 10),
      String(row.lorryNumber ?? '').trim(),
      String(row.driverName ?? '').trim(),
      String(row.itemName ?? '').trim(),
      Number(row.bags) || 0,
      String(row.invoiceNumber ?? '').trim(),
      String(row.transportLocation ?? '').trim(),
      String(row.doorstep ?? '').trim(),
    ]),
    [],
    ['Total', '', '', '', totalBags, '', '', ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 22 },
    { wch: 28 },
    { wch: 10 },
    { wch: 18 },
    { wch: 28 },
    { wch: 12 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Load details');
  const { rangeSlug, safeDate } = fileSlug({ ...options, generatedAt });
  XLSX.writeFile(workbook, `load-details-${rangeSlug}-${safeDate}.xlsx`);
}
