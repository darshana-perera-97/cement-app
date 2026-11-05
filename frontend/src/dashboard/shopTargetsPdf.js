import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatReportItemLabel } from './brandTheme';

const MARGIN = 14;

function formatBags(n) {
  return (Number(n) || 0).toLocaleString();
}

function formatPct(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return '—';
  return `${Number(pct)}%`;
}

function formatBrandCell(n) {
  const v = Number(n) || 0;
  return v > 0 ? formatBags(v) : '—';
}

const TABLE_OPTS = {
  styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
  headStyles: {
    fillColor: [71, 85, 105],
    textColor: 255,
    fontStyle: 'bold',
    halign: 'center',
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

function itemLabel(brand) {
  return formatReportItemLabel(brand) || brand.label || brand.key;
}

function buildHead(soldBrands, freeBrands) {
  return [
    [
      'Shop name',
      ...soldBrands.map((b) => `${itemLabel(b)} bags`),
      'Total bags',
      ...freeBrands.map((b) => `${itemLabel(b)} free`),
      'Total free bags',
      'Monthly target',
      'Completed',
    ],
  ];
}

function buildBody(rows, soldBrands, freeBrands) {
  if (rows.length === 0) {
    return [['—', ...soldBrands.map(() => '—'), '0', ...freeBrands.map(() => '—'), '0', '—', '—']];
  }
  return rows.map((r) => [
    r.shop || '—',
    ...soldBrands.map((b) => formatBrandCell(r.byBrand?.[b.key])),
    formatBags(r.total),
    ...freeBrands.map((b) => formatBrandCell(r.freeByBrand?.[b.key])),
    formatBags(r.freeBags),
    r.monthlyTargetBags > 0 ? formatBags(r.monthlyTargetBags) : '—',
    formatPct(r.progressPct),
  ]);
}

function buildFoot(rows, totals, overallProgressPct, soldBrands, freeBrands) {
  if (rows.length === 0) return null;
  return [
    [
      `Total (${rows.length} shop${rows.length === 1 ? '' : 's'})`,
      ...soldBrands.map((b) => formatBags(totals.byBrand?.[b.key] || 0)),
      formatBags(totals.total),
      ...freeBrands.map((b) => formatBags(totals.freeByBrand?.[b.key] || 0)),
      formatBags(totals.freeBags),
      totals.monthlyTargetBags > 0 ? formatBags(totals.monthlyTargetBags) : '—',
      formatPct(overallProgressPct),
    ],
  ];
}

/**
 * Shop targets PDF: bags sold per item, free bags per item, and monthly target for each shop.
 * Item columns with no sales, and free-bag columns with no free bags, are omitted.
 */
export function downloadShopTargetsPdf(data, options = {}) {
  const {
    monthLabel = '',
    rows = [],
    totals = { byBrand: {}, freeByBrand: {}, total: 0, freeBags: 0, monthlyTargetBags: 0 },
    overallProgressPct = null,
    soldBrands = [],
    freeBrands = [],
    generatedAt = new Date(),
  } = data;
  const { monthSlug = '' } = options;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Shop Targets', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(`Month: ${monthLabel}`, MARGIN, 27);
  doc.text(
    'Sales columns appear only for items someone bought. Free bags are shown per item, plus the total.',
    MARGIN,
    32,
  );
  doc.setTextColor(0, 0, 0);

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const soldCount = soldBrands.length;
  const freeCount = freeBrands.length;
  const totalBagsCol = soldCount + 1;
  const totalFreeCol = soldCount + freeCount + 2;
  const lastNumericCol = soldCount + freeCount + 4;
  const head = buildHead(soldBrands, freeBrands);
  const body = buildBody(rows, soldBrands, freeBrands);
  const foot = buildFoot(rows, totals, overallProgressPct, soldBrands, freeBrands);

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY: 38,
    tableWidth: pageW,
    columnStyles: {
      0: { halign: 'left', cellWidth: 42 },
      [totalBagsCol]: { halign: 'right', fontStyle: 'bold' },
      [totalFreeCol]: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (hookData) => {
      if (hookData.section === 'head') return;
      const col = hookData.column.index;
      if (col >= 1 && col <= lastNumericCol) {
        hookData.cell.styles.halign = 'right';
      }
    },
  });

  addPageFooters(doc);

  const slug = monthSlug || generatedAt.toISOString().slice(0, 7);
  doc.save(`shop-targets-${slug}.pdf`);
}
