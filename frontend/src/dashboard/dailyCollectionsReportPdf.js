import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

function nextY(doc, gap = 8) {
  const last = doc.lastAutoTable?.finalY;
  return (last != null ? last : 30) + gap;
}

/**
 * Daily collections report PDF: summary, by shop, cheque list.
 */
export function downloadDailyCollectionsReportPdf(data, options = {}) {
  const {
    reportDate = '',
    totals = {},
    shopRows = [],
    chequeRows = [],
    chequeTotal = 0,
    generatedAt = new Date(),
  } = data;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Daily Collections Report', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(`Report date: ${reportDate || '—'}`, MARGIN, 27);
  doc.text('Collections and cheques by payment date.', MARGIN, 32);
  doc.setTextColor(0, 0, 0);

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;

  autoTable(doc, {
    ...TABLE_OPTS,
    head: [['Summary', 'Amount']],
    body: [
      ['Collections (cash + cheque)', moneyCell(totals.collections)],
      ['Cash', moneyCell(totals.cash)],
      ['Cheque', moneyCell(totals.cheque)],
    ],
    startY: 38,
    tableWidth: pageW,
    columnStyles: {
      0: { cellWidth: pageW * 0.55 },
      1: { halign: 'right', cellWidth: pageW * 0.45 },
    },
  });

  let y = nextY(doc, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('By shop', MARGIN, y);
  y += 4;

  const shopHead = [['Shop', 'Location', 'Cash', 'Cheque', 'Collections']];
  const shopBody =
    shopRows.length === 0
      ? [['—', '—', moneyCell(0), moneyCell(0), moneyCell(0)]]
      : shopRows.map((r) => [
          r.shop || '—',
          r.location || '—',
          moneyCell(r.cashCollected),
          moneyCell(r.chequeCollected),
          moneyCell(r.cashIn),
        ]);

  const shopFoot =
    shopRows.length === 0
      ? null
      : [
          [
            `Total (${shopRows.length} shop${shopRows.length === 1 ? '' : 's'})`,
            '',
            moneyCell(totals.cash),
            moneyCell(totals.cheque),
            moneyCell(totals.collections),
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: shopHead,
    body: shopBody,
    foot: shopFoot || undefined,
    startY: y + 2,
    tableWidth: pageW,
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
  });

  y = nextY(doc, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Cheque list', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Cheques on payments dated ${reportDate || '—'}.`, MARGIN, y + 4);
  doc.setTextColor(0, 0, 0);

  const chequeHead = [['Shop', 'Cheque date', 'Amount', 'Cheque #', 'Bill #', 'Deposited']];
  const chequeBody =
    chequeRows.length === 0
      ? [['—', '—', moneyCell(0), '—', '—', '—']]
      : chequeRows.map((r) => [
          r.customerName || '—',
          r.chequeDate || '—',
          moneyCell(r.amount),
          r.chequeNumber || '—',
          r.billNumber || '—',
          r.chequeDeposited ? 'Yes' : 'Pending',
        ]);

  const chequeFoot =
    chequeRows.length === 0
      ? null
      : [
          [
            `Total (${chequeRows.length} cheque${chequeRows.length === 1 ? '' : 's'})`,
            '',
            moneyCell(chequeTotal),
            '',
            '',
            '',
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: chequeHead,
    body: chequeBody,
    foot: chequeFoot || undefined,
    startY: y + 8,
    tableWidth: pageW,
    columnStyles: {
      2: { halign: 'right' },
    },
  });

  addPageFooters(doc);

  const { dateSlug = reportDate || 'day' } = options;
  const safeGenerated = generatedAt.toISOString().slice(0, 10);
  doc.save(`daily-collections-${dateSlug}-${safeGenerated}.pdf`);
}
