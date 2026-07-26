import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

/**
 * Monthly bills PDF: date, shop, bag type, bags, amount, settled date, days to settle.
 */
export function downloadMonthlyBillsPdf(data, options = {}) {
  const {
    monthLabel = '',
    rows = [],
    totals = { bagCount: 0, amount: 0 },
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
  doc.text('Bills by Month', MARGIN, 16);

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
    'Credit bills for the selected month. Settled date from payments (oldest bills first).',
    MARGIN,
    32,
  );
  doc.setTextColor(0, 0, 0);

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const head = [
    ['Date', 'Shop name', 'Bag type', 'Bag count', 'Amount', 'Bill settled date', 'Days to settle'],
  ];
  const body =
    rows.length === 0
      ? [['—', '—', '—', '0', moneyCell(0), '—', '—']]
      : rows.map((r) => [
          r.date || '—',
          r.shop || '—',
          r.bagType || '—',
          formatBags(r.bagCount),
          moneyCell(r.amount),
          r.settledDate || '—',
          r.daysToSettle != null ? String(r.daysToSettle) : '—',
        ]);

  const foot =
    rows.length === 0
      ? null
      : [
          [
            `Total (${rows.length} line${rows.length === 1 ? '' : 's'})`,
            '',
            '',
            formatBags(totals.bagCount),
            moneyCell(totals.amount),
            '',
            '',
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot: foot || undefined,
    startY: 38,
    tableWidth: pageW,
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 48 },
      2: { cellWidth: 28 },
      3: { halign: 'right', cellWidth: 26 },
      4: { halign: 'right', cellWidth: 36 },
      5: { cellWidth: 36 },
      6: { halign: 'right', cellWidth: pageW - 28 - 48 - 28 - 26 - 36 - 36 },
    },
  });

  addPageFooters(doc);

  const { monthSlug = 'month' } = options;
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`bills-by-month-${monthSlug}-${safeDate}.pdf`);
}
