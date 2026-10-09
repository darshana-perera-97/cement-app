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

function addSectionTitle(doc, title, subtitle) {
  let y = nextY(doc, 10);
  const pageHeight = doc.internal.pageSize.getHeight();
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
    doc.text(subtitle, MARGIN, y + 4);
    doc.setTextColor(0, 0, 0);
    return y + 8;
  }
  return y + 4;
}

/**
 * Daily collections report PDF: summary, by shop, cheque / CDM / bank transfer lists.
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
    chequeTotal = 0,
    cdmRows = [],
    cdmTotal = 0,
    bankTransferRows = [],
    bankTransferTotal = 0,
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
  doc.text('Collections, cheques, CDM deposits, and bank transfers by payment date.', MARGIN, headerY);
  doc.setTextColor(0, 0, 0);

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;

  autoTable(doc, {
    ...TABLE_OPTS,
    head: [['Summary', 'Amount']],
    body: [
      ['Collections (all methods)', moneyCell(totals.collections)],
      ['Cash', moneyCell(totals.cash)],
      ['Cheque', moneyCell(totals.cheque)],
      ['CDM deposit', moneyCell(totals.cdm)],
      ['Bank transfer', moneyCell(totals.bankTransfer)],
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
      : shopRows.map((r) => [r.shop || '—', r.cashInvoiceNumbers || '—', ...shopAmountCells(r)]);

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
      `Cash collected on ${reportDate || '—'}${userLabel ? ` · ${userLabel}` : ''}.`,
    );
    const cashBody =
      cashRows.length === 0
        ? [['—', '—', moneyCell(0)]]
        : cashRows.map((r) => [r.customerName || '—', r.invoiceNumber || '—', moneyCell(r.amount)]);
    const cashFoot =
      cashRows.length === 0
        ? null
        : [
            [
              `Total (${cashRows.length} payment${cashRows.length === 1 ? '' : 's'})`,
              '',
              moneyCell(totals.cash),
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
    `Cheques collected on ${reportDate || '—'}, with returned cheques deducted on the day they bounce${userLabel ? ` · ${userLabel}` : ''}.`,
  );

  const chequeHeadRow = ['Shop', 'Cheque date', 'Amount', 'Cheque #', 'Bill #', 'Deposited'];
  if (showInvoiceNumber) chequeHeadRow.splice(4, 0, 'Invoice #');
  if (showRecordedBy) chequeHeadRow.push('Recorded by');
  const chequeEmpty = ['—', '—', moneyCell(0), '—', '—', '—'];
  if (showInvoiceNumber) chequeEmpty.splice(4, 0, '—');
  if (showRecordedBy) chequeEmpty.push('—');
  const chequeBody =
    chequeRows.length === 0
      ? [chequeEmpty]
      : chequeRows.map((r) => {
          const row = [
            r.customerName || '—',
            r.chequeDate || '—',
            moneyCell(r.amount),
            r.chequeNumber || '—',
            r.billNumber || '—',
            r.isReturnDeduction ? 'Returned' : r.chequeDeposited ? 'Yes' : 'Pending',
          ];
          if (showInvoiceNumber) row.splice(4, 0, r.invoiceNumber || '—');
          if (showRecordedBy) row.push(r.recordedBy || '—');
          return row;
        });

  const chequeFootRow = [
    `Total (${chequeRows.length} cheque${chequeRows.length === 1 ? '' : 's'})`,
    '',
    moneyCell(chequeTotal),
    '',
    '',
    '',
  ];
  if (showInvoiceNumber) chequeFootRow.splice(4, 0, '');
  if (showRecordedBy) chequeFootRow.push('');
  const chequeFoot = chequeRows.length === 0 ? null : [chequeFootRow];

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
    `CDM deposits on payments dated ${reportDate || '—'}${userLabel ? ` · ${userLabel}` : ''}.`,
  );

  const cdmHeadRow = ['Shop', 'Amount', 'Deposit date', 'CDM #', 'Bank account', 'Bill #', 'Approval'];
  if (showInvoiceNumber) cdmHeadRow.splice(5, 0, 'Invoice #');
  if (showRecordedBy) cdmHeadRow.push('Recorded by');
  const cdmEmpty = ['—', moneyCell(0), '—', '—', '—', '—', '—'];
  if (showInvoiceNumber) cdmEmpty.splice(5, 0, '—');
  if (showRecordedBy) cdmEmpty.push('—');
  const cdmBody =
    cdmRows.length === 0
      ? [cdmEmpty]
      : cdmRows.map((r) => {
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
    `Total (${cdmRows.length} deposit${cdmRows.length === 1 ? '' : 's'})`,
    moneyCell(cdmTotal),
    '',
    '',
    '',
    '',
    '',
  ];
  if (showInvoiceNumber) cdmFootRow.splice(5, 0, '');
  if (showRecordedBy) cdmFootRow.push('');
  const cdmFoot = cdmRows.length === 0 ? null : [cdmFootRow];

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
    `Online bank transfers on payments dated ${reportDate || '—'}${userLabel ? ` · ${userLabel}` : ''}.`,
  );

  const bankHeadRow = ['Shop', 'Amount', 'Transfer date', 'Reference #', 'Bank account', 'Bill #', 'Approval'];
  if (showInvoiceNumber) bankHeadRow.splice(5, 0, 'Invoice #');
  if (showRecordedBy) bankHeadRow.push('Recorded by');
  const bankEmpty = ['—', moneyCell(0), '—', '—', '—', '—', '—'];
  if (showInvoiceNumber) bankEmpty.splice(5, 0, '—');
  if (showRecordedBy) bankEmpty.push('—');
  const bankBody =
    bankTransferRows.length === 0
      ? [bankEmpty]
      : bankTransferRows.map((r) => {
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
    `Total (${bankTransferRows.length} transfer${bankTransferRows.length === 1 ? '' : 's'})`,
    moneyCell(bankTransferTotal),
    '',
    '',
    '',
    '',
    '',
  ];
  if (showInvoiceNumber) bankFootRow.splice(5, 0, '');
  if (showRecordedBy) bankFootRow.push('');
  const bankFoot = bankTransferRows.length === 0 ? null : [bankFootRow];

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

  addPageFooters(doc);

  const { dateSlug = reportDate || 'day' } = options;
  const safeGenerated = generatedAt.toISOString().slice(0, 10);
  doc.save(`daily-collections-${dateSlug}-${safeGenerated}.pdf`);
}
