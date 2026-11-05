import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  cashInvoicesExcludingReturnSettlements,
  chequeNumberWithBank,
  collectReturnChequeSettlementRows,
  sumAmounts,
  withoutReturnChequeSettlements,
} from './dailyCollectionsReturnSettlements';

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

function addSectionTitle(doc, title, subtitle) {
  let y = nextY(doc, 10);
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  if (y > pageHeight - 40) {
    doc.addPage();
    y = 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(title, MARGIN, y);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(subtitle, pageW);
    doc.text(lines, MARGIN, y + 4);
    doc.setTextColor(0, 0, 0);
    return y + 4 + lines.length * 3.6;
  }
  return y + 4;
}

/**
 * Daily collections report PDF: summary, by shop, method lists, and return-cheque settlements.
 */
export function downloadDailyCollectionsReportPdf(data, options = {}) {
  const {
    reportDate = '',
    userLabel = '',
    totals = {},
    userRows = [],
    shopRows = [],
    cashRows = [],
    chequeRows = [],
    cdmRows = [],
    bankTransferRows = [],
    showRecordedBy = false,
    showInvoiceNumber = false,
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
  let headerY = 32;
  if (userLabel) {
    doc.text(`User: ${userLabel}`, MARGIN, headerY);
    headerY += 5;
  }
  doc.text(
    'Collections by payment date. Return cheque settlements are listed in their own section.',
    MARGIN,
    headerY,
  );
  doc.setTextColor(0, 0, 0);

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const returnChequeRows = collectReturnChequeSettlementRows({
    cashRows,
    chequeRows,
    cdmRows,
    bankTransferRows,
  });
  const returnChequeTotal = sumAmounts(returnChequeRows);
  const listedCashRows = withoutReturnChequeSettlements(cashRows);
  const listedChequeRows = withoutReturnChequeSettlements(chequeRows);
  const listedCdmRows = withoutReturnChequeSettlements(cdmRows);
  const listedBankRows = withoutReturnChequeSettlements(bankTransferRows);

  autoTable(doc, {
    ...TABLE_OPTS,
    head: [['Summary', 'Amount']],
    body: [
      ['Collections (all methods)', moneyCell(totals.collections)],
      ['Cash', moneyCell(totals.cash)],
      ['Cheque', moneyCell(totals.cheque)],
      ['CDM deposit', moneyCell(totals.cdm)],
      ['Bank transfer', moneyCell(totals.bankTransfer)],
      ['Return cheque settlements (included above)', moneyCell(returnChequeTotal)],
    ],
    startY: headerY + 6,
    tableWidth: pageW,
    columnStyles: {
      0: { cellWidth: pageW * 0.55 },
      1: { halign: 'right', cellWidth: pageW * 0.45 },
    },
  });

  if (userRows.length > 0) {
    const yUsers = addSectionTitle(doc, 'By user', `Collections recorded by each user on ${reportDate || '—'}.`);
    const userHead = [['User', 'Payments', 'Cash', 'Cheque', 'CDM', 'Bank transfer', 'Collections']];
    const userBody = userRows.map((r) => [
      r.userLabel || '—',
      String(r.paymentCount ?? 0),
      moneyCell(r.cash),
      moneyCell(r.cheque),
      moneyCell(r.cdm),
      moneyCell(r.bankTransfer),
      moneyCell(r.collections),
    ]);
    const userFoot = [
      [
        `Total (${userRows.length} user${userRows.length === 1 ? '' : 's'})`,
        String(totals.paymentCount ?? 0),
        moneyCell(totals.cash),
        moneyCell(totals.cheque),
        moneyCell(totals.cdm),
        moneyCell(totals.bankTransfer),
        moneyCell(totals.collections),
      ],
    ];
    autoTable(doc, {
      ...TABLE_OPTS,
      styles: { ...TABLE_OPTS.styles, fontSize: 7, cellPadding: 1.4 },
      head: userHead,
      body: userBody,
      foot: userFoot,
      startY: yUsers + 2,
      tableWidth: pageW,
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
      },
    });
  }

  const shopTitle = userLabel && userLabel !== 'All users' ? `By shop · ${userLabel}` : 'By shop';
  let y = addSectionTitle(doc, shopTitle);

  const shopAmountCells = (r) => [
    moneyCell(r?.cashCollected),
    moneyCell(r?.chequeCollected),
    moneyCell(r?.cdmCollected),
    moneyCell(r?.bankTransferCollected),
    moneyCell(r?.cashIn),
  ];
  const shopHead = [['Shop', 'Cash invoice #', 'Cash', 'Cheque', 'CDM', 'Bank transfer', 'Collections']];
  const emptyShopAmounts = [moneyCell(0), moneyCell(0), moneyCell(0), moneyCell(0), moneyCell(0)];
  const shopBody =
    shopRows.length === 0
      ? [['—', '—', ...emptyShopAmounts]]
      : shopRows.map((r) => [
          r.shop || '—',
          cashInvoicesExcludingReturnSettlements(r.cashInvoiceNumbers),
          ...shopAmountCells(r),
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
            moneyCell(totals.cdm),
            moneyCell(totals.bankTransfer),
            moneyCell(totals.collections),
          ],
        ];

  const shopColumnStyles = {};
  for (let i = 0; i < 5; i += 1) shopColumnStyles[2 + i] = { halign: 'right' };

  autoTable(doc, {
    ...TABLE_OPTS,
    styles: { ...TABLE_OPTS.styles, fontSize: 7, cellPadding: 1.4 },
    head: shopHead,
    body: shopBody,
    foot: shopFoot || undefined,
    startY: y + 2,
    tableWidth: pageW,
    columnStyles: shopColumnStyles,
  });

  if (showInvoiceNumber) {
    y = addSectionTitle(
      doc,
      'Cash list',
      `Cash collected on ${reportDate || '—'}${userLabel ? ` · ${userLabel}` : ''}. Return cheque settlements are listed separately.`,
    );
    const cashBody =
      listedCashRows.length === 0
        ? [['—', '—', moneyCell(0)]]
        : listedCashRows.map((r) => [r.customerName || '—', r.invoiceNumber || '—', moneyCell(r.amount)]);
    const cashFoot =
      listedCashRows.length === 0
        ? null
        : [
            [
              `Total (${listedCashRows.length} payment${listedCashRows.length === 1 ? '' : 's'})`,
              '',
              moneyCell(sumAmounts(listedCashRows)),
            ],
          ];
    autoTable(doc, {
      ...TABLE_OPTS,
      head: [['Shop', 'Invoice #', 'Amount']],
      body: cashBody,
      foot: cashFoot || undefined,
      startY: y,
      tableWidth: pageW,
      columnStyles: {
        2: { halign: 'right' },
      },
    });
  }

  y = addSectionTitle(
    doc,
    'Cheque list',
    `Cheques collected on ${reportDate || '—'}, with returned cheques deducted on the day they bounce${userLabel ? ` · ${userLabel}` : ''}. Return cheque settlements are listed separately.`,
  );

  const chequeHeadRow = ['Shop', 'Cheque date', 'Amount', 'Cheque #', 'Bill #', 'Deposited'];
  if (showInvoiceNumber) chequeHeadRow.splice(4, 0, 'Invoice #');
  if (showRecordedBy) chequeHeadRow.push('Recorded by');
  const chequeEmpty = ['—', '—', moneyCell(0), '—', '—', '—'];
  if (showInvoiceNumber) chequeEmpty.splice(4, 0, '—');
  if (showRecordedBy) chequeEmpty.push('—');
  const chequeBody =
    listedChequeRows.length === 0
      ? [chequeEmpty]
      : listedChequeRows.map((r) => {
          const row = [
            r.customerName || '—',
            r.chequeDate || '—',
            moneyCell(r.amount),
            chequeNumberWithBank(r),
            r.billNumber || '—',
            r.isReturnDeduction ? 'Returned' : r.chequeDeposited ? 'Yes' : 'Pending',
          ];
          if (showInvoiceNumber) row.splice(4, 0, r.invoiceNumber || '—');
          if (showRecordedBy) row.push(r.recordedBy || '—');
          return row;
        });

  const chequeFootRow = [
    `Total (${listedChequeRows.length} cheque${listedChequeRows.length === 1 ? '' : 's'})`,
    '',
    moneyCell(sumAmounts(listedChequeRows)),
    '',
    '',
    '',
  ];
  if (showInvoiceNumber) chequeFootRow.splice(4, 0, '');
  if (showRecordedBy) chequeFootRow.push('');
  const chequeFoot = listedChequeRows.length === 0 ? null : [chequeFootRow];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: [chequeHeadRow],
    body: chequeBody,
    foot: chequeFoot || undefined,
    startY: y,
    tableWidth: pageW,
    columnStyles: {
      2: { halign: 'right' },
    },
  });

  y = addSectionTitle(
    doc,
    'CDM deposit list',
    `CDM deposits on payments dated ${reportDate || '—'}${userLabel ? ` · ${userLabel}` : ''}. Return cheque settlements are listed separately.`,
  );

  const cdmHeadRow = ['Shop', 'Amount', 'Deposit date', 'CDM #', 'Bank account', 'Bill #', 'Approval'];
  if (showInvoiceNumber) cdmHeadRow.splice(5, 0, 'Invoice #');
  if (showRecordedBy) cdmHeadRow.push('Recorded by');
  const cdmEmpty = ['—', moneyCell(0), '—', '—', '—', '—', '—'];
  if (showInvoiceNumber) cdmEmpty.splice(5, 0, '—');
  if (showRecordedBy) cdmEmpty.push('—');
  const cdmBody =
    listedCdmRows.length === 0
      ? [cdmEmpty]
      : listedCdmRows.map((r) => {
          const row = [
            r.customerName || '—',
            moneyCell(r.amount),
            r.cdmDate || '—',
            r.cdmNumber || '—',
            r.bankAccount || '—',
            r.billNumber || '—',
            r.approval || '—',
          ];
          if (showInvoiceNumber) row.splice(5, 0, r.invoiceNumber || '—');
          if (showRecordedBy) row.push(r.recordedBy || '—');
          return row;
        });

  const cdmFootRow = [
    `Total (${listedCdmRows.length} deposit${listedCdmRows.length === 1 ? '' : 's'})`,
    moneyCell(sumAmounts(listedCdmRows)),
    '',
    '',
    '',
    '',
    '',
  ];
  if (showInvoiceNumber) cdmFootRow.splice(5, 0, '');
  if (showRecordedBy) cdmFootRow.push('');
  const cdmFoot = listedCdmRows.length === 0 ? null : [cdmFootRow];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: [cdmHeadRow],
    body: cdmBody,
    foot: cdmFoot || undefined,
    startY: y,
    tableWidth: pageW,
    columnStyles: {
      1: { halign: 'right' },
    },
  });

  y = addSectionTitle(
    doc,
    'Bank transfer list',
    `Online bank transfers on payments dated ${reportDate || '—'}${userLabel ? ` · ${userLabel}` : ''}. Return cheque settlements are listed separately.`,
  );

  const bankHeadRow = ['Shop', 'Amount', 'Transfer date', 'Reference #', 'Bank account', 'Bill #', 'Approval'];
  if (showInvoiceNumber) bankHeadRow.splice(5, 0, 'Invoice #');
  if (showRecordedBy) bankHeadRow.push('Recorded by');
  const bankEmpty = ['—', moneyCell(0), '—', '—', '—', '—', '—'];
  if (showInvoiceNumber) bankEmpty.splice(5, 0, '—');
  if (showRecordedBy) bankEmpty.push('—');
  const bankBody =
    listedBankRows.length === 0
      ? [bankEmpty]
      : listedBankRows.map((r) => {
          const row = [
            r.customerName || '—',
            moneyCell(r.amount),
            r.transferDate || '—',
            r.reference || '—',
            r.bankAccount || '—',
            r.billNumber || '—',
            r.approval || '—',
          ];
          if (showInvoiceNumber) row.splice(5, 0, r.invoiceNumber || '—');
          if (showRecordedBy) row.push(r.recordedBy || '—');
          return row;
        });

  const bankFootRow = [
    `Total (${listedBankRows.length} transfer${listedBankRows.length === 1 ? '' : 's'})`,
    moneyCell(sumAmounts(listedBankRows)),
    '',
    '',
    '',
    '',
    '',
  ];
  if (showInvoiceNumber) bankFootRow.splice(5, 0, '');
  if (showRecordedBy) bankFootRow.push('');
  const bankFoot = listedBankRows.length === 0 ? null : [bankFootRow];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: [bankHeadRow],
    body: bankBody,
    foot: bankFoot || undefined,
    startY: y,
    tableWidth: pageW,
    columnStyles: {
      1: { halign: 'right' },
    },
  });

  y = addSectionTitle(
    doc,
    'Return cheque settlements',
    `Payments on ${reportDate || '—'} that settle a returned cheque${userLabel ? ` · ${userLabel}` : ''}. These amounts are already included in the method totals above and are not repeated in the cash, cheque, CDM, or bank lists.`,
  );

  const returnHead = ['Shop', 'Return cheque', 'Method', 'Reference', 'Amount'];
  if (showRecordedBy) returnHead.push('Recorded by');
  const returnEmpty = ['—', '—', '—', '—', moneyCell(0)];
  if (showRecordedBy) returnEmpty.push('—');
  const returnBody =
    returnChequeRows.length === 0
      ? [returnEmpty]
      : returnChequeRows.map((r) => {
          const row = [
            r.customerName || '—',
            r.returnCheque || '—',
            r.method || '—',
            r.reference || '—',
            moneyCell(r.amount),
          ];
          if (showRecordedBy) row.push(r.recordedBy || '—');
          return row;
        });
  const returnFootRow = [
    `Total (${returnChequeRows.length} settlement${returnChequeRows.length === 1 ? '' : 's'})`,
    '',
    '',
    '',
    moneyCell(returnChequeTotal),
  ];
  if (showRecordedBy) returnFootRow.push('');
  const returnFoot = returnChequeRows.length === 0 ? null : [returnFootRow];
  const returnColumnStyles = { 4: { halign: 'right' } };

  autoTable(doc, {
    ...TABLE_OPTS,
    head: [returnHead],
    body: returnBody,
    foot: returnFoot || undefined,
    startY: y,
    tableWidth: pageW,
    columnStyles: returnColumnStyles,
  });

  addPageFooters(doc);

  const { dateSlug = reportDate || 'day' } = options;
  const safeGenerated = generatedAt.toISOString().slice(0, 10);
  doc.save(`daily-collections-${dateSlug}-${safeGenerated}.pdf`);
}
