import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const MARGIN = 12;

const TABLE_OPTS = {
  styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', valign: 'middle' },
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
};

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function percentLabel(value) {
  return value == null ? '—' : `${value}%`;
}

function dateCell(ymd) {
  const d = String(ymd ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '—';
}

function overdueLabel(row) {
  if (!row?.overdue) return 'No';
  const days = Number(row.daysOverdue) || 0;
  return days > 0 ? `Yes · ${days}d` : 'Yes';
}

function addPageFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4`, MARGIN, pageHeight - 7);
    doc.setTextColor(0, 0, 0);
  }
}

function ensureSpace(doc, y, needed) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed <= pageHeight - 14) return y;
  doc.addPage();
  return 16;
}

/**
 * Download the month-end balances report for every customer.
 * @param {ReturnType<import('./monthEndBalances').buildMonthEndBalances>} report
 * @param {{ shopName?: string, generatedAt?: Date }} [options]
 */
export function downloadMonthEndBalancesPdf(report, options = {}) {
  const { shopName = '', generatedAt = new Date() } = options;
  const shops = Array.isArray(report?.shops) ? report.shops : [];
  const totals = report?.totals || {};
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const tableW = pageW - MARGIN * 2;
  const title = String(shopName || '').trim() || 'Month end balances';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(title, MARGIN, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const generated = generatedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  doc.text(
    `Month end balances · ${report?.monthLabel || report?.month || '—'} · As of ${dateCell(report?.asOf)} · Generated ${generated}`,
    MARGIN,
    20,
  );
  const note = doc.splitTextToSize(
    'Settled bills are unloads dated in this month that are fully paid, with days from the bill date to the settled date. Pending bills include every open balance, and overdue bills are marked. Customer success averages those bills. A bill scores 100% when the days used are within the customer credit days; after that the score is 100 × credit days ÷ days used.',
    tableW,
  );
  doc.text(note, MARGIN, 26);
  doc.setTextColor(0, 0, 0);

  const summaryHead = [[
    'Shop name',
    'Credit days',
    'Settled bills',
    'Settled amount',
    'Pending bills',
    'Pending amount',
    'Overdue amount',
    'Customer success',
  ]];
  const summaryBody = shops.length
    ? shops.map((shop) => [
        shop.shopName,
        String(shop.creditDays),
        String(shop.settled.length),
        formatLkr(shop.settledAmount),
        String(shop.pending.length),
        formatLkr(shop.pendingAmount),
        formatLkr(shop.overdueAmount),
        percentLabel(shop.successPercent),
      ])
    : [['No settled unloads or pending balances', '—', '0', '0.00', '0', '0.00', '0.00', '—']];
  const summaryFoot = [[
    `Total (${shops.length} shop${shops.length === 1 ? '' : 's'})`,
    '',
    String(totals.settledCount || 0),
    formatLkr(totals.settledAmount),
    String(totals.pendingCount || 0),
    formatLkr(totals.pendingAmount),
    formatLkr(totals.overdueAmount),
    percentLabel(totals.successPercent),
  ]];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: summaryHead,
    body: summaryBody,
    foot: summaryFoot,
    startY: 26 + note.length * 4 + 3,
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 14 },
    tableWidth: tableW,
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
  });

  let cursorY = doc.lastAutoTable.finalY + 8;

  shops.forEach((shop) => {
    cursorY = ensureSpace(doc, cursorY, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(shop.shopName, MARGIN, cursorY);
    cursorY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const place = shop.location ? ` · ${shop.location}` : '';
    doc.text(
      `Customer success ${percentLabel(shop.successPercent)} · Credit days ${shop.creditDays}${place}`,
      MARGIN,
      cursorY,
    );
    doc.setTextColor(15, 23, 42);
    cursorY += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Settled bills', MARGIN, cursorY);
    cursorY += 2;

    const settledBody = shop.settled.length
      ? shop.settled.map((row) => [
          dateCell(row.billDate),
          row.details || '—',
          formatLkr(row.amount),
          dateCell(row.settledDate),
          row.daysToSettle == null ? '—' : String(row.daysToSettle),
        ])
      : [['—', 'No settled unloads this month', '—', '—', '—']];

    autoTable(doc, {
      ...TABLE_OPTS,
      head: [['Bill date', 'Details', 'Amount (LKR)', 'Settled date', 'Days to settle']],
      body: settledBody,
      foot: shop.settled.length
        ? [[
            `Total (${shop.settled.length})`,
            '',
            formatLkr(shop.settledAmount),
            '',
            '',
          ]]
        : undefined,
      startY: cursorY,
      margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 14 },
      tableWidth: tableW,
      columnStyles: {
        0: { cellWidth: 28 },
        2: { halign: 'right', cellWidth: 36 },
        3: { cellWidth: 30 },
        4: { halign: 'right', cellWidth: 32 },
      },
    });

    cursorY = ensureSpace(doc, doc.lastAutoTable.finalY + 7, 24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Pending bills', MARGIN, cursorY);
    cursorY += 2;

    const overdueIndexes = new Set();
    const pendingBody = shop.pending.length
      ? shop.pending.map((row, index) => {
          if (row.overdue) overdueIndexes.add(index);
          return [
            dateCell(row.billDate),
            row.details || '—',
            row.daysFromBillDate == null ? '—' : String(row.daysFromBillDate),
            formatLkr(row.settledAmount),
            formatLkr(row.balance),
            overdueLabel(row),
          ];
        })
      : [['—', 'No pending balance', '—', '—', '—', '—']];

    autoTable(doc, {
      ...TABLE_OPTS,
      head: [[
        'Bill date',
        'Details',
        'Days from billing date',
        'Settled amount (LKR)',
        'Balance (LKR)',
        'Overdue',
      ]],
      body: pendingBody,
      foot: shop.pending.length
        ? [[
            `Total (${shop.pending.length})`,
            '',
            '',
            formatLkr(shop.pending.reduce((sum, row) => sum + row.settledAmount, 0)),
            formatLkr(shop.pendingAmount),
            '',
          ]]
        : undefined,
      startY: cursorY,
      margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 14 },
      tableWidth: tableW,
      columnStyles: {
        0: { cellWidth: 28 },
        2: { halign: 'right', cellWidth: 36 },
        3: { halign: 'right', cellWidth: 40 },
        4: { halign: 'right', cellWidth: 34 },
        5: { cellWidth: 28 },
      },
      didParseCell(data) {
        if (data.section !== 'body' || !overdueIndexes.has(data.row.index)) return;
        data.cell.styles.fillColor = [255, 241, 242];
        if (data.column.index === 5) {
          data.cell.styles.textColor = [159, 18, 57];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    cursorY = doc.lastAutoTable.finalY + 10;
  });

  addPageFooters(doc);
  const monthSlug = String(report?.month || 'month').replace(/[^\d-]/g, '') || 'month';
  doc.save(`month-end-balances-${monthSlug}.pdf`);
}
