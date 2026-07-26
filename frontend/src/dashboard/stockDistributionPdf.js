import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BRANDS } from './brandTheme';

const MARGIN = 14;

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
  return `LKR ${formatLkr(n)}`;
}

const TABLE_OPTS = {
  styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak', valign: 'middle' },
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
  margin: { left: MARGIN, right: MARGIN, bottom: 16 },
};

function nextY(doc, gap = 8) {
  const last = doc.lastAutoTable?.finalY;
  return (last != null ? last : 30) + gap;
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

function drawSectionTitle(doc, title, subtitle, startY) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, MARGIN, startY);
  let y = startY + 5;
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(subtitle, MARGIN, y);
    y += 5;
  }
  doc.setTextColor(0, 0, 0);
  return y + 2;
}

function drawSummaryTable(doc, remaining, inOut, brandKey, startY) {
  const visibleBrands = brandKey ? BRANDS.filter((b) => b.key === brandKey) : BRANDS;
  const brandHead = visibleBrands.map((b) => b.label);

  const head = [['Metric', ...brandHead, 'Total bags', 'Amount']];
  const brandStart = visibleBrands.map((b) => formatBags(remaining.byBrandStart?.[b.key] || 0));
  const brandEnd = visibleBrands.map((b) => formatBags(remaining.byBrandEnd?.[b.key] || 0));

  const body = [
    [
      'Remaining from last month',
      ...brandStart,
      formatBags(remaining.remainingStart),
      '—',
    ],
    [
      'Remaining at month end',
      ...brandEnd,
      formatBags(remaining.remainingEnd),
      '—',
    ],
    [
      'All bags in',
      ...visibleBrands.map(() => '—'),
      formatBags(inOut.bagsIn),
      moneyCell(inOut.bagsInAmount),
    ],
    [
      'All bags distributed',
      ...visibleBrands.map(() => '—'),
      formatBags(inOut.bagsOut),
      moneyCell(inOut.bagsOutAmount),
    ],
  ];

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const brandW = Math.min(22, (pageW - 90) / Math.max(visibleBrands.length, 1));

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    startY,
    tableWidth: pageW,
    columnStyles: {
      0: { cellWidth: 48 },
      ...Object.fromEntries(visibleBrands.map((_, i) => [i + 1, { halign: 'right', cellWidth: brandW }])),
      [1 + visibleBrands.length]: { halign: 'right', cellWidth: 22 },
      [2 + visibleBrands.length]: { halign: 'right', cellWidth: 32 },
    },
  });
}

function buildDistributionBody(groups) {
  const body = [];
  const subtotalRowIndices = new Set();

  for (const g of groups) {
    for (const r of g.rows) {
      body.push([
        r.stockId || '—',
        String(r.date ?? ''),
        String(r.shop ?? ''),
        String(r.bagType ?? ''),
        formatBags(r.bags),
        r.perBagPrice != null ? moneyCell(r.perBagPrice) : '—',
        moneyCell(r.totalAmount),
      ]);
    }
    subtotalRowIndices.add(body.length);
    const purchaseNote = g.purchaseDate ? ` · purchased ${g.purchaseDate}` : '';
    body.push([
      `Stock ${g.stockId} total${purchaseNote}`,
      '',
      '',
      '',
      formatBags(g.bags),
      '',
      moneyCell(g.totalAmount),
    ]);
  }

  return { body, subtotalRowIndices };
}

function drawDistributionTable(doc, groups, tableTotals, startY) {
  const head = [
    ['StockID', 'Date', 'Shop name', 'Bag type', 'Amount', 'Per bag price', 'Total amount'],
  ];
  const { body, subtotalRowIndices } = buildDistributionBody(groups);

  const tableBody =
    body.length === 0
      ? [['—', '—', '—', '—', '0', '—', moneyCell(0)]]
      : body;

  const foot =
    body.length === 0
      ? null
      : [
          [
            'Grand total',
            '',
            '',
            '',
            formatBags(tableTotals.bags),
            '',
            moneyCell(tableTotals.totalAmount),
          ],
        ];

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body: tableBody,
    foot,
    startY,
    tableWidth: pageW,
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 22 },
      2: { cellWidth: 38 },
      3: { cellWidth: 22 },
      4: { halign: 'right', cellWidth: 18 },
      5: { halign: 'right', cellWidth: 28 },
      6: { halign: 'right', cellWidth: pageW - 22 - 22 - 38 - 22 - 18 - 28 },
    },
    didParseCell(data) {
      if (data.section !== 'body' || !subtotalRowIndices.has(data.row.index)) return;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = [241, 245, 249];
      data.cell.styles.textColor = [15, 23, 42];
      if (data.column.index === 6) {
        data.cell.styles.textColor = [67, 56, 202];
      }
    },
  });
}

/**
 * Monthly stock distribution PDF: remaining bags, in/out totals, shop rows grouped by stock.
 */
export function downloadStockDistributionPdf(data, options = {}) {
  const {
    monthLabel = '',
    brandLabel = 'All brands',
    brandKey = '',
    monthPurchasesOnly = false,
    remaining = {
      remainingStart: 0,
      remainingEnd: 0,
      byBrandStart: {},
      byBrandEnd: {},
    },
    inOut = { bagsIn: 0, bagsInAmount: 0, bagsOut: 0, bagsOutAmount: 0 },
    groups = [],
    tableTotals = { bags: 0, totalAmount: 0 },
    generatedAt = new Date(),
  } = data;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Stock Distribution per Month', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(`Month: ${monthLabel}`, MARGIN, 27);
  doc.text(`Brand: ${brandLabel}`, MARGIN, 32);
  doc.text(
    monthPurchasesOnly
      ? 'Filter: stocks purchased this month only. Distributions matched to those loads (FIFO).'
      : 'Shop distributions matched to stock loads (FIFO). Subtotals after each stock.',
    MARGIN,
    37,
  );
  doc.setTextColor(0, 0, 0);

  let y = drawSectionTitle(
    doc,
    '1. Month summary',
    monthPurchasesOnly
      ? 'Remaining for this month’s purchases only (start = 0), bags in, and bags distributed'
      : 'Remaining bags by brand, bags in, and bags distributed',
    44,
  );
  drawSummaryTable(doc, remaining, inOut, brandKey, y);

  y = drawSectionTitle(
    doc,
    '2. Load distribution by shop',
    'StockID, date, shop, bag type, bags, per-bag price, total — separated by stock',
    nextY(doc, 10),
  );
  drawDistributionTable(doc, groups, tableTotals, y);

  addPageFooters(doc);

  const { monthSlug = 'month', brandSlug = 'all' } = options;
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`stock-distribution-${monthSlug}-${brandSlug}-${safeDate}.pdf`);
}
