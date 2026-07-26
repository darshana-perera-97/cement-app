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

function formatBags(n) {
  return (Number(n) || 0).toLocaleString();
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

function drawLoadsPurchased(doc, rows, startY) {
  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const head = [['Date', 'Vehicle', 'Cheque #', 'Invoice #', 'Bag type', 'Bags', 'Total cost']];
  const body =
    rows.length === 0
      ? [['—', '—', '—', '—', '—', '0', moneyCell(0)]]
      : rows.map((r) => [
          r.date,
          r.vehicle,
          r.chequeNumber,
          r.invoiceNumber,
          r.bagType,
          formatBags(r.bags),
          moneyCell(r.totalCost),
        ]);

  const grand = rows.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);
  const foot =
    rows.length === 0
      ? null
      : [['Grand total', '', '', '', '', '', moneyCell(grand)]];

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY,
    tableWidth: pageW,
    columnStyles: {
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
  });
}

function drawCashIn(doc, rows, startY) {
  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const head = [['Date', 'Shop', 'Bill #', 'Cash', 'Cheque', 'Total']];
  const body = [];
  for (const r of rows) {
    body.push([
      r.date,
      r.shop,
      r.billNumber,
      moneyCell(r.cashAmount),
      moneyCell(r.chequeAmount),
      moneyCell(r.total),
    ]);
    if (r.chequeDetails) {
      body.push([
        {
          content: `Cheques: ${r.chequeDetails}`,
          colSpan: 6,
          styles: { fontSize: 6.5, textColor: [100, 116, 139], fillColor: [248, 250, 252] },
        },
      ]);
    }
  }
  if (body.length === 0) {
    body.push(['—', '—', '—', moneyCell(0), moneyCell(0), moneyCell(0)]);
  }

  const totals = rows.reduce(
    (acc, r) => ({
      cash: acc.cash + (Number(r.cashAmount) || 0),
      cheque: acc.cheque + (Number(r.chequeAmount) || 0),
      total: acc.total + (Number(r.total) || 0),
    }),
    { cash: 0, cheque: 0, total: 0 },
  );
  const foot =
    rows.length === 0
      ? null
      : [['Grand total', '', '', moneyCell(totals.cash), moneyCell(totals.cheque), moneyCell(totals.total)]];

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY,
    tableWidth: pageW,
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  });
}

function drawConvertingCheques(doc, rows, startY) {
  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const head = [['Date', 'Cheque #', 'Issue date', 'Bill #', 'Customer', 'Amount']];
  const body =
    rows.length === 0
      ? [['—', '—', '—', '—', '—', moneyCell(0)]]
      : rows.map((r) => [
          r.date,
          r.chequeNumber,
          r.issueDate,
          r.billNumber,
          r.customer,
          moneyCell(r.amount),
        ]);

  const grand = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const foot =
    rows.length === 0 ? null : [['Grand total', '', '', '', '', moneyCell(grand)]];

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY,
    tableWidth: pageW,
    columnStyles: {
      5: { halign: 'right' },
    },
  });
}

/**
 * Financial summary PDF: loads purchased, cash in, cheques to convert.
 */
export function downloadFinancialSummaryPdf(data, options = {}) {
  const {
    periodLabel = '',
    loadRows = [],
    cashInRows = [],
    convertingRows = [],
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
  doc.text('Financial Summary', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(`Period: ${periodLabel}`, MARGIN, 27);
  doc.setTextColor(0, 0, 0);

  let y = drawSectionTitle(
    doc,
    '1. All loads purchased',
    'Stock loads in the period — one row per bag type',
    34,
  );
  drawLoadsPurchased(doc, loadRows, y);

  y = drawSectionTitle(
    doc,
    '2. Total cash in',
    'Cash and cheques received from shops',
    nextY(doc, 10),
  );
  drawCashIn(doc, cashInRows, y);

  y = drawSectionTitle(
    doc,
    '3. Cheques to be converted',
    'Shop cheques with issue date in the period',
    nextY(doc, 10),
  );
  drawConvertingCheques(doc, convertingRows, y);

  addPageFooters(doc);

  const { fileSlug = 'period' } = options;
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`financial-summary-${fileSlug}-${safeDate}.pdf`);
}
