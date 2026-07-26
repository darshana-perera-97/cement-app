import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const MARGIN = 14;

const TABLE_STYLES = {
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
};

function formatAmount(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
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

    data.cell.text = [formatAmount(num)];
    if (num < 0) {
      data.cell.styles.textColor = [234, 88, 12];
      data.cell.styles.fontStyle = 'bold';
    }
  };
}

function computeCostTotals(rows) {
  const t = { bags: 0, transportCost: 0, margin: 0 };
  for (const r of rows) {
    t.bags += Number(r.bags) || 0;
    t.transportCost += (Number(r.transportPerBag) || 0) * (Number(r.bags) || 0);
    t.margin += (Number(r.margin) || 0) * (Number(r.bags) || 0);
  }
  return t;
}

function computeDistributionTotals(rows) {
  const t = { bags: 0, totalDifference: 0, hasTotalDifference: false };
  for (const r of rows) {
    if (r.type === 'shopTotal') continue;
    t.bags += Number(r.bags) || 0;
    if (r.totalDifference != null) {
      t.totalDifference += Number(r.totalDifference) || 0;
      t.hasTotalDifference = true;
    }
  }
  return t;
}

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

export function computeSpecialPriceFields(row) {
  const differencePerBag = priceDiffPerBag(row.sellingPricePerBag, row.cutOffPrice);
  const totalDifference =
    differencePerBag != null ? round2(differencePerBag * (Number(row.bags) || 0)) : null;
  return { differencePerBag, totalDifference };
}

/** Insert a subtotal row after each shop group (rows must already be sorted by shop). */
export function buildShopGroupedDistributionRows(rows) {
  const result = [];
  let currentShop = null;
  let shopTotals = {
    bags: 0,
    totalDifference: 0,
    hasTotalDifference: false,
  };
  const flushShopTotal = (shop) => {
    result.push({
      type: 'shopTotal',
      rowKey: `shop-total-${shop}`,
      shop,
      bags: shopTotals.bags,
      totalDifference: round2(shopTotals.totalDifference),
      hasTotalDifference: shopTotals.hasTotalDifference,
    });
  };

  for (const row of rows) {
    if (currentShop !== null && row.shop !== currentShop) {
      flushShopTotal(currentShop);
      shopTotals = {
        bags: 0,
        totalDifference: 0,
        hasTotalDifference: false,
      };
    }
    currentShop = row.shop;
    const { differencePerBag, totalDifference } = computeSpecialPriceFields(row);
    result.push({
      type: 'data',
      ...row,
      differencePerBag,
      totalDifference,
    });
    shopTotals.bags += Number(row.bags) || 0;
    if (totalDifference != null) {
      shopTotals.totalDifference += totalDifference;
      shopTotals.hasTotalDifference = true;
    }
  }

  if (currentShop !== null) {
    flushShopTotal(currentShop);
  }

  return result;
}

function drawSectionTitle(doc, title, subtitle, startY, contentW) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(title, MARGIN, startY);

  let y = startY + 5;
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(subtitle, contentW);
    doc.text(lines, MARGIN, y);
    y += lines.length * 3.5 + 2;
  }

  doc.setTextColor(0, 0, 0);
  return y;
}

function drawCostCalculatorTable(doc, rows, startY, contentW) {
  const safeRows = rows || [];
  const head = [
    ['Date', 'Bag type', 'Bags', 'Per bag price', 'Cut-off price (per bag)', 'Transport', 'Margin', 'Total cost per bag'],
  ];
  const body =
    safeRows.length > 0
      ? safeRows.map((r) => [
          String(r.date ?? ''),
          String(r.brandLabel ?? ''),
          Number(r.bags) || 0,
          r.perBagCost,
          r.cutOffPrice,
          r.transportPerBag,
          r.margin,
          r.unloadingPrice,
        ])
      : [['—', '—', 0, '', '', '', '', '']];

  const totals = computeCostTotals(safeRows);
  const foot = [['Totals', '', totals.bags, '', '', totals.transportCost, totals.margin, '']];

  const ratios = [0.1, 0.11, 0.07, 0.12, 0.12, 0.11, 0.11, 0.26];
  const numericCols = new Set([2, 3, 4, 5, 6, 7]);

  autoTable(doc, {
    ...TABLE_STYLES,
    head,
    body,
    foot: safeRows.length > 0 ? foot : undefined,
    startY,
    margin: { top: startY, left: MARGIN, right: MARGIN, bottom: 16 },
    tableWidth: contentW,
    showHead: 'everyPage',
    columnStyles: {
      0: { cellWidth: contentW * ratios[0] },
      1: { cellWidth: contentW * ratios[1] },
      2: { halign: 'right', cellWidth: contentW * ratios[2] },
      3: { halign: 'right', cellWidth: contentW * ratios[3] },
      4: { halign: 'right', cellWidth: contentW * ratios[4] },
      5: { halign: 'right', cellWidth: contentW * ratios[5] },
      6: { halign: 'right', cellWidth: contentW * ratios[6] },
      7: { halign: 'right', cellWidth: contentW * ratios[7], fontStyle: 'bold' },
    },
    didParseCell: amountCellHook(numericCols),
  });

  return doc.lastAutoTable.finalY;
}

function drawIncentiveCalculatorTable(doc, rows, startY, contentW) {
  const safeRows = rows || [];
  const head = [
    [
      'Date',
      'Shop Name',
      'Bag Type',
      'Amount',
      'Cut-off price',
      'Sold price',
      'Different per bag',
      'Total difference',
    ],
  ];

  const body =
    safeRows.length > 0
      ? safeRows.map((r) => {
          if (r.type === 'shopTotal') {
            return [
              '',
              `${String(r.shop ?? '')} total`,
              '',
              Number(r.bags) || 0,
              '',
              '',
              '',
              r.hasTotalDifference ? r.totalDifference : '',
            ];
          }
          return [
            String(r.date ?? ''),
            String(r.shop ?? ''),
            String(r.brandLabel ?? ''),
            Number(r.bags) || 0,
            r.cutOffPrice,
            r.sellingPricePerBag,
            r.differencePerBag,
            r.totalDifference,
          ];
        })
      : [['—', '—', '—', 0, '', '', '', '']];

  const totals = computeDistributionTotals(safeRows);
  const foot = [
    [
      'Grand total',
      '',
      '',
      totals.bags,
      '',
      '',
      '',
      totals.hasTotalDifference ? totals.totalDifference : '',
    ],
  ];

  const ratios = [0.11, 0.16, 0.11, 0.09, 0.13, 0.13, 0.14, 0.13];
  const amountCols = new Set([4, 5, 6, 7]);
  const formatAmounts = amountCellHook(amountCols);

  autoTable(doc, {
    ...TABLE_STYLES,
    styles: { ...TABLE_STYLES.styles, fontSize: 8 },
    head,
    body,
    foot: safeRows.length > 0 ? foot : undefined,
    startY,
    margin: { top: startY, left: MARGIN, right: MARGIN, bottom: 16 },
    tableWidth: contentW,
    showHead: 'everyPage',
    columnStyles: Object.fromEntries(
      ratios.map((ratio, index) => [
        index,
        {
          cellWidth: contentW * ratio,
          ...(index >= 3 ? { halign: 'right' } : {}),
        },
      ]),
    ),
    didParseCell(data) {
      if (data.section === 'head') return;
      const row = safeRows[data.row.index];
      if (row?.type === 'shopTotal') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
      if (data.column.index === 3) {
        const raw = data.cell.raw;
        if (raw != null && raw !== '' && raw !== '—') {
          data.cell.text = [String(Number(raw) || 0)];
        }
        return;
      }
      formatAmounts(data);
    },
  });

  return doc.lastAutoTable.finalY;
}

/**
 * Build an A4 landscape PDF with only the Cost Calculator for Loads table (filtered rows).
 * @param {Array} costRows — Cost Calculator for Loads rows
 */
export function downloadIncentiveCostPdf(costRows, options = {}) {
  const { generatedAt = new Date(), dateFrom = '', dateTo = '', search = '' } = options;

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
  doc.text('Cost Calculator for Loads', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);

  const filterLine = formatFilterLine({ dateFrom, dateTo, search });
  let y = 27;
  if (filterLine) {
    doc.text(filterLine, MARGIN, y);
    y += 5;
  }
  doc.setTextColor(0, 0, 0);

  y = drawSectionTitle(
    doc,
    'Cost Calculator for Loads',
    'Stock load pricing by bag type — per-bag price, transport, margin, and total cost per bag.',
    y + 2,
    contentW,
  );
  drawCostCalculatorTable(doc, costRows, y + 2, contentW);

  addPageFooters(doc);

  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`incentive-cost-${rangeSlug}-${safeDate}.pdf`);
}

/**
 * Build an A4 landscape PDF with only the Incentive calculator table (filtered rows).
 * @param {Array} distributionRows — Incentive calculator rows (ungrouped; shop totals added automatically)
 */
export function downloadIncentiveCalculatorPdf(distributionRows, options = {}) {
  const { generatedAt = new Date(), dateFrom = '', dateTo = '' } = options;

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
  doc.text('Special Price Calculator', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);

  const filterLine = formatFilterLine(options);
  let y = 27;
  if (filterLine) {
    doc.text(filterLine, MARGIN, y);
    y += 5;
  }
  doc.setTextColor(0, 0, 0);

  y = drawSectionTitle(
    doc,
    'Special Price Calculator',
    '',
    y + 2,
    contentW,
  );
  drawIncentiveCalculatorTable(
    doc,
    buildShopGroupedDistributionRows(distributionRows || []),
    y + 2,
    contentW,
  );

  addPageFooters(doc);

  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`special-price-calculator-${rangeSlug}-${safeDate}.pdf`);
}

/**
 * Build an A4 landscape PDF with both Incentive page tables (filtered rows).
 * @param {Array} costRows — Cost Calculator for Loads rows
 * @param {Array} distributionRows — Incentive calculator rows
 */
export function downloadIncentivePdf(costRows, distributionRows, options = {}) {
  const { generatedAt = new Date(), dateFrom = '', dateTo = '', search = '' } = options;

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
  doc.text('Incentive page report', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);

  const filterLine = formatFilterLine({ dateFrom, dateTo, search });
  let y = 27;
  if (filterLine) {
    doc.text(filterLine, MARGIN, y);
    y += 5;
  }
  doc.setTextColor(0, 0, 0);

  y = drawSectionTitle(
    doc,
    'Cost Calculator for Loads',
    'Stock load pricing by bag type — per-bag price, transport, margin, and total cost per bag.',
    y + 2,
    contentW,
  );
  y = drawCostCalculatorTable(doc, costRows, y + 2, contentW) + 10;

  y = drawSectionTitle(
    doc,
    'Special Price Calculator',
    '',
    y,
    contentW,
  );
  drawIncentiveCalculatorTable(
    doc,
    buildShopGroupedDistributionRows(distributionRows || []),
    y + 2,
    contentW,
  );

  addPageFooters(doc);

  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`incentive-report-${rangeSlug}-${safeDate}.pdf`);
}
