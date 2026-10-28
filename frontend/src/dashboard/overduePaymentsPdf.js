import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const MARGIN = 14;

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function displayFilter(value, fallback = 'All') {
  const s = String(value ?? '').trim();
  return s || fallback;
}

function daysRangeLabel(from, to) {
  const min = String(from ?? '').trim();
  const max = String(to ?? '').trim();
  if (!min && !max) return 'Any';
  if (min && max) return `${min} to ${max}`;
  if (min) return `${min} or more`;
  return `${max} or less`;
}

function addPageFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4`, MARGIN, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }
}

/**
 * Download the filtered overdue payments list as an A4 landscape PDF.
 * @param {{ rows?: Array, filters?: object, generatedAt?: Date }} data
 */
export function downloadOverduePaymentsPdf(data = {}) {
  const { rows = [], filters = {}, generatedAt = new Date() } = data;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Overdue payments', MARGIN, 16);

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
    ['Settled from', displayFilter(filters.dateFrom)],
    ['Settled to', displayFilter(filters.dateTo)],
    ['Customer', displayFilter(filters.customer, 'All customers')],
    ['Overdue days', daysRangeLabel(filters.overdueDaysFrom, filters.overdueDaysTo)],
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
      1: { cellWidth: 90 },
    },
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: 122,
  });

  const tableStartY = (doc.lastAutoTable?.finalY || 52) + 6;
  const totalAmount = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const body =
    rows.length === 0
      ? [['—', 'No overdue payments match the current filters', '—', '—', '—', '—']]
      : rows.map((row) => [
          String(row.settledDate || '—'),
          String(row.customerName || '—'),
          String(row.description || '—').replace(/\s+/g, ' ').trim(),
          row.daysToSettle == null ? '—' : String(row.daysToSettle),
          row.daysPastCredit == null ? '—' : String(row.daysPastCredit),
          `LKR ${formatLkr(row.amount)}`,
        ]);

  autoTable(doc, {
    startY: tableStartY,
    head: [['Settled date', 'Customer', 'Description', 'Days to settle', 'Overdue days', 'Amount']],
    body,
    foot:
      rows.length === 0
        ? undefined
        : [['', '', '', '', 'Total', `LKR ${formatLkr(totalAmount)}`]],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', valign: 'top' },
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
      0: { cellWidth: 28 },
      1: { cellWidth: 48 },
      2: { cellWidth: 107 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 26 },
      5: { halign: 'right', cellWidth: 32 },
    },
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    showHead: 'everyPage',
  });

  addPageFooters(doc);
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`overdue-payments-${safeDate}.pdf`);
}
