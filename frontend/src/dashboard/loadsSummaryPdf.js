import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BRANDS } from './brandTheme';

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

function drawLoadsSummary(doc, loadsReport, startY) {
  const head = [['Bag type', 'Bags']];
  const body = BRANDS.map((b) => [b.label, formatBags(loadsReport.byBrand[b.key] || 0)]);
  body.push(['Total bags', formatBags(loadsReport.total)]);
  body.push(['Loads', String(loadsReport.loadCount)]);
  body.push(['Total purchase amount', moneyCell(loadsReport.totalAmount)]);

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    startY,
    tableWidth: doc.internal.pageSize.getWidth() - MARGIN * 2,
    columnStyles: {
      0: { cellWidth: 55 },
      1: { halign: 'right', cellWidth: 45 },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index >= BRANDS.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });
}

function drawLoadDetailTable(doc, loadRows, startY) {
  const head = [['Date', 'Stock ID', 'Vehicle', ...BRANDS.map((b) => b.label), 'Total amount']];
  const body =
    loadRows.length === 0
      ? [['—', '—', '—', ...BRANDS.map(() => '0'), moneyCell(0)]]
      : loadRows.map((r) => [
          r.date,
          r.stockId || '—',
          r.vehicleNumber || '—',
          ...BRANDS.map((b) => formatBags(r[`${b.key}Bags`] || 0)),
          moneyCell(r.totalAmount),
        ]);

  const foot =
    loadRows.length === 0
      ? null
      : [
          [
            'Grand total',
            '',
            '',
            ...BRANDS.map((b) =>
              formatBags(loadRows.reduce((s, r) => s + (Number(r[`${b.key}Bags`]) || 0), 0)),
            ),
            moneyCell(loadRows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0)),
          ],
        ];

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const brandW = Math.min(16, (pageW - 70) / BRANDS.length);

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body,
    foot,
    startY,
    tableWidth: pageW,
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 22 },
      2: { cellWidth: 20 },
      ...Object.fromEntries(BRANDS.map((_, i) => [i + 3, { halign: 'right', cellWidth: brandW }])),
      [3 + BRANDS.length]: { halign: 'right', cellWidth: 28 },
    },
  });
}

function groupInvoiceRowsByShop(invoiceRows) {
  const groups = new Map();
  for (const row of invoiceRows) {
    const shop = String(row.shop ?? '').trim() || '—';
    if (!groups.has(shop)) groups.set(shop, []);
    groups.get(shop).push(row);
  }
  return [...groups.entries()]
    .map(([shop, invoices]) => ({
      shop,
      invoices: [...invoices].sort((a, b) =>
        String(a.invoiceDate ?? '').localeCompare(String(b.invoiceDate ?? '')),
      ),
    }))
    .sort((a, b) => a.shop.localeCompare(b.shop));
    
}

/**
 * Invoice lines grouped by shop. After each shop: outstanding | total amount.
 * @param {Array<{ shop: string, invoiceDate: string, daysFromBillDate: number, amount: number }>} invoiceRows
 * @param {Map<string, number>|Record<string, number>} shopOutstandingByName
 */
function buildInvoiceTableBody(invoiceRows, shopOutstandingByName) {
  const outstandingOf = (shop) => {
    const name = String(shop ?? '').trim();
    if (shopOutstandingByName instanceof Map) {
      if (shopOutstandingByName.has(name)) {
        return Math.max(0, Number(shopOutstandingByName.get(name)) || 0);
      }
      return Math.max(0, Number(shopOutstandingByName.get(name.toLowerCase())) || 0);
    }
    const key = Object.keys(shopOutstandingByName || {}).find(
      (k) => k.toLowerCase() === name.toLowerCase(),
    );
    return Math.max(0, Number(key != null ? shopOutstandingByName[key] : 0) || 0);
  };

  const body = [];
  const subtotalRowIndices = new Set();
  let grandTotal = 0;
  let grandOutstanding = 0;

  for (const { shop, invoices } of groupInvoiceRowsByShop(invoiceRows)) {
    for (const inv of invoices) {
      body.push([
        shop,
        String(inv.invoiceDate ?? ''),
        String(inv.daysFromBillDate ?? 0),
        moneyCell(inv.amount),
      ]);
    }

    const shopTotal = invoices.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const shopOutstanding = outstandingOf(shop);
    grandTotal += shopTotal;
    grandOutstanding += shopOutstanding;

    subtotalRowIndices.add(body.length);
    body.push([
      shop,
      'Outstanding | Total',
      '',
      `${moneyCell(shopOutstanding)} | ${moneyCell(shopTotal)}`,
    ]);
  }

  return { body, subtotalRowIndices, grandTotal, grandOutstanding };
}

function drawInvoiceSalesByShop(doc, invoiceRows, shopOutstandingByName, startY) {
  const head = [['Shop name', 'Invoice date', 'Days from bill date', 'Amount']];
  const { body, subtotalRowIndices, grandTotal, grandOutstanding } = buildInvoiceTableBody(
    invoiceRows,
    shopOutstandingByName,
  );

  const tableBody =
    body.length === 0 ? [['—', '—', '0', moneyCell(0)]] : body;

  const foot =
    body.length === 0
      ? null
      : [
          [
            'Grand total',
            'Outstanding | Total',
            '',
            `${moneyCell(grandOutstanding)} | ${moneyCell(grandTotal)}`,
          ],
        ];

  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;

  autoTable(doc, {
    ...TABLE_OPTS,
    head,
    body: tableBody,
    foot,
    startY,
    tableWidth: pageW,
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 36 },
      2: { halign: 'right', cellWidth: 32 },
      3: { halign: 'right', cellWidth: pageW - 42 - 36 - 32 },
    },
    didParseCell(data) {
      if (data.section !== 'body' || !subtotalRowIndices.has(data.row.index)) return;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = [241, 245, 249];
      data.cell.styles.textColor = [15, 23, 42];
      if (data.column.index === 3) {
        data.cell.styles.textColor = [67, 56, 202];
      }
    },
  });
}

/**
 * Monthly loads summary PDF: bags brought in, invoice sales per shop with outstanding | total.
 */
export function downloadLoadsSummaryPdf(data, options = {}) {
  const {
    monthLabel = '',
    loadsReport,
    loadRows = [],
    invoiceRows = [],
    shopOutstandingByName = new Map(),
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
  doc.text('Monthly Loads Summary', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.text(`Month: ${monthLabel}`, MARGIN, 27);
  doc.text(
    'Credit invoices in the same month as loads. After each shop: outstanding balance | invoice total.',
    MARGIN,
    32,
  );
  doc.setTextColor(0, 0, 0);

  let y = drawSectionTitle(
    doc,
    '1. Bags from loads',
    `${loadsReport.loadCount} load${loadsReport.loadCount === 1 ? '' : 's'} received this month`,
    40,
  );
  drawLoadsSummary(doc, loadsReport, y);

  y = drawSectionTitle(
    doc,
    '2. Load details',
    'Each stock load received in the month',
    nextY(doc, 10),
  );
  drawLoadDetailTable(doc, loadRows, y);

  y = drawSectionTitle(
    doc,
    '3. Sales by shop',
    'Shop name, invoice date, days from bill date, amount — then outstanding | total per shop',
    nextY(doc, 10),
  );
  drawInvoiceSalesByShop(doc, invoiceRows, shopOutstandingByName, y);

  addPageFooters(doc);

  const { monthSlug = 'month' } = options;
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`loads-summary-${monthSlug}-${safeDate}.pdf`);
}
