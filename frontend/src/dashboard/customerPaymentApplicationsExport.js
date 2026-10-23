import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const MARGIN = 14;

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

function periodLabel(dateFrom, dateTo) {
  if (dateFrom || dateTo) return `Period: ${dateFrom || '…'} to ${dateTo || '…'}`;
  return 'Period: all dates';
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

function writePdfHeader(doc, title, customer, options, subtitle) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const customerName = String(customer?.name ?? '').trim() || 'Customer';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(`${title} — ${customerName}`, MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  let metaY = 22;
  const customerId = String(customer?.id ?? '').trim();
  if (customerId) {
    doc.text(`Customer ID: ${customerId}`, MARGIN, metaY);
    metaY += 5;
  }
  doc.text(
    `Generated: ${generatedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
    MARGIN,
    metaY,
  );
  metaY += 5;
  doc.text(periodLabel(dateFrom, dateTo), MARGIN, metaY);
  metaY += 5;
  if (subtitle) {
    doc.text(subtitle, MARGIN, metaY);
    metaY += 5;
  }
  doc.setTextColor(0, 0, 0);
  return metaY + 3;
}

function formatApplicationsLines(items, formatItem) {
  if (!items.length) return '—';
  return items.map(formatItem).join('\n');
}

/**
 * PDF: payments in period and the invoices each receipt was applied to.
 * @param {object} customer
 * @param {Array} paymentRows
 * @param {{ dateFrom?: string, dateTo?: string, generatedAt?: Date }} options
 */
export function downloadPaymentsToInvoicesPdf(customer, paymentRows, options = {}) {
  const { generatedAt = new Date() } = options;
  const list = Array.isArray(paymentRows) ? paymentRows : [];
  const customerName = String(customer?.name ?? '').trim() || 'Customer';
  const total = list.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const tableStartY = writePdfHeader(
    doc,
    'Payments → invoices',
    customer,
    options,
    'Each receipt, the invoices it settled, and any amount not applied to an open invoice.',
  );

  const body = list.map((row) => [
    dateCell(row.paymentDate),
    row.receipt || '—',
    row.methods || '—',
    formatLkr(row.amount),
    formatApplicationsLines(row.applications || [], (app) => {
      const named =
        app.unapplied && app.invoice && app.invoice !== 'Not applied to an invoice'
          ? `${app.invoice} (not applied)`
          : app.unapplied
            ? 'Not applied to an invoice'
            : app.invoice || 'Invoice';
      const when = !app.unapplied && app.invoiceDate ? ` (${dateCell(app.invoiceDate)})` : '';
      return `${named}${when}: ${formatLkr(app.amount)}`;
    }),
  ]);

  autoTable(doc, {
    head: [['Date', 'Receipt', 'Method', 'Payment (LKR)', 'Applied to invoices']],
    body: body.length > 0 ? body : [['—', '—', '—', '0.00', 'No payments in this period']],
    foot: [
      [
        '',
        '',
        `Totals (${list.length} payment${list.length === 1 ? '' : 's'})`,
        formatLkr(total),
        '',
      ],
    ],
    startY: tableStartY,
    margin: { top: tableStartY, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak', valign: 'top' },
    headStyles: {
      fillColor: [71, 85, 105],
      textColor: 255,
      fontStyle: 'bold',
      valign: 'middle',
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 28 },
      2: { cellWidth: 36 },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 'auto' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc);
  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`payments-to-invoices-${safeFilePart(customerName)}-${stamp}.pdf`);
}

/**
 * PDF: invoices in period and the payments applied to each.
 * @param {object} customer
 * @param {Array} invoiceRows
 * @param {{ dateFrom?: string, dateTo?: string, generatedAt?: Date }} options
 */
export function downloadInvoicesToPaymentsPdf(customer, invoiceRows, options = {}) {
  const { generatedAt = new Date() } = options;
  const list = Array.isArray(invoiceRows) ? invoiceRows : [];
  const customerName = String(customer?.name ?? '').trim() || 'Customer';
  const billed = list.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const applied = list.reduce((sum, row) => sum + (Number(row.paidTotal) || 0), 0);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const tableStartY = writePdfHeader(
    doc,
    'Invoices → payments',
    customer,
    options,
    'Each invoice and the payments applied to it (with amounts).',
  );

  const body = list.map((row) => [
    dateCell(row.invoiceDate),
    row.invoice || '—',
    row.amount > 0 ? formatLkr(row.amount) : '—',
    row.paidTotal > 0 ? formatLkr(row.paidTotal) : '—',
    formatApplicationsLines(row.payments || [], (p) => {
      const receipt = p.receipt ? `Receipt ${p.receipt}` : 'Payment';
      const when = p.paymentDate ? dateCell(p.paymentDate) : '';
      const method = p.methods ? ` · ${p.methods}` : '';
      return `${receipt}${when ? ` (${when})` : ''}${method}: ${formatLkr(p.amount)}`;
    }),
  ]);

  autoTable(doc, {
    head: [['Bill date', 'Invoice', 'Bill total (LKR)', 'Applied (LKR)', 'Payments applied']],
    body: body.length > 0 ? body : [['—', '—', '—', '—', 'No invoices in this period']],
    foot: [
      [
        '',
        `Totals (${list.length} invoice${list.length === 1 ? '' : 's'})`,
        formatLkr(billed),
        formatLkr(applied),
        '',
      ],
    ],
    startY: tableStartY,
    margin: { top: tableStartY, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak', valign: 'top' },
    headStyles: {
      fillColor: [71, 85, 105],
      textColor: 255,
      fontStyle: 'bold',
      valign: 'middle',
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 28 },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 'auto' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc);
  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`invoices-to-payments-${safeFilePart(customerName)}-${stamp}.pdf`);
}
