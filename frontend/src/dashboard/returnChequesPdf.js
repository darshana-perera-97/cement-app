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

function displayFilter(value, fallback = 'All') {
  const s = String(value ?? '').trim();
  return s || fallback;
}

function settlementFilterLabel(value) {
  if (value === 'settled') return 'Settled only';
  if (value === 'unsettled') return 'Not settled only';
  return 'All (settled & not settled)';
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

/**
 * Download the filtered return-cheques table as an A4 landscape PDF.
 */
export function downloadReturnChequesPdf(data = {}) {
  const {
    rows = [],
    filters = {},
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
  doc.text('Return cheques', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.setTextColor(0, 0, 0);

  const filterBody = [
    ['Shop', displayFilter(filters.shop)],
    ['Settlement', settlementFilterLabel(filters.settlement)],
    ['From date', displayFilter(filters.dateFrom)],
    ['To date', displayFilter(filters.dateTo)],
    ['Search', displayFilter(filters.search, 'None')],
  ];

  autoTable(doc, {
    startY: 26,
    head: [['Filter', 'Value']],
    body: filterBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, valign: 'middle' },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold', textColor: [71, 85, 105] },
      1: { cellWidth: 80 },
    },
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: 112,
  });

  const tableStartY = (doc.lastAutoTable?.finalY || 46) + 6;
  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalOutstanding = rows.reduce((s, r) => s + (Number(r.outstandingAmount) || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + (Number(r.paidAmount) || 0), 0);

  const body =
    rows.length === 0
      ? [['—', 'No return cheques match the current filters', '—', '—', '—', '—', '—', '—', '—']]
      : rows.map((r) => [
          String(r.returnDate || '—'),
          String(r.customerName || '—'),
          r.chequeNumber ? `#${r.chequeNumber}` : '—',
          String(r.chequeBank || '—'),
          String(r.chequeDate || '—'),
          String(r.receiptNumber || '—'),
          moneyCell(r.amount),
          moneyCell(r.outstandingAmount),
          r.settled ? (r.settledDate ? `Settled ${r.settledDate}` : 'Settled') : 'Not settled',
        ]);

  autoTable(doc, {
    startY: tableStartY,
    head: [
      [
        'Return date',
        'Shop',
        'Cheque #',
        'Bank',
        'Cheque date',
        'Receipt',
        'Amount',
        'Outstanding',
        'Status',
      ],
    ],
    body,
    foot:
      rows.length === 0
        ? undefined
        : [
            [
              'Total',
              `${rows.length} cheque${rows.length === 1 ? '' : 's'}`,
              '',
              '',
              '',
              '',
              moneyCell(totalAmount),
              moneyCell(totalOutstanding),
              `Paid ${moneyCell(totalPaid)}`,
            ],
          ],
    styles: { fontSize: 7.5, cellPadding: 1.5, overflow: 'linebreak', valign: 'middle' },
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
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 42 },
      2: { cellWidth: 24, font: 'courier', fontSize: 7 },
      3: { cellWidth: 28 },
      4: { cellWidth: 24 },
      5: { cellWidth: 22 },
      6: { cellWidth: 30, halign: 'right' },
      7: { cellWidth: 30, halign: 'right' },
      8: { cellWidth: 32 },
    },
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
  });

  addPageFooters(doc);
  const stamp = generatedAt.toISOString().slice(0, 10);
  const scope =
    filters.settlement === 'settled'
      ? 'settled'
      : filters.settlement === 'unsettled'
        ? 'not-settled'
        : 'all';
  doc.save(`return-cheques-${scope}-${stamp}.pdf`);
}
