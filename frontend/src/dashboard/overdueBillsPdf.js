import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysFromYmdToToday(fromYmd, toYmd = todayYmdLocal()) {
  if (!fromYmd || !toYmd || fromYmd.length < 10 || toYmd.length < 10) return null;
  const t0 = new Date(
    parseInt(fromYmd.slice(0, 4), 10),
    parseInt(fromYmd.slice(5, 7), 10) - 1,
    parseInt(fromYmd.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(toYmd.slice(0, 4), 10),
    parseInt(toYmd.slice(5, 7), 10) - 1,
    parseInt(toYmd.slice(8, 10), 10),
  ).getTime();
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

function daysFromBillDateForRow(row) {
  if (row?.daysFromBillDate != null && row.daysFromBillDate !== '') return row.daysFromBillDate;
  return daysFromYmdToToday(row?.billDate) ?? 0;
}

function groupRowsByShop(rows) {
  const groups = new Map();
  for (const row of rows) {
    const shop = String(row.customerName ?? '').trim() || 'Unknown';
    if (!groups.has(shop)) groups.set(shop, []);
    groups.get(shop).push(row);
  }

  return [...groups.entries()]
    .map(([shop, bills]) => ({ shop, bills }))
    .sort((a, b) => a.shop.localeCompare(b.shop));
}

function buildGroupedTableBody(rows) {
  const body = [];
  const subtotalRowIndices = new Set();

  for (const { shop, bills } of groupRowsByShop(rows)) {
    const sortedBills = [...bills].sort((a, b) => {
      const dueCmp = String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? ''));
      if (dueCmp !== 0) return dueCmp;
      return (Number(b.outstandingAmount) || 0) - (Number(a.outstandingAmount) || 0);
    });

    for (const bill of sortedBills) {
      body.push([
        shop,
        String(bill.details ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        String(bill.billDate ?? ''),
        String(daysFromBillDateForRow(bill)),
        String(bill.dueDate ?? ''),
        String(bill.daysOverdue ?? 0),
        formatLkr(bill.outstandingAmount),
      ]);
    }

    const shopOutstanding = sortedBills.reduce((sum, r) => sum + (Number(r.outstandingAmount) || 0), 0);
    subtotalRowIndices.add(body.length);
    body.push([
      shop,
      `${sortedBills.length} overdue bill${sortedBills.length === 1 ? '' : 's'} — shop total`,
      '',
      '',
      '',
      '',
      formatLkr(shopOutstanding),
    ]);
  }

  return { body, subtotalRowIndices };
}

function isBillOverdue(bill) {
  return (Number(bill?.daysOverdue) || 0) > 0;
}

/**
 * Pending bills grouped by shop. Columns: shop, bill date, days from bill date, amount.
 * After each shop: overdue amount | total amount to be paid.
 */
function buildSalesPersonTableBody(rows) {
  const body = [];
  const subtotalRowIndices = new Set();
  let grandOverdue = 0;
  let grandTotal = 0;

  for (const { shop, bills } of groupRowsByShop(rows)) {
    const sortedBills = [...bills].sort((a, b) => {
      const dateCmp = String(a.billDate ?? '').localeCompare(String(b.billDate ?? ''));
      if (dateCmp !== 0) return dateCmp;
      return (Number(b.outstandingAmount) || 0) - (Number(a.outstandingAmount) || 0);
    });

    for (const bill of sortedBills) {
      body.push([
        shop,
        String(bill.billDate ?? ''),
        String(daysFromBillDateForRow(bill)),
        formatLkr(bill.outstandingAmount),
      ]);
    }

    const shopTotal = sortedBills.reduce((sum, r) => sum + (Number(r.outstandingAmount) || 0), 0);
    const shopOverdue = sortedBills
      .filter(isBillOverdue)
      .reduce((sum, r) => sum + (Number(r.outstandingAmount) || 0), 0);
    grandTotal += shopTotal;
    grandOverdue += shopOverdue;

    subtotalRowIndices.add(body.length);
    body.push([
      shop,
      'Overdue | Total to pay',
      '',
      `${formatLkr(shopOverdue)} | ${formatLkr(shopTotal)}`,
    ]);
  }

  return { body, subtotalRowIndices, grandOverdue, grandTotal };
}

/**
 * Build an A4 portrait PDF for sales staff — all pending bills per shop.
 * @param {Array<{ customerName: string, billDate: string, daysFromBillDate?: number, daysOverdue?: number, outstandingAmount: number }>} rows
 */
export function downloadSalesPersonOverduePdf(rows, options = {}) {
  const { generatedAt = new Date() } = options;
  const safeRows = rows || [];

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const tableW = pageW - margin * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Sales person — pending bills', margin, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, margin, 22);
  doc.text(
    'All unpaid credit bills by shop. After each shop: overdue amount | total amount to be paid.',
    margin,
    27,
  );
  doc.setTextColor(0, 0, 0);

  const head = [['Shop name', 'Bill date', 'Days from bill date', 'Amount']];
  const { body, subtotalRowIndices, grandOverdue, grandTotal } = buildSalesPersonTableBody(safeRows);
  const tableBody = body.length === 0 ? [['—', '—', '0', formatLkr(0)]] : body;

  const foot =
    body.length === 0
      ? null
      : [
          [
            'Grand total',
            'Overdue | Total to pay',
            '',
            `${formatLkr(grandOverdue)} | ${formatLkr(grandTotal)}`,
          ],
        ];

  autoTable(doc, {
    head,
    body: tableBody,
    foot,
    startY: 32,
    margin: { top: 32, left: margin, right: margin, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
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
      0: { cellWidth: 42 },
      1: { cellWidth: 28 },
      2: { halign: 'right', cellWidth: 32 },
      3: { halign: 'right', cellWidth: tableW - 42 - 28 - 32 },
    },
    tableWidth: tableW,
    showHead: 'everyPage',
    didParseCell(data) {
      if (data.section !== 'body' || !subtotalRowIndices.has(data.row.index)) return;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = [241, 245, 249];
      data.cell.styles.textColor = [15, 23, 42];
      if (data.column.index === 3) {
        data.cell.styles.textColor = [190, 18, 60];
      }
    },
  });

  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4`, margin, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }

  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`sales-person-pending-bills-${safeDate}.pdf`);
}

/**
 * Build an A4 portrait PDF of overdue bills (multi-page when needed).
 * @param {Array<{ customerName: string, billDate: string, details: string, dueDate: string, daysFromBillDate?: number, daysOverdue: number, billTotal: number, outstandingAmount: number }>} rows
 */
export function downloadOverdueBillsPdf(rows, options = {}) {
  const { generatedAt = new Date() } = options;
  const safeRows = rows || [];

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Overdue bills', margin, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, margin, 22);
  doc.text(
    'Unpaid credit bills past each customer’s bill overdue window (default 14 days after bill date). Each shop lists individual bills plus total outstanding in LKR.',
    margin,
    27,
  );
  doc.setTextColor(0, 0, 0);

  const head = [
    ['Shop', 'Bill details', 'Bill date', 'Days from bill date', 'Due date', 'Days overdue', 'Outstanding'],
  ];
  const { body, subtotalRowIndices } = buildGroupedTableBody(safeRows);

  const grandOutstanding = safeRows.reduce((sum, r) => sum + (Number(r.outstandingAmount) || 0), 0);
  const foot = [
    [
      '',
      '',
      '',
      '',
      '',
      'Grand total',
      formatLkr(grandOutstanding),
    ],
  ];

  autoTable(doc, {
    head,
    body,
    foot,
    startY: 31,
    margin: { top: 31, left: margin, right: margin, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
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
      0: { cellWidth: 26 },
      1: { cellWidth: 44 },
      2: { cellWidth: 20 },
      3: { halign: 'right', cellWidth: 18 },
      4: { cellWidth: 20 },
      5: { halign: 'right', cellWidth: 16 },
      6: { halign: 'right', cellWidth: 24 },
    },
    tableWidth: pageW - margin * 2,
    showHead: 'everyPage',
    didParseCell(data) {
      if (data.section !== 'body' || !subtotalRowIndices.has(data.row.index)) return;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = [241, 245, 249];
      data.cell.styles.textColor = [15, 23, 42];
      if (data.column.index === 6) {
        data.cell.styles.textColor = [190, 18, 60];
      }
    },
  });

  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4`, margin, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }

  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`overdue-bills-${safeDate}.pdf`);
}
