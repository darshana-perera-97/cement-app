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
    chequeRows = [],
    chequeTotal = 0,
    cdmRows = [],
    cdmTotal = 0,
    bankTransferRows = [],
    bankTransferTotal = 0,
    showRecordedBy = false,
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

  const shopHead = [['Shop', 'Location', 'Cash', 'Cheque', 'CDM', 'Bank transfer', 'Collections']];
  const shopBody =
    shopRows.length === 0
      ? [['—', '—', moneyCell(0), moneyCell(0), moneyCell(0), moneyCell(0), moneyCell(0)]]
      : shopRows.map((r) => [
          r.shop || '—',
          r.location || '—',
          moneyCell(r.cashCollected),
          moneyCell(r.chequeCollected),
          moneyCell(r.cdmCollected),
          moneyCell(r.bankTransferCollected),
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
            moneyCell(totals.cdm),
            moneyCell(totals.bankTransfer),
            moneyCell(totals.collections),
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    styles: { ...TABLE_OPTS.styles, fontSize: 7, cellPadding: 1.4 },
    head: shopHead,
    body: shopBody,
    foot: shopFoot || undefined,
    startY: y + 2,
    tableWidth: pageW,
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
  });

  y = addSectionTitle(
    doc,
    'Cheque list',
    `Cheques on payments dated ${reportDate || '—'}${userLabel ? ` · ${userLabel}` : ''}.`,
  );

  const chequeHead = showRecordedBy
    ? [['Shop', 'Cheque date', 'Amount', 'Cheque #', 'Bill #', 'Deposited', 'Recorded by']]
    : [['Shop', 'Cheque date', 'Amount', 'Cheque #', 'Bill #', 'Deposited']];
  const chequeBody =
    chequeRows.length === 0
      ? [showRecordedBy ? ['—', '—', moneyCell(0), '—', '—', '—', '—'] : ['—', '—', moneyCell(0), '—', '—', '—']]
      : chequeRows.map((r) => {
          const row = [
            r.customerName || '—',
            r.chequeDate || '—',
            moneyCell(r.amount),
            r.chequeNumber || '—',
            r.billNumber || '—',
            r.chequeDeposited ? 'Yes' : 'Pending',
          ];
          if (showRecordedBy) row.push(r.recordedBy || '—');
          return row;
        });

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
            ...(showRecordedBy ? [''] : []),
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: chequeHead,
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

  const cdmHead = showRecordedBy
    ? [['Shop', 'Amount', 'CDM #', 'Bank account', 'Bill #', 'Approval', 'Recorded by']]
    : [['Shop', 'Amount', 'CDM #', 'Bank account', 'Bill #', 'Approval']];
  const cdmBody =
    cdmRows.length === 0
      ? [showRecordedBy ? ['—', moneyCell(0), '—', '—', '—', '—', '—'] : ['—', moneyCell(0), '—', '—', '—', '—']]
      : cdmRows.map((r) => {
          const row = [
            r.customerName || '—',
            moneyCell(r.amount),
            r.cdmNumber || '—',
            r.bankAccount || '—',
            r.billNumber || '—',
            r.approval || '—',
          ];
          if (showRecordedBy) row.push(r.recordedBy || '—');
          return row;
        });

  const cdmFoot =
    cdmRows.length === 0
      ? null
      : [
          [
            `Total (${cdmRows.length} deposit${cdmRows.length === 1 ? '' : 's'})`,
            moneyCell(cdmTotal),
            '',
            '',
            '',
            '',
            ...(showRecordedBy ? [''] : []),
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: cdmHead,
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

  const bankHead = showRecordedBy
    ? [['Shop', 'Amount', 'Reference #', 'Bank account', 'Bill #', 'Approval', 'Recorded by']]
    : [['Shop', 'Amount', 'Reference #', 'Bank account', 'Bill #', 'Approval']];
  const bankBody =
    bankTransferRows.length === 0
      ? [showRecordedBy ? ['—', moneyCell(0), '—', '—', '—', '—', '—'] : ['—', moneyCell(0), '—', '—', '—', '—']]
      : bankTransferRows.map((r) => {
          const row = [
            r.customerName || '—',
            moneyCell(r.amount),
            r.reference || '—',
            r.bankAccount || '—',
            r.billNumber || '—',
            r.approval || '—',
          ];
          if (showRecordedBy) row.push(r.recordedBy || '—');
          return row;
        });

  const bankFoot =
    bankTransferRows.length === 0
      ? null
      : [
          [
            `Total (${bankTransferRows.length} transfer${bankTransferRows.length === 1 ? '' : 's'})`,
            moneyCell(bankTransferTotal),
            '',
            '',
            '',
            '',
            ...(showRecordedBy ? [''] : []),
          ],
        ];

  autoTable(doc, {
    ...TABLE_OPTS,
    head: bankHead,
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
