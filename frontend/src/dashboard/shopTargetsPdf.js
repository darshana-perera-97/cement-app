import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BRANDS } from './brandTheme';

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

function buildHead() {
  return [
    [
      'Shop name',
      ...BRANDS.map((b) => `${b.label} bags`),
      'Total bags',
      'Monthly target',
      'Completed',
    ],
  ];
}

function buildBody(rows) {
  if (rows.length === 0) {
    return [['—', ...BRANDS.map(() => '—'), '0', '—', '—']];
  }
  return rows.map((r) => [
    r.shop || '—',
    ...BRANDS.map((b) => formatBrandCell(r.byBrand?.[b.key])),
    formatBags(r.total),
    r.monthlyTargetBags > 0 ? formatBags(r.monthlyTargetBags) : '—',
    formatPct(r.progressPct),
  ]);
}

function buildFoot(rows, totals, overallProgressPct) {
  if (rows.length === 0) return null;
  return [
    [
      `Total (${rows.length} shop${rows.length === 1 ? '' : 's'})`,
      ...BRANDS.map((b) => formatBags(totals.byBrand?.[b.key] || 0)),
      formatBags(totals.total),
      totals.monthlyTargetBags > 0 ? formatBags(totals.monthlyTargetBags) : '—',
      formatPct(overallProgressPct),
    ],
  ];
}

/**
 * Shop targets PDF: bags sold per brand vs monthly target for each shop.
 */
export function downloadShopTargetsPdf(data, options = {}) {
  const {
    monthLabel = '',
    rows = [],
    totals = { byBrand: {}, total: 0, monthlyTargetBags: 0 },
    overallProgressPct = null,
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
    'Monthly bag sales by brand vs customer targets (from credit bills).',
    MARGIN,
    32,
  );
  doc.setTextColor(0, 0, 0);

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const brandColCount = BRANDS.length;
  const head = buildHead();
  const body = buildBody(rows);
  const foot = buildFoot(rows, totals, overallProgressPct);

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY: 38,
    tableWidth: pageW,
    columnStyles: {
      0: { halign: 'left', cellWidth: 42 },
      [brandColCount + 1]: { halign: 'right', fontStyle: 'bold' },
      [brandColCount + 2]: { halign: 'right' },
      [brandColCount + 3]: { halign: 'right' },
    },
    didParseCell: (hookData) => {
      if (hookData.section === 'head') return;
      const col = hookData.column.index;
      if (col >= 1 && col <= brandColCount + 3) {
        hookData.cell.styles.halign = 'right';
      }
    },
  });

  addPageFooters(doc);

  const slug = monthSlug || generatedAt.toISOString().slice(0, 7);
  doc.save(`shop-targets-${slug}.pdf`);
}
