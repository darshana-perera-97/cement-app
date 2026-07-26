import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { resolveLocation, shopLocationLabel } from './incentiveCompanyExport';

const MARGIN = 14;

const TABLE_HEAD = [
  [
    'Date',
    'StockID',
    'Invoice number',
    'Bag type',
    'No. Bags',
    'Bag Price in Invoice',
    'Transport Cost',
    'Cut-off price (per bag)',
    'Total Cost per bag',
    'Incentive per bag',
    'Total Incentive',
  ],
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function priceDiffPerBag(left, right) {
  if (
    left == null ||
    right == null ||
    !Number.isFinite(Number(left)) ||
    !Number.isFinite(Number(right))
  ) {
    return null;
  }
  return round2(Number(left) - Number(right));
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

    data.cell.text = [
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(num),
    ];
    if (num < 0) {
      data.cell.styles.textColor = [234, 88, 12];
      data.cell.styles.fontStyle = 'bold';
    }
  };
}

/** Enrich distribution rows with shop location and basic total incentive. */
export function buildBasicIncentiveRows(distributionRows, locationMap) {
  return (distributionRows || []).map((r) => {
    const location = resolveLocation(r.shop, locationMap);
    const basicIncentivePerBag = priceDiffPerBag(r.totalCostPerBag, r.cutOffPrice);
    const basicTotalIncentive =
      basicIncentivePerBag != null
        ? round2(basicIncentivePerBag * (Number(r.bags) || 0))
        : null;
    return {
      ...r,
      shopLocation: shopLocationLabel(r.shop, location),
      basicIncentivePerBag,
      basicTotalIncentive,
    };
  });
}

/** One row per stock load × brand — incentive on all bags received, not sold allocations. */
export function buildLoadBasedBasicIncentiveRows(loadRows) {
  return (loadRows || []).map((r) => {
    const totalCostPerBag = r.unloadingPrice;
    const basicIncentivePerBag = priceDiffPerBag(totalCostPerBag, r.cutOffPrice);
    const basicTotalIncentive =
      basicIncentivePerBag != null
        ? round2(basicIncentivePerBag * (Number(r.bags) || 0))
        : null;
    return {
      rowKey: r.rowKey,
      date: r.date,
      loadDate: r.date,
      stockId: r.stockId,
      brandKey: r.brandKey,
      brandLabel: r.brandLabel,
      bags: r.bags,
      perBagPrice: r.perBagCost,
      transportPerBag: r.transportPerBag,
      cutOffPrice: r.cutOffPrice,
      totalCostPerBag,
      invoiceNumber: r.invoiceNumber ?? '—',
      basicIncentivePerBag,
      basicTotalIncentive,
    };
  });
}

/** Insert a subtotal row after each shop group (rows must already be sorted by shop). */
export function buildShopGroupedBasicIncentiveRows(rows) {
  const result = [];
  let currentShop = null;
  let currentShopLocation = '';
  let shopTotals = {
    bags: 0,
    totalIncentive: 0,
    hasTotalIncentive: false,
  };

  const flushShopTotal = () => {
    result.push({
      type: 'shopTotal',
      rowKey: `shop-total-${currentShop}`,
      shop: currentShop,
      shopLocation: currentShopLocation || currentShop,
      bags: shopTotals.bags,
      basicTotalIncentive: round2(shopTotals.totalIncentive),
      hasTotalIncentive: shopTotals.hasTotalIncentive,
    });
  };

  for (const row of rows) {
    if (currentShop !== null && row.shop !== currentShop) {
      flushShopTotal();
      shopTotals = {
        bags: 0,
        totalIncentive: 0,
        hasTotalIncentive: false,
      };
    }
    currentShop = row.shop;
    currentShopLocation = row.shopLocation || row.shop || '';
    result.push({ type: 'data', ...row });
    shopTotals.bags += Number(row.bags) || 0;
    if (row.basicTotalIncentive != null) {
      shopTotals.totalIncentive += Number(row.basicTotalIncentive) || 0;
      shopTotals.hasTotalIncentive = true;
    }
  }

  if (currentShop !== null) {
    flushShopTotal();
  }

  return result;
}

/** Insert a subtotal row after each stock group (rows sorted by stock, then date/shop/brand). */
export function buildStockGroupedBasicIncentiveRows(rows) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const byStock = String(a.stockId ?? '').localeCompare(String(b.stockId ?? ''));
    if (byStock !== 0) return byStock;
    const byDate = String(a.date ?? '').localeCompare(String(b.date ?? ''));
    if (byDate !== 0) return byDate;
    const byShop = String(a.shop ?? '').localeCompare(String(b.shop ?? ''));
    if (byShop !== 0) return byShop;
    return String(a.brandLabel ?? '').localeCompare(String(b.brandLabel ?? ''));
  });

  const result = [];
  let currentStock = null;
  let stockTotals = {
    bags: 0,
    totalIncentive: 0,
    hasTotalIncentive: false,
  };

  const flushStockTotal = () => {
    result.push({
      type: 'stockTotal',
      rowKey: `stock-total-${currentStock}`,
      stockId: currentStock,
      bags: stockTotals.bags,
      basicTotalIncentive: round2(stockTotals.totalIncentive),
      hasTotalIncentive: stockTotals.hasTotalIncentive,
    });
  };

  for (const row of sorted) {
    if (currentStock !== null && row.stockId !== currentStock) {
      flushStockTotal();
      stockTotals = {
        bags: 0,
        totalIncentive: 0,
        hasTotalIncentive: false,
      };
    }
    currentStock = row.stockId;
    result.push({ type: 'data', ...row });
    stockTotals.bags += Number(row.bags) || 0;
    if (row.basicTotalIncentive != null) {
      stockTotals.totalIncentive += Number(row.basicTotalIncentive) || 0;
      stockTotals.hasTotalIncentive = true;
    }
  }

  if (currentStock !== null) {
    flushStockTotal();
  }

  return result;
}

/** Stock-wise export only — one row per stock × bag type plus stock subtotals (no shop allocation detail). */
export function buildStockWiseExportRows(rows) {
  const byStockBrand = new Map();

  for (const row of rows || []) {
    if (row.type === 'shopTotal' || row.type === 'stockTotal') continue;

    const stockId = String(row.stockId ?? '').trim() || '—';
    const brandKey = row.brandKey ?? '';
    const key = `${stockId}|${brandKey}`;
    const bags = Number(row.bags) || 0;
    const incentive = row.basicTotalIncentive;

    const existing = byStockBrand.get(key);
    if (!existing) {
      byStockBrand.set(key, {
        type: 'data',
        rowKey: key,
        loadDate: row.loadDate ?? row.date,
        stockId,
        invoiceNumber: row.invoiceNumber ?? '—',
        brandKey,
        brandLabel: row.brandLabel,
        bags,
        perBagPrice: row.perBagPrice,
        transportPerBag: row.transportPerBag,
        cutOffPrice: row.cutOffPrice,
        totalCostPerBag: row.totalCostPerBag,
        basicIncentivePerBag: row.basicIncentivePerBag,
        basicTotalIncentive: incentive != null ? Number(incentive) : null,
      });
      continue;
    }

    existing.bags += bags;
    if (incentive != null) {
      existing.basicTotalIncentive = (existing.basicTotalIncentive ?? 0) + Number(incentive);
    }
  }

  const sorted = [...byStockBrand.values()].sort((a, b) => {
    const byStock = a.stockId.localeCompare(b.stockId);
    if (byStock !== 0) return byStock;
    return String(a.brandLabel ?? '').localeCompare(String(b.brandLabel ?? ''));
  });

  const result = [];
  let currentStock = null;
  let stockTotals = {
    bags: 0,
    totalIncentive: 0,
    hasTotalIncentive: false,
  };

  const flushStockTotal = () => {
    result.push({
      type: 'stockTotal',
      rowKey: `stock-total-${currentStock}`,
      stockId: currentStock,
      bags: stockTotals.bags,
      basicTotalIncentive: round2(stockTotals.totalIncentive),
      hasTotalIncentive: stockTotals.hasTotalIncentive,
    });
  };

  for (const row of sorted) {
    if (currentStock !== null && row.stockId !== currentStock) {
      flushStockTotal();
      stockTotals = {
        bags: 0,
        totalIncentive: 0,
        hasTotalIncentive: false,
      };
    }
    currentStock = row.stockId;
    if (row.basicTotalIncentive != null) {
      row.basicTotalIncentive = round2(row.basicTotalIncentive);
    }
    result.push(row);
    stockTotals.bags += row.bags;
    if (row.basicTotalIncentive != null) {
      stockTotals.totalIncentive += row.basicTotalIncentive;
      stockTotals.hasTotalIncentive = true;
    }
  }

  if (currentStock !== null) {
    flushStockTotal();
  }

  return result;
}

function computeGrandTotals(rows) {
  const t = { bags: 0, totalIncentive: 0, hasTotalIncentive: false };
  for (const r of rows) {
    if (r.type === 'shopTotal' || r.type === 'stockTotal') continue;
    t.bags += Number(r.bags) || 0;
    if (r.basicTotalIncentive != null) {
      t.totalIncentive += Number(r.basicTotalIncentive) || 0;
      t.hasTotalIncentive = true;
    }
  }
  return { ...t, totalIncentive: round2(t.totalIncentive) };
}

function rowToCells(r) {
  if (r.type === 'shopTotal') {
    return [
      '',
      '',
      `${String(r.shopLocation ?? r.shop ?? '')} total`,
      '',
      Number(r.bags) || 0,
      '',
      '',
      '',
      '',
      '',
      r.hasTotalIncentive ? r.basicTotalIncentive : '',
    ];
  }
  if (r.type === 'stockTotal') {
    return [
      '',
      `${String(r.stockId ?? '')} total`,
      '',
      '',
      Number(r.bags) || 0,
      '',
      '',
      '',
      '',
      '',
      r.hasTotalIncentive ? r.basicTotalIncentive : '',
    ];
  }
  return [
    String(r.date ?? ''),
    String(r.stockId ?? ''),
    String(r.invoiceNumber ?? r.shopLocation ?? r.shop ?? '—'),
    String(r.brandLabel ?? ''),
    Number(r.bags) || 0,
    r.perBagPrice,
    r.transportPerBag,
    r.cutOffPrice,
    r.totalCostPerBag,
    r.basicIncentivePerBag,
    r.basicTotalIncentive,
  ];
}

const STOCK_WISE_TABLE_HEAD = [
  [
    'Date',
    'StockID',
    'Invoice number',
    'Bag type',
    'No. Bags',
    'Bag Price in Invoice',
    'Transport Cost',
    'Cut-off price (per bag)',
    'Total Cost per bag',
    'Incentive per bag',
    'Total Incentive',
    'Total Incentive for Load',
  ],
];

function stockWiseRowToCells(r) {
  if (r.type === 'stockTotal') {
    return [
      '',
      `${String(r.stockId ?? '')} total`,
      '',
      '',
      Number(r.bags) || 0,
      '',
      '',
      '',
      '',
      '',
      '',
      r.hasTotalIncentive ? r.basicTotalIncentive : '',
    ];
  }
  return [
    String(r.loadDate ?? r.date ?? ''),
    String(r.stockId ?? ''),
    String(r.invoiceNumber ?? '—'),
    String(r.brandLabel ?? ''),
    Number(r.bags) || 0,
    r.perBagPrice,
    r.transportPerBag,
    r.cutOffPrice,
    r.totalCostPerBag,
    r.basicIncentivePerBag,
    r.basicTotalIncentive,
    '',
  ];
}

function renderStockWiseTable(doc, groupedRows, options = {}) {
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
    title = 'Stock wise Incentive',
  } = options;
  const safeRows = groupedRows || [];

  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - MARGIN * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(title, MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);

  const filterLine = formatFilterLine({ dateFrom, dateTo, search, shop, brandLabel, stockId });
  let startY = 27;
  if (filterLine) {
    doc.text(filterLine, MARGIN, startY);
    startY += 5;
  }
  doc.setTextColor(0, 0, 0);

  const body =
    safeRows.length > 0
      ? safeRows.map(stockWiseRowToCells)
      : [['—', '—', '—', '—', 0, '', '', '', '', '', '', '']];
  const totals = computeGrandTotals(safeRows);
  const foot = [
    [
      'Grand total',
      '',
      '',
      '',
      totals.bags,
      '',
      '',
      '',
      '',
      '',
      totals.hasTotalIncentive ? totals.totalIncentive : '',
      totals.hasTotalIncentive ? totals.totalIncentive : '',
    ],
  ];

  const ratios = [0.07, 0.07, 0.08, 0.07, 0.06, 0.09, 0.08, 0.09, 0.09, 0.08, 0.08, 0.09];
  const amountCols = new Set([4, 5, 6, 7, 8, 9, 10, 11]);
  const formatAmounts = amountCellHook(amountCols);

  autoTable(doc, {
    head: STOCK_WISE_TABLE_HEAD,
    body,
    foot: safeRows.length > 0 ? foot : undefined,
    startY: startY + 2,
    margin: { top: startY + 2, left: MARGIN, right: MARGIN, bottom: 16 },
    tableWidth: contentW,
    styles: { fontSize: 6.5, cellPadding: 1.6, overflow: 'linebreak', valign: 'middle' },
    headStyles: {
      fillColor: [71, 85, 105],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 6,
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    showHead: 'everyPage',
    columnStyles: Object.fromEntries(
      ratios.map((ratio, index) => [
        index,
        {
          cellWidth: contentW * ratio,
          ...(index >= 4 ? { halign: 'right' } : {}),
        },
      ]),
    ),
    didParseCell(data) {
      if (data.section === 'head') return;
      const row = safeRows[data.row.index];
      if (row?.type === 'stockTotal') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
      if (data.column.index === 4) {
        const raw = data.cell.raw;
        if (raw != null && raw !== '' && raw !== '—') {
          data.cell.text = [String(Number(raw) || 0)];
        }
        return;
      }
      formatAmounts(data);
    },
  });
}

function renderBasicIncentiveTable(doc, groupedRows, options = {}) {
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
    title = 'Incentive Calculator',
  } = options;
  const safeRows = groupedRows || [];

  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - MARGIN * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(title, MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);

  const filterLine = formatFilterLine({ dateFrom, dateTo, search, shop, brandLabel, stockId });
  let startY = 27;
  if (filterLine) {
    doc.text(filterLine, MARGIN, startY);
    startY += 5;
  }
  doc.setTextColor(0, 0, 0);

  const body =
    safeRows.length > 0 ? safeRows.map(rowToCells) : [['—', '—', '—', '—', 0, '', '', '', '', '', '']];
  const totals = computeGrandTotals(safeRows);
  const foot = [
    [
      'Grand total',
      '',
      '',
      '',
      totals.bags,
      '',
      '',
      '',
      '',
      '',
      totals.hasTotalIncentive ? totals.totalIncentive : '',
    ],
  ];

  const ratios = [0.08, 0.07, 0.14, 0.08, 0.06, 0.09, 0.08, 0.09, 0.09, 0.09, 0.13];
  const amountCols = new Set([5, 6, 7, 8, 9, 10]);
  const formatAmounts = amountCellHook(amountCols);

  autoTable(doc, {
    head: TABLE_HEAD,
    body,
    foot: safeRows.length > 0 ? foot : undefined,
    startY: startY + 2,
    margin: { top: startY + 2, left: MARGIN, right: MARGIN, bottom: 16 },
    tableWidth: contentW,
    styles: { fontSize: 7, cellPadding: 1.8, overflow: 'linebreak', valign: 'middle' },
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
    columnStyles: Object.fromEntries(
      ratios.map((ratio, index) => [
        index,
        {
          cellWidth: contentW * ratio,
          ...(index >= 4 ? { halign: 'right' } : {}),
        },
      ]),
    ),
    didParseCell(data) {
      if (data.section === 'head') return;
      const row = safeRows[data.row.index];
      if (row?.type === 'shopTotal' || row?.type === 'stockTotal') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
      if (data.column.index === 4) {
        const raw = data.cell.raw;
        if (raw != null && raw !== '' && raw !== '—') {
          data.cell.text = [String(Number(raw) || 0)];
        }
        return;
      }
      formatAmounts(data);
    },
  });
}

function writeBasicIncentiveExcel(groupedRows, options = {}) {
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
    sheetName = 'Incentive Calculator',
  } = options;
  const safeRows = groupedRows || [];
  const filterLine = formatFilterLine({ dateFrom, dateTo, search, shop, brandLabel, stockId });
  const sheetData = [
    ...(filterLine ? [[filterLine]] : []),
    TABLE_HEAD[0],
    ...safeRows.map(rowToCells),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 12 },
    { wch: 36 },
    { wch: 14 },
    { wch: 10 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const { rangeSlug, safeDate } = fileSlug({ dateFrom, dateTo, generatedAt });
  return { workbook, rangeSlug, safeDate };
}

function writeStockWiseIncentiveExcel(groupedRows, options = {}) {
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
    sheetName = 'Stock wise',
  } = options;
  const safeRows = groupedRows || [];
  const totals = computeGrandTotals(safeRows);
  const filterLine = formatFilterLine({ dateFrom, dateTo, search, shop, brandLabel, stockId });
  const sheetData = [
    ...(filterLine ? [[filterLine]] : []),
    STOCK_WISE_TABLE_HEAD[0],
    ...safeRows.map(stockWiseRowToCells),
    ...(safeRows.length > 0
      ? [
          [
            'Grand total',
            '',
            '',
            '',
            totals.bags,
            '',
            '',
            '',
            '',
            '',
            totals.hasTotalIncentive ? totals.totalIncentive : '',
            totals.hasTotalIncentive ? totals.totalIncentive : '',
          ],
        ]
      : []),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const { rangeSlug, safeDate } = fileSlug({ dateFrom, dateTo, generatedAt });
  return { workbook, rangeSlug, safeDate };
}

/**
 * @param {Array} groupedRows — output of buildShopGroupedBasicIncentiveRows
 */
export function downloadBasicIncentivePdf(groupedRows, options = {}) {
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
  } = options;
  const safeRows = groupedRows || [];

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  renderBasicIncentiveTable(doc, safeRows, {
    generatedAt,
    dateFrom,
    dateTo,
    search,
    shop,
    brandLabel,
    stockId,
  });

  addPageFooters(doc);

  const { rangeSlug, safeDate } = fileSlug({ dateFrom, dateTo, generatedAt });
  doc.save(`incentive-calculator-${rangeSlug}-${safeDate}.pdf`);
}

/**
 * @param {Array} groupedRows — output of buildShopGroupedBasicIncentiveRows
 */
export function downloadBasicIncentiveExcel(groupedRows, options = {}) {
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
  } = options;
  const { workbook, rangeSlug, safeDate } = writeBasicIncentiveExcel(groupedRows, {
    generatedAt,
    dateFrom,
    dateTo,
    search,
    shop,
    brandLabel,
    stockId,
  });
  XLSX.writeFile(workbook, `incentive-calculator-${rangeSlug}-${safeDate}.xlsx`);
}

/**
 * @param {Array} rows — basic incentive rows (shop allocations are aggregated away)
 */
export function downloadStockWiseIncentivePdf(rows, options = {}) {
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
  } = options;
  const stockWiseRows = buildStockWiseExportRows(rows);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  renderStockWiseTable(doc, stockWiseRows, {
    generatedAt,
    dateFrom,
    dateTo,
    search,
    shop,
    brandLabel,
    stockId,
    title: 'Stock wise Incentive',
  });

  addPageFooters(doc);

  const { rangeSlug, safeDate } = fileSlug({ dateFrom, dateTo, generatedAt });
  doc.save(`incentive-calculator-stock-wise-${rangeSlug}-${safeDate}.pdf`);
}

/**
 * @param {Array} rows — basic incentive rows (shop allocations are aggregated away)
 */
export function downloadStockWiseIncentiveExcel(rows, options = {}) {
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    search = '',
    shop = '',
    brandLabel = '',
    stockId = '',
  } = options;
  const stockWiseRows = buildStockWiseExportRows(rows);
  const { workbook, rangeSlug, safeDate } = writeStockWiseIncentiveExcel(stockWiseRows, {
    generatedAt,
    dateTo,
    dateFrom,
    search,
    shop,
    brandLabel,
    stockId,
    sheetName: 'Stock wise',
  });
  XLSX.writeFile(workbook, `incentive-calculator-stock-wise-${rangeSlug}-${safeDate}.xlsx`);
}

/** Download stock-wise incentive report as both PDF and Excel. */
export function downloadStockWiseIncentive(groupedRows, options = {}) {
  downloadStockWiseIncentivePdf(groupedRows, options);
  downloadStockWiseIncentiveExcel(groupedRows, options);
}
