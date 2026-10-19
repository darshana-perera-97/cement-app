import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const MARGIN = 14;

const SCOPE_LABELS = {
  remaining: 'All remaining',
  overdue: 'Overdue',
  within: 'Within terms',
};

const PDF_HEAD = [['Bill date', 'Details', 'Due date', 'Bill total (LKR)', 'Remaining (LKR)', 'Status']];

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function safeFilePart(name) {
  return (
    String(name || 'customer')
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 48) || 'customer'
  );
}

function dateCell(ymd) {
  const d = String(ymd ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '—';
}

function scopeLabel(scope) {
  return SCOPE_LABELS[scope] || SCOPE_LABELS.remaining;
}

function billDateLabel(row) {
  if (row?.isReturnCheque) {
    return `Return ${row.invoiceNumber || ''}`.trim();
  }
  const date = dateCell(row?.billDate);
  if (row?.isOpeningBalance) return `${date} (Opening)`;
  return date;
}

function statusLabel(row) {
  if (Number(row?.daysOverdue) > 0) return `${row.daysOverdue}d overdue`;
  const daysLeft = Number(row?.daysLeftUntilDue);
  if (daysLeft > 0) return `${daysLeft}d left`;
  return 'Due today';
}

function isOverdueRow(row) {
  return Number(row?.daysOverdue) > 0;
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
 * Download the pending bills shown for one customer (current tab).
 * @param {object} customer
 * @param {Array} rows
 * @param {{ scope?: 'remaining' | 'overdue' | 'within', generatedAt?: Date }} options
 */
export function downloadCustomerPendingBillsPdf(customer, rows, options = {}) {
  const { scope = 'remaining', generatedAt = new Date() } = options;
  const list = Array.isArray(rows) ? rows : [];
  const customerName = String(customer?.name ?? '').trim() || 'Customer';
  const label = scopeLabel(scope);
  const remainingTotal = list.reduce((sum, row) => sum + (Number(row.outstandingAmount) || 0), 0);
  const billTotal = list.reduce((sum, row) => sum + (Number(row.billTotal) || 0), 0);
  const overdueIndices = new Set();

  const body = list.map((row, index) => {
    if (isOverdueRow(row)) overdueIndices.add(index);
    return [
      billDateLabel(row),
      String(row.details ?? '')
        .replace(/\s+/g, ' ')
        .trim() || '—',
      dateCell(row.dueDate),
      formatLkr(row.billTotal),
      formatLkr(row.outstandingAmount),
      statusLabel(row),
    ];
  });

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const tableW = pageW - MARGIN * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(`Pending bills — ${customerName}`, MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);

  let metaY = 22;
  const location = String(customer?.location ?? '').trim();
  const contact = String(customer?.contactNumber ?? '').trim();
  const metaParts = [location, contact].filter(Boolean);
  if (metaParts.length > 0) {
    const metaLines = doc.splitTextToSize(metaParts.join(' · '), tableW);
    doc.text(metaLines, MARGIN, metaY);
    metaY += metaLines.length * 4 + 1;
  }

  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, metaY);
  metaY += 5;
  doc.text(
    `${label} · ${list.length} bill${list.length === 1 ? '' : 's'} · Remaining ${formatLkr(remainingTotal)} LKR`,
    MARGIN,
    metaY,
  );
  metaY += 5;
  const settlementDays = customer?.overdueDays ?? 14;
  const note = doc.splitTextToSize(
    `Unpaid return cheques, opening balance, and credit bills. Invoices are due within ${settlementDays} day${settlementDays === 1 ? '' : 's'}.`,
    tableW,
  );
  doc.text(note, MARGIN, metaY);
  doc.setTextColor(0, 0, 0);

  const tableStartY = metaY + note.length * 4 + 4;
  const footLabel =
    scope === 'overdue' ? 'Total overdue' : scope === 'within' ? 'Total within terms' : 'Total remaining';
  const foot = [
    ['', '', footLabel, formatLkr(billTotal), formatLkr(remainingTotal), `${list.length} bill${list.length === 1 ? '' : 's'}`],
  ];

  autoTable(doc, {
    head: PDF_HEAD,
    body: body.length > 0 ? body : [['—', 'No pending bills', '—', '0.00', '0.00', '—']],
    foot,
    startY: tableStartY,
    margin: { top: tableStartY, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', valign: 'middle' },
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
      1: { cellWidth: 54 },
      2: { cellWidth: 24 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 28 },
      5: { cellWidth: tableW - 28 - 54 - 24 - 28 - 28 },
    },
    tableWidth: tableW,
    showHead: 'everyPage',
    didParseCell(data) {
      if (data.section !== 'body' || !overdueIndices.has(data.row.index)) return;
      data.cell.styles.fillColor = [255, 241, 242];
      if (data.column.index === 5) {
        data.cell.styles.textColor = [159, 18, 57];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  addPageFooters(doc);

  const stamp = generatedAt.toISOString().slice(0, 10);
  const scopePart = scope === 'remaining' ? 'all' : scope;
  doc.save(`pending-bills-${safeFilePart(customerName)}-${scopePart}-${stamp}.pdf`);
}
