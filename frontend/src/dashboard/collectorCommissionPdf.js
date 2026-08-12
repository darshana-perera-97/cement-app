import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { COLLECTION_DAY_BUCKETS } from './collectionsReport';

const MARGIN = 14;

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function moneyCell(n) {
  return `LKR ${formatLkr(n)}`;
}

const TABLE_OPTS = {
  styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak', valign: 'middle' },
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

export function downloadCollectorCommissionPdf(data, options = {}) {
  const {
    collectorName = '—',
    periodLabel = '',
    rows = [],
    bucketSummary = {},
    commissionRates = {},
    totals = { collectionAmount: 0, commissionAmount: 0 },
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
  doc.text('Collector Commission', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(`Collector: ${collectorName}`, MARGIN, 27);
  doc.text(`Period: ${periodLabel}`, MARGIN, 32);
  doc.setTextColor(0, 0, 0);

  const rateHead = ['Days to settle', 'Commission %', 'Collection amount', 'Commission amount'];
  const rateBody = COLLECTION_DAY_BUCKETS.map((b) => {
    const summary = bucketSummary[b.key] || {};
    const pct = Number(commissionRates[b.key]) || 0;
    return [
      b.label,
      `${pct.toFixed(2)}%`,
      moneyCell(summary.collectionAmount || 0),
      moneyCell(summary.commissionAmount || 0),
    ];
  });

  autoTable(doc, {
    startY: 38,
    head: [rateHead],
    body: rateBody,
    ...TABLE_OPTS,
    columnStyles: {
      0: { cellWidth: 42 },
      1: { halign: 'right', cellWidth: 28 },
      2: { halign: 'right', cellWidth: 38 },
      3: { halign: 'right', cellWidth: 38 },
    },
  });

  let startY = doc.lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Settled collections detail', MARGIN, startY);
  startY += 4;

  const detailHead = [
    'Date',
    'Invoice #',
    'Shop',
    'Bag type',
    'Amount',
    'Bill date',
    'Settled',
    'Days',
    'Bill amount',
    'Comm. %',
    'Commission',
  ];
  const detailBody =
    rows.length === 0
      ? [['—', '—', '—', '—', moneyCell(0), '—', '—', '—', moneyCell(0), '—', moneyCell(0)]]
      : rows.map((r) => [
          r.date || '—',
          r.invoiceNumber || '—',
          r.shopName || '—',
          r.bagType || '—',
          moneyCell(r.amount),
          r.billDate || '—',
          r.settledDate || '—',
          r.daysToSettle != null ? String(r.daysToSettle) : '—',
          moneyCell(r.billAmount),
          r.commissionPercent != null ? `${Number(r.commissionPercent).toFixed(2)}%` : '—',
          moneyCell(r.commissionAmount),
        ]);

  const foot =
    rows.length === 0
      ? null
      : [
          [
            `Total (${rows.length} line${rows.length === 1 ? '' : 's'})`,
            '',
            '',
            '',
            moneyCell(totals.collectionAmount),
            '',
            '',
            '',
            '',
            '',
            moneyCell(totals.commissionAmount),
          ],
        ];

  autoTable(doc, {
    startY,
    head: [detailHead],
    body: detailBody,
    foot,
    ...TABLE_OPTS,
    columnStyles: {
      4: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
    },
  });

  addPageFooters(doc);
  const safeName = String(collectorName).replace(/[^\w\-]+/g, '-').slice(0, 40) || 'collector';
  doc.save(`collector-commission-${safeName}-${periodLabel.replace(/\s+/g, '-')}.pdf`);
}

export function downloadCollectionsReportPdf(data) {
  const {
    periodLabel = '',
    collectorName = 'All collectors',
    rows = [],
    bucketSummary = {},
    totals = { amount: 0 },
    generatedAt = new Date(),
  } = data;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Settled Collections Report', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Generated: ${generatedAt.toLocaleString()}`, MARGIN, 22);
  doc.text(`Period: ${periodLabel}`, MARGIN, 27);
  doc.text(`Collector: ${collectorName}`, MARGIN, 32);
  doc.setTextColor(0, 0, 0);

  const summaryHead = ['Days to settle', 'Lines', 'Collection amount'];
  const summaryBody = COLLECTION_DAY_BUCKETS.map((b) => {
    const s = bucketSummary[b.key] || {};
    return [b.label, String(s.lineCount || 0), moneyCell(s.amount || 0)];
  });

  autoTable(doc, {
    startY: 38,
    head: [summaryHead],
    body: summaryBody,
    ...TABLE_OPTS,
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
  });

  let startY = doc.lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Detail', MARGIN, startY);
  startY += 4;

  const head = [
    'Date',
    'Invoice #',
    'Shop',
    'Bag type',
    'Amount',
    'Bill date',
    'Settled',
    'Days',
    'Bill amount',
  ];
  const body =
    rows.length === 0
      ? [['—', '—', '—', '—', moneyCell(0), '—', '—', '—', moneyCell(0)]]
      : rows.map((r) => [
          r.date,
          r.invoiceNumber,
          r.shopName,
          r.bagType,
          moneyCell(r.amount),
          r.billDate,
          r.settledDate,
          String(r.daysToSettle ?? '—'),
          moneyCell(r.billAmount),
        ]);

  autoTable(doc, {
    startY,
    head: [head],
    body,
    foot: rows.length
      ? [[`Total (${rows.length})`, '', '', '', moneyCell(totals.amount), '', '', '', '']]
      : undefined,
    ...TABLE_OPTS,
    columnStyles: {
      4: { halign: 'right' },
      8: { halign: 'right' },
    },
  });

  addPageFooters(doc);
  doc.save(`settled-collections-${periodLabel.replace(/\s+/g, '-')}.pdf`);
}
