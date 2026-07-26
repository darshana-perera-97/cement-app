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

function drawLoadsSummary(doc, loadsReport, visibleBrands, startY) {
  const head = [['Bag type', 'Bags']];
  const body = visibleBrands.map((b) => [b.label, formatBags(loadsReport.byBrand[b.key] || 0)]);
  body.push(['Total', formatBags(loadsReport.total)]);
  body.push(['Loads', String(loadsReport.loadCount)]);

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    startY,
    tableWidth: doc.internal.pageSize.getWidth() - MARGIN * 2,
    columnStyles: {
      0: { cellWidth: 50 },
      1: { halign: 'right', cellWidth: 40 },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index >= visibleBrands.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });
}

function drawBagsPerShop(doc, shopRows, visibleBrands, shopTotals, startY) {
  const brandCols = visibleBrands.map((b) => `${b.label} bags`);
  const head = [['Shop', 'Location', ...brandCols, 'Total bags', 'Bills']];
  const filtered = shopRows.filter((r) => r.totalBags > 0);

  const body =
    filtered.length === 0
      ? [['—', '—', ...brandCols.map(() => '0'), '0', '0']]
      : filtered.map((r) => [
          r.shop,
          r.location || '—',
          ...visibleBrands.map((b) => formatBags(r[`${b.key}Bags`])),
          formatBags(r.totalBags),
          String(r.billCount),
        ]);

  const foot =
    filtered.length === 0
      ? null
      : [
          [
            'Total',
            '',
            ...visibleBrands.map((b) =>
              formatBags(filtered.reduce((s, r) => s + (r[`${b.key}Bags`] || 0), 0)),
            ),
            formatBags(shopTotals.totalBags),
            String(filtered.reduce((s, r) => s + r.billCount, 0)),
          ],
        ];

  const colCount = 4 + visibleBrands.length;
  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const brandW = Math.min(18, (pageW - 90) / visibleBrands.length);

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY,
    tableWidth: pageW,
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 28 },
      ...Object.fromEntries(visibleBrands.map((_, i) => [i + 2, { halign: 'right', cellWidth: brandW }])),
      [colCount - 2]: { halign: 'right', cellWidth: 22 },
      [colCount - 1]: { halign: 'right', cellWidth: 14 },
    },
  });
}

function drawCreditSales(doc, shopRows, shopTotals, startY) {
  const head = [['Shop', 'Location', 'Bills', 'Credit sales']];
  const filtered = shopRows.filter((r) => r.creditSales > 0).sort((a, b) => b.creditSales - a.creditSales);

  const body =
    filtered.length === 0
      ? [['—', '—', '0', moneyCell(0)]]
      : filtered.map((r) => [r.shop, r.location || '—', String(r.billCount), moneyCell(r.creditSales)]);

  const foot =
    filtered.length === 0
      ? null
      : [['Total', '', String(shopRows.reduce((s, r) => s + r.billCount, 0)), moneyCell(shopTotals.creditSales)]];

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY,
    tableWidth: doc.internal.pageSize.getWidth() - MARGIN * 2,
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 35 },
      2: { halign: 'right', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 35 },
    },
  });
}

function drawCashIn(doc, shopRows, shopTotals, startY) {
  const head = [['Shop', 'Location', 'Payments', 'Cash in']];
  const filtered = shopRows.filter((r) => r.cashIn > 0).sort((a, b) => b.cashIn - a.cashIn);

  const body =
    filtered.length === 0
      ? [['—', '—', '0', moneyCell(0)]]
      : filtered.map((r) => [r.shop, r.location || '—', String(r.paymentCount), moneyCell(r.cashIn)]);

  const foot =
    filtered.length === 0
      ? null
      : [
          [
            'Total',
            '',
            String(shopRows.reduce((s, r) => s + r.paymentCount, 0)),
            moneyCell(shopTotals.cashIn),
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY,
    tableWidth: doc.internal.pageSize.getWidth() - MARGIN * 2,
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 35 },
      2: { halign: 'right', cellWidth: 22 },
      3: { halign: 'right', cellWidth: 35 },
    },
  });
}

function drawBankDeposits(doc, bankDailyRows, bankDailyTotals, startY) {
  const summaryY = startY;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Bank deposit: ${moneyCell(bankDailyTotals.bankDeposit)} · Cash in: ${moneyCell(bankDailyTotals.cashIn)} · Total income: ${moneyCell(bankDailyTotals.totalIncome)} (${bankDailyRows.length} day${bankDailyRows.length === 1 ? '' : 's'})`,
    MARGIN,
    summaryY,
  );
  doc.setTextColor(0, 0, 0);

  const head = [['Payment date', 'Cash in', 'Bank deposit', 'Total income (cash + cheque)']];
  const body =
    bankDailyRows.length === 0
      ? [['—', moneyCell(0), moneyCell(0), moneyCell(0)]]
      : bankDailyRows.map((r) => [
          r.date,
          moneyCell(r.cashIn),
          moneyCell(r.bankDeposit),
          moneyCell(r.totalIncome),
        ]);

  const foot =
    bankDailyRows.length === 0
      ? null
      : [
          [
            'Total',
            moneyCell(bankDailyTotals.cashIn),
            moneyCell(bankDailyTotals.bankDeposit),
            moneyCell(bankDailyTotals.totalIncome),
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY: summaryY + 6,
    tableWidth: doc.internal.pageSize.getWidth() - MARGIN * 2,
    columnStyles: {
      0: { cellWidth: 35 },
      1: { halign: 'right', cellWidth: 35 },
      2: { halign: 'right', cellWidth: 35 },
      3: { halign: 'right', cellWidth: 42 },
    },
  });
}

function drawPendingCheques(doc, pendingChequeRows, pendingChequeTotal, startY) {
  const summaryY = startY;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Pending deposit total: ${moneyCell(pendingChequeTotal)} · ${pendingChequeRows.length} cheque${pendingChequeRows.length === 1 ? '' : 's'} awaiting bank deposit`,
    MARGIN,
    summaryY,
  );
  doc.setTextColor(0, 0, 0);

  const head = [['Cheque date', 'Amount', 'Cheque #', 'Customer', 'Bill #', 'Payment date']];
  const body =
    pendingChequeRows.length === 0
      ? [['—', moneyCell(0), '—', '—', '—', '—']]
      : pendingChequeRows.map((r) => [
          r.chequeDate,
          moneyCell(r.amount),
          r.chequeNumber,
          r.customerName,
          r.billNumber,
          r.paymentDate,
        ]);

  const foot =
    pendingChequeRows.length === 0
      ? null
      : [['Total', moneyCell(pendingChequeTotal), '', '', '', '']];

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY: summaryY + 6,
    tableWidth: doc.internal.pageSize.getWidth() - MARGIN * 2,
    columnStyles: {
      0: { cellWidth: 24 },
      1: { halign: 'right', cellWidth: 28 },
      2: { cellWidth: 22, font: 'courier' },
      3: { cellWidth: 38 },
      4: { cellWidth: 18, font: 'courier' },
      5: { cellWidth: 24 },
    },
  });
}

/**
 * Build an A4 portrait PDF of the reports page (multi-page, all tables).
 */
export function downloadReportsPdf(data, options = {}) {
  const {
    periodLabel = 'All dates',
    brandLabel = 'All brands',
    loadsReport,
    visibleBrands,
    shopRows,
    shopTotals,
    bankDailyRows,
    bankDailyTotals,
    pendingChequeRows,
    pendingChequeTotal,
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
  doc.text('Reports', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(`Period: ${periodLabel}`, MARGIN, 27);
  doc.text(`Bag type filter: ${brandLabel}`, MARGIN, 32);
  doc.setTextColor(0, 0, 0);

  let y = drawSectionTitle(
    doc,
    '1. Cement bags from loads',
    `${loadsReport.loadCount} load${loadsReport.loadCount === 1 ? '' : 's'} in period — bag counts by type`,
    40,
  );
  drawLoadsSummary(doc, loadsReport, visibleBrands, y);

  y = drawSectionTitle(
    doc,
    '2. Cement bags per shop',
    'Credit bill bags sold to each customer (columns are bag types)',
    nextY(doc, 10),
  );
  drawBagsPerShop(doc, shopRows, visibleBrands, shopTotals, y);

  y = drawSectionTitle(
    doc,
    '3. Credit sales per shop',
    'Total credit bill amounts per customer',
    nextY(doc, 10),
  );
  drawCreditSales(doc, shopRows, shopTotals, y);

  y = drawSectionTitle(
    doc,
    '4. Cash in per shop',
    'Payments received (cash + cheque) per customer',
    nextY(doc, 10),
  );
  drawCashIn(doc, shopRows, shopTotals, y);

  y = drawSectionTitle(
    doc,
    '5. Bank cash deposits',
    'Daily cash by payment date — treated as bank deposit on that day',
    nextY(doc, 10),
  );
  drawBankDeposits(doc, bankDailyRows, bankDailyTotals, y);

  y = drawSectionTitle(
    doc,
    '6. Cheques to be deposited',
    'Cheques dated in period not yet marked as deposited',
    nextY(doc, 10),
  );
  drawPendingCheques(doc, pendingChequeRows, pendingChequeTotal, y);

  addPageFooters(doc);

  const { dateFrom = '', dateTo = '' } = options;
  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const brandSlug = brandLabel.toLowerCase().replace(/\s+/g, '-');
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`report-${rangeSlug}-${brandSlug}-${safeDate}.pdf`);
}
