import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getCachedBrands, formatBrandLabel } from './brandTheme';
import { loadShopDetailsForPdf } from './paymentReceiptPdf';

const MARGIN = 16;
const BLACK = [0, 0, 0];
const MUTED = [40, 40, 40];

function display(v) {
  const s = String(v ?? '').trim();
  return s || '—';
}

function formatAmount(n) {
  return new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatDisplayDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function lineTotal(bags, unitPrice) {
  return Math.round((Number(bags) || 0) * (Number(unitPrice) || 0) * 100) / 100;
}

function buildLineItems(row) {
  const brands = getCachedBrands();
  const items = [];
  for (const brand of brands) {
    const bags = Number(row[`${brand.key}Bags`]) || 0;
    if (bags <= 0) continue;
    const unitPrice = Number(row[`${brand.key}UnitPrice`]) || 0;
    items.push({
      brandLabel: formatBrandLabel(brand) || brand.label,
      bags,
      unitPrice,
      amount: lineTotal(bags, unitPrice) || Number(row[`${brand.key}Line`]) || 0,
    });
  }
  return items;
}

function drawLetterhead(doc, opts, yStart) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = yStart;

  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...BLACK);
  doc.text(display(opts.shopName), MARGIN, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);

  if (opts.registrationNo) {
    doc.text(`( Reg. No: ${display(opts.registrationNo)} )`, MARGIN, y);
    y += 5;
  }
  const addressParts = [opts.addressLine1, opts.addressLine2].filter(Boolean);
  if (addressParts.length > 0) {
    doc.text(addressParts.join(', '), MARGIN, y);
    y += 5;
  }
  if (opts.email) {
    doc.text(`E-Mail : ${display(opts.email)}`, MARGIN, y);
    y += 5;
  }
  if (opts.contactNumber) {
    doc.text(`Tele : ${display(opts.contactNumber)}`, MARGIN, y);
    y += 5;
  }

  y += 2;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  return y + 8;
}

function underlineText(doc, text, x, y, options = {}) {
  doc.text(text, x, y, options);
  const w = doc.getTextWidth(text);
  const align = options.align || 'left';
  let x1 = x;
  if (align === 'center') x1 = x - w / 2;
  else if (align === 'right') x1 = x - w;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(x1, y + 0.8, x1 + w, y + 0.8);
}

/**
 * @param {object} row
 * @param {object} shop
 * @param {{ title?: string }} [opts]
 */
export function buildReturnInvoicePdf(row, shop = {}, opts = {}) {
  if (!row || typeof row !== 'object') return null;

  const kind = String(row.kind ?? '').trim();
  const isDamage = kind === 'damage';
  const title = opts.title || (isDamage ? 'DAMAGE INVOICE' : 'RETURN INVOICE');
  const invoiceNo = isDamage
    ? display(row.damageInvoiceNumber)
    : display(row.returnInvoiceNumber);
  const generatedAt = opts.generatedAt instanceof Date ? opts.generatedAt : new Date();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = drawLetterhead(doc, shop, 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  underlineText(doc, title, pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  doc.text(`Invoice No : ${invoiceNo}`, MARGIN, y);
  doc.text(`Date : ${formatDisplayDate(row.date)}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 7;

  const customerName = display(row.customerName);
  if (customerName !== '—') {
    doc.setFont('helvetica', 'bold');
    doc.text(isDamage ? 'Shop / destination :' : 'Credit to :', MARGIN, y);
    y += 5;
    doc.text(customerName.toUpperCase(), MARGIN, y);
    y += 7;
  }

  if (!isDamage && row.invoiceNumber) {
    doc.setFont('helvetica', 'normal');
    doc.text(`Against original invoice : ${display(row.invoiceNumber)}`, MARGIN, y);
    y += 6;
  }

  const lineItems = buildLineItems(row);
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const totalAmount = isDamage ? subtotal : Number(row.amount) || subtotal;

  const tableBody =
    lineItems.length > 0
      ? lineItems.map((item) => [
          item.brandLabel,
          String(item.bags),
          isDamage ? '—' : formatAmount(item.unitPrice),
          isDamage ? '—' : formatAmount(item.amount),
        ])
      : [[isDamage ? 'Damage write-off' : 'Return credit', '—', '—', formatAmount(totalAmount)]];

  autoTable(doc, {
    startY: y,
    head: [['Description', 'Qty (bags)', 'Price / bag (Rs)', 'Amount (Rs)']],
    body: tableBody,
    foot: [['Total', '', '', isDamage ? String(lineItems.reduce((s, i) => s + i.bags, 0)) : formatAmount(totalAmount)]],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 10,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.35,
      cellPadding: 2.5,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      halign: 'center',
    },
    footStyles: {
      fillColor: [245, 245, 245],
      textColor: BLACK,
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.42, halign: 'left' },
      1: { cellWidth: contentWidth * 0.16, halign: 'center' },
      2: { cellWidth: contentWidth * 0.2, halign: 'right' },
      3: { cellWidth: contentWidth * 0.22, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  y = (doc.lastAutoTable?.finalY || y) + 10;
  if (row.note) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const noteLines = doc.splitTextToSize(`Note: ${row.note}`, contentWidth);
    doc.text(noteLines, MARGIN, y);
    y += noteLines.length * 5 + 4;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  const ack = isDamage
    ? 'The above bags have been written off from sellable stock as damage items.'
    : 'This credit note reduces the customer ledger for the bags returned.';
  doc.text(doc.splitTextToSize(ack, contentWidth), MARGIN, y);

  const slug = String(invoiceNo).replace(/[^\w.-]+/g, '-');
  const stamp = generatedAt.toISOString().slice(0, 10);
  return {
    doc,
    filename: `${isDamage ? 'damage' : 'return'}-invoice-${slug}-${stamp}.pdf`,
  };
}

export function downloadReturnInvoicePdf(row, shop = {}, opts = {}) {
  const built = buildReturnInvoicePdf(row, shop, opts);
  if (!built) return;
  built.doc.save(built.filename);
}

export async function downloadReturnInvoiceForRow(row, opts = {}) {
  const shop = await loadShopDetailsForPdf();
  downloadReturnInvoicePdf(row, shop, opts);
}
