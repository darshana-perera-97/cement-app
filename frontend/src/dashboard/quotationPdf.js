import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
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

/** YYYY-MM-DD or Date → DD/MM/YYYY */
function formatDisplayDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
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

  y += 1;
  if (opts.dealerTagline) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...BLACK);
    doc.text(display(opts.dealerTagline), MARGIN, y);
    y += 5;
  }

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);

  return y + 8;
}

function lineTotal(item) {
  if (item?.lineTotal != null && item.lineTotal !== '') return Number(item.lineTotal) || 0;
  return (Number(item?.quantity) || 0) * (Number(item?.unitCost) || 0);
}

function conditionLines(conditions) {
  const c = conditions && typeof conditions === 'object' ? conditions : {};
  const lines = [];
  if (c.pricesSubjectToChange) {
    lines.push('Prices are subject to change until the order is confirmed.');
  }
  if (c.stockAvailability) {
    lines.push('Supply depends on stock availability at confirmation.');
  }
  if (c.quotationNotOrder) {
    lines.push('This quotation is an offer only and is not a confirmed order.');
  }
  if (c.vatAlsoAdded) {
    lines.push('VAT also added for this bill.');
  }
  return lines;
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

/**
 * Build an A4 quotation PDF.
 * @returns {{ doc: import('jspdf').jsPDF, filename: string } | null}
 */
export function buildQuotationPdf(quotation, opts = {}) {
  if (!quotation || typeof quotation !== 'object') return null;

  const shopName = String(opts.shopName || '').trim() || 'CS Store';
  const items = Array.isArray(quotation.items) ? quotation.items : [];
  const conditions =
    quotation.conditions && typeof quotation.conditions === 'object' ? quotation.conditions : {};
  const total =
    Number(quotation.totalAmount) ||
    items.reduce((sum, item) => sum + lineTotal(item), 0);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = drawLetterhead(
    doc,
    {
      shopName,
      registrationNo: opts.registrationNo,
      addressLine1: opts.addressLine1,
      addressLine2: opts.addressLine2,
      email: opts.email,
      contactNumber: opts.contactNumber,
      dealerTagline: opts.dealerTagline,
    },
    MARGIN + 4,
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...BLACK);
  underlineText(doc, 'QUOTATION', pageWidth / 2, y, { align: 'center' });
  y += 10;

  const leftX = MARGIN;
  const rightX = pageWidth / 2 + 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text('Quotation No.', leftX, y);
  doc.text('Date', rightX, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BLACK);
  doc.text(display(quotation.quotationNumber), leftX, y);
  doc.text(formatDisplayDate(quotation.date), rightX, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text('Customer', leftX, y);
  doc.text('Valid until', rightX, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BLACK);
  const customerLines = doc.splitTextToSize(display(quotation.customerName), contentWidth / 2 - 6);
  doc.text(customerLines, leftX, y);
  doc.text(formatDisplayDate(conditions.validUntil), rightX, y);
  y += Math.max(customerLines.length * 5, 5) + 6;

  const body = items.map((item, idx) => [
    String(idx + 1),
    display(item.product),
    String(Number(item.quantity) || 0),
    formatAmount(item.unitCost),
    formatAmount(lineTotal(item)),
  ]);

  if (body.length === 0) {
    body.push(['—', 'No items', '—', '—', '—']);
  }

  autoTable(doc, {
    startY: y,
    head: [['#', 'Item', 'Amount', 'Per item cost (LKR)', 'Line total (LKR)']],
    body,
    margin: { left: MARGIN, right: MARGIN },
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      textColor: BLACK,
      lineColor: [180, 180, 180],
      lineWidth: 0.2,
      cellPadding: 2.2,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: BLACK,
      fontStyle: 'bold',
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 38, halign: 'right' },
      4: { cellWidth: 36, halign: 'right' },
    },
    foot: [['', '', '', 'Total amount (LKR)', formatAmount(total)]],
    footStyles: {
      fillColor: [238, 242, 255],
      textColor: BLACK,
      fontStyle: 'bold',
      fontSize: 10,
      halign: 'right',
    },
  });

  y = (doc.lastAutoTable?.finalY || y) + 10;

  const pageHeight = doc.internal.pageSize.getHeight();
  const ensureSpace = (needed) => {
    if (y + needed <= pageHeight - 16) return;
    doc.addPage();
    y = MARGIN + 4;
  };

  ensureSpace(28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  underlineText(doc, 'TERMS & CONDITIONS', MARGIN, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...BLACK);

  if (conditions.paymentTerms) {
    const lines = doc.splitTextToSize(`Payment terms: ${conditions.paymentTerms}`, contentWidth);
    ensureSpace(lines.length * 5 + 2);
    doc.text(lines, MARGIN, y);
    y += lines.length * 5 + 2;
  }

  if (conditions.deliveryTerms) {
    const lines = doc.splitTextToSize(`Delivery terms: ${conditions.deliveryTerms}`, contentWidth);
    ensureSpace(lines.length * 5 + 2);
    doc.text(lines, MARGIN, y);
    y += lines.length * 5 + 2;
  }

  const bullets = conditionLines(conditions);
  for (const bullet of bullets) {
    const lines = doc.splitTextToSize(`• ${bullet}`, contentWidth);
    ensureSpace(lines.length * 5 + 1);
    doc.text(lines, MARGIN, y);
    y += lines.length * 5 + 1;
  }

  if (quotation.note) {
    y += 3;
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    underlineText(doc, 'NOTE', MARGIN, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const noteLines = doc.splitTextToSize(String(quotation.note), contentWidth);
    ensureSpace(noteLines.length * 5);
    doc.text(noteLines, MARGIN, y);
    y += noteLines.length * 5;
  }

  y += 14;
  ensureSpace(24);
  const sigW = Math.min(70, contentWidth / 2 - 8);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, y, MARGIN + sigW, y);
  doc.line(pageWidth - MARGIN - sigW, y, pageWidth - MARGIN, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('Prepared by', MARGIN, y);
  doc.text('Customer acknowledgement', pageWidth - MARGIN - sigW, y);

  addPageFooters(doc);

  const safeName = String(quotation.quotationNumber || quotation.id || 'quotation').replace(
    /[^\w.-]+/g,
    '_',
  );
  return { doc, filename: `${safeName}.pdf` };
}

/** Download an A4 quotation PDF. */
export function downloadQuotationPdf(quotation, opts = {}) {
  const built = buildQuotationPdf(quotation, opts);
  if (!built) return;
  built.doc.save(built.filename);
}

/** Create a blob URL for in-app preview. Caller must revoke with URL.revokeObjectURL. */
export function quotationPdfBlobUrl(quotation, opts = {}) {
  const built = buildQuotationPdf(quotation, opts);
  if (!built) return null;
  const blob = built.doc.output('blob');
  return { url: URL.createObjectURL(blob), filename: built.filename };
}
