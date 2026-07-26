import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const MARGIN = 14;

const TABLE_HEAD = [
  [
    'Date',
    'Shop name + Location',
    'Bag type',
    'No. Bags',
    'Cut-off price per bag',
    'Selling price per bag',
    'Pure incentive per bag',
    'Total Incentive',
    'Cumulative sum',
  ],
];

function formatAmount(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
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

function formatFilterLine(options = {}) {
  const {
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
  } = options;
  const parts = [];
  if (dateFrom || dateTo) {
    if (dateFrom && dateTo) parts.push(`Period: ${dateFrom} to ${dateTo}`);
    else if (dateFrom) parts.push(`From: ${dateFrom}`);
    else parts.push(`To: ${dateTo}`);
  }
  if (String(search ?? '').trim()) parts.push(`Search: ${String(search).trim()}`);
  if (String(shop ?? '').trim()) parts.push(`Shop: ${String(shop).trim()}`);
  if (String(brandLabel ?? '').trim()) parts.push(`Bag type: ${String(brandLabel).trim()}`);
  if (String(stockId ?? '').trim()) parts.push(`Stock ID: ${String(stockId).trim()}`);
  return parts.join(' · ');
}

export function shopLocationLabel(shop, location) {
  const name = String(shop ?? '').trim() || '—';
  const loc = String(location ?? '').trim();
  return loc ? `${name} — ${loc}` : name;
}

export function resolveLocation(shop, locationMap) {
  const key = String(shop ?? '').trim().toLowerCase();
  if (!key || key === '—') return '';
  return locationMap?.get(key) || '';
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function hasZeroPureIncentive(row) {
  const n = row?.pureIncentivePerBag;
  if (n == null || n === '' || !Number.isFinite(Number(n))) return false;
  return round2(n) === 0;
}

function buildCompanyRows(rows, locationMap) {
  return (rows || []).filter((r) => !hasZeroPureIncentive(r)).map((r) => {
    const location = resolveLocation(r.shop, locationMap);
    return {
      shop: String(r.shop ?? '').trim() || '—',
      date: r.date ?? '',
      shopLocation: shopLocationLabel(r.shop, location),
      brandLabel: r.brandLabel ?? '',
      bags: Number(r.bags) || 0,
      cutOffPrice: r.cutOffPrice,
      sellingPricePerBag: r.sellingPricePerBag,
      pureIncentivePerBag: r.pureIncentivePerBag,
      totalIncentive: r.totalIncentive,
    };
  });
}

function cumulativeCell(cumulative, hasCumulative) {
  return hasCumulative ? round2(cumulative) : '';
}

function buildPdfTableBody(companyRows) {
  const body = [];
  const subtotalRowIndices = new Set();
  const groups = new Map();
  const shopOrder = [];
  let cumulative = 0;
  let hasCumulative = false;

  for (const row of companyRows) {
    if (!groups.has(row.shop)) {
      groups.set(row.shop, []);
      shopOrder.push(row.shop);
    }
    groups.get(row.shop).push(row);
  }

  for (const shop of shopOrder) {
    const shopRows = groups.get(shop);
    let shopBags = 0;
    let shopTotalIncentive = 0;
    let hasShopTotalIncentive = false;

    for (const r of shopRows) {
      if (r.totalIncentive != null && Number.isFinite(Number(r.totalIncentive))) {
        cumulative += Number(r.totalIncentive);
        hasCumulative = true;
      }
      body.push([
        r.date,
        r.shopLocation,
        r.brandLabel,
        r.bags,
        r.cutOffPrice,
        r.sellingPricePerBag,
        r.pureIncentivePerBag,
        r.totalIncentive,
        cumulativeCell(cumulative, hasCumulative),
      ]);
      shopBags += r.bags;
      if (r.totalIncentive != null && Number.isFinite(Number(r.totalIncentive))) {
        shopTotalIncentive += Number(r.totalIncentive);
        hasShopTotalIncentive = true;
      }
    }

    subtotalRowIndices.add(body.length);
    body.push([
      '',
      shopRows[0].shopLocation,
      'Shop total',
      shopBags,
      '',
      '',
      '',
      hasShopTotalIncentive ? round2(shopTotalIncentive) : '',
      cumulativeCell(cumulative, hasCumulative),
    ]);
  }

  return { body, subtotalRowIndices, cumulative, hasCumulative };
}

function computeTotals(rows) {
  let bags = 0;
  let totalIncentive = 0;
  let hasTotalIncentive = false;
  for (const r of rows) {
    bags += r.bags;
    if (r.totalIncentive != null && Number.isFinite(Number(r.totalIncentive))) {
      totalIncentive += Number(r.totalIncentive);
      hasTotalIncentive = true;
    }
  }
  return { bags, totalIncentive, hasTotalIncentive };
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

function amountCellHook(numericColumns) {
  return function didParseCell(data) {
    if (data.section === 'head') return;
    if (!numericColumns.has(data.column.index)) return;

    const raw = data.cell.raw;
    if (raw == null || raw === '' || raw === '—') {
      data.cell.text = ['—'];
      return;
    }

    const num = Number(raw);
    if (!Number.isFinite(num)) return;

    data.cell.text = [formatAmount(num)];
    if (num < 0) {
      data.cell.styles.textColor = [234, 88, 12];
      data.cell.styles.fontStyle = 'bold';
    }
  };
}

/**
 * @param {Array} distributionRows — filtered incentive calculator rows
 * @param {Map<string, string>} locationMap — shop name (lowercase) → location
 */
export function downloadIncentiveCompanyPdf(distributionRows, locationMap, options = {}) {
  const { generatedAt = new Date(), dateFrom = '', dateTo = '' } = options;
  const companyRows = buildCompanyRows(distributionRows, locationMap);
  const totals = computeTotals(companyRows);
  const { body, subtotalRowIndices, cumulative, hasCumulative } = buildPdfTableBody(companyRows);

  const foot = [
    [
      'Grand total',
      '',
      '',
      totals.bags,
      '',
      '',
      '',
      totals.hasTotalIncentive ? totals.totalIncentive : '',
      cumulativeCell(cumulative, hasCumulative),
    ],
  ];

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - MARGIN * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Special Price Calculator — Company', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);

  const filterLine = formatFilterLine(options);
  let startY = 27;
  if (filterLine) {
    doc.text(filterLine, MARGIN, startY);
    startY += 5;
  }
  doc.setTextColor(0, 0, 0);

  const amountCols = new Set([4, 5, 6, 7, 8]);
  const formatAmounts = amountCellHook(amountCols);

  autoTable(doc, {
    head: TABLE_HEAD,
    body: body.length > 0 ? body : [['—', '—', '—', 0, '', '', '', '', '']],
    foot,
    startY: startY + 2,
    margin: { top: startY + 2, left: MARGIN, right: MARGIN, bottom: 16 },
    tableWidth: contentW,
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'middle' },
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
      0: { cellWidth: contentW * 0.07 },
      1: { cellWidth: contentW * 0.2 },
      2: { cellWidth: contentW * 0.09 },
      3: { halign: 'right', cellWidth: contentW * 0.07 },
      4: { halign: 'right', cellWidth: contentW * 0.11 },
      5: { halign: 'right', cellWidth: contentW * 0.11 },
      6: { halign: 'right', cellWidth: contentW * 0.11 },
      7: { halign: 'right', cellWidth: contentW * 0.11 },
      8: { halign: 'right', cellWidth: contentW * 0.13 },
    },
    showHead: 'everyPage',
    didParseCell(data) {
      if (data.section === 'body' && subtotalRowIndices.has(data.row.index)) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.textColor = [15, 23, 42];
      }
      if (data.section === 'body' && data.column.index === 3) {
        const raw = data.cell.raw;
        if (raw != null && raw !== '' && raw !== '—') {
          data.cell.text = [String(Number(raw) || 0)];
        }
        return;
      }
      formatAmounts(data);
    },
  });

  addPageFooters(doc);

  const { rangeSlug, safeDate } = fileSlug({ dateFrom, dateTo, generatedAt });
  doc.save(`incentive-company-${rangeSlug}-${safeDate}.pdf`);
}

/**
 * @param {Array} distributionRows — filtered incentive calculator rows
 * @param {Map<string, string>} locationMap — shop name (lowercase) → location
 */
export function downloadIncentiveCompanyExcel(distributionRows, locationMap, options = {}) {
  const { generatedAt = new Date(), dateFrom = '', dateTo = '' } = options;
  const companyRows = buildCompanyRows(distributionRows, locationMap);
  const totals = computeTotals(companyRows);
  const { body, cumulative, hasCumulative } = buildPdfTableBody(companyRows);
  const head = TABLE_HEAD[0];
  const sheetData = [
    head,
    ...body,
    ...(body.length > 0
      ? [
          [
            'Grand total',
            '',
            '',
            totals.bags,
            '',
            '',
            '',
            totals.hasTotalIncentive ? totals.totalIncentive : '',
            cumulativeCell(cumulative, hasCumulative),
          ],
        ]
      : []),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 36 },
    { wch: 14 },
    { wch: 10 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Special Price Calculator');
  const { rangeSlug, safeDate } = fileSlug({ dateFrom, dateTo, generatedAt });
  XLSX.writeFile(workbook, `incentive-company-${rangeSlug}-${safeDate}.xlsx`);
}

/** Download company PDF and Excel in one click. */
export function downloadIncentiveCompanyReport(distributionRows, locationMap, options = {}) {
  downloadIncentiveCompanyPdf(distributionRows, locationMap, options);
  window.setTimeout(() => downloadIncentiveCompanyExcel(distributionRows, locationMap, options), 200);
}
