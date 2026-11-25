import { jsPDF } from 'jspdf';
import {
  cashPortion,
  cdmPortion,
  chequePortion,
  getPaymentCdmDeposits,
  getPaymentCheques,
  getPaymentOnlineTransfers,
  onlineTransferPortion,
} from './paymentCheques';
import {
  getPaymentReceiptInvoices,
  invoiceAmountWithPriorBalance,
  isReturnChequeEffect,
  receiptInvoiceTitle,
} from './paymentReceipt';

const PAGE_MARGIN = 7;
const COLS = 3;
const COL_GAP = 3.5;
const ROW_GAP = 3.5;
const STRIP_PAD_X = 2.6;
const STRIP_PAD_Y = 2.8;
const FONT_SIZE = 6.8;
const SMALL_SIZE = 6.2;
const TITLE_SIZE = 8;
const SECTION_SIZE = 6.6;
const LINE_STEP = 3.45;
const SECTION_GAP = 1.8;
const RULE_GAP = 1.6;

const BLACK = [15, 23, 42];
const MUTED = [100, 116, 139];
const LINE = [203, 213, 225];
const BORDER = [100, 116, 139];
const TOTAL_BG = [241, 245, 249];

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
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }
  return display(s);
}

/** Sort / range key for alphanumeric receipt numbers (uses trailing digits when present). */
export function billNumberSortKey(billNumber) {
  const s = String(billNumber ?? '').trim();
  if (!s) return { prefix: '', num: -1, raw: '' };
  const match = s.match(/^(.*?)(\d+)$/);
  if (!match) return { prefix: s.toLowerCase(), num: -1, raw: s.toLowerCase() };
  return {
    prefix: match[1].toLowerCase(),
    num: parseInt(match[2], 10) || 0,
    raw: s.toLowerCase(),
  };
}

export function compareBillNumbers(a, b) {
  const ka = billNumberSortKey(a);
  const kb = billNumberSortKey(b);
  if (ka.prefix !== kb.prefix) return ka.prefix.localeCompare(kb.prefix);
  if (ka.num !== kb.num) return ka.num - kb.num;
  return ka.raw.localeCompare(kb.raw);
}

export function inBillNumberRange(billNumber, from, to) {
  const fromVal = String(from ?? '').trim();
  const toVal = String(to ?? '').trim();
  if (!fromVal && !toVal) return true;
  const value = String(billNumber ?? '').trim();
  if (!value) return false;
  if (fromVal && compareBillNumbers(value, fromVal) < 0) return false;
  if (toVal && compareBillNumbers(value, toVal) > 0) return false;
  return true;
}

function cell(text, opts = {}) {
  return {
    text: String(text ?? ''),
    flex: opts.flex ?? 0,
    width: opts.width ?? 0,
    align: opts.align || 'left',
    muted: Boolean(opts.muted),
  };
}

function buildStripLines(payment) {
  const cash = cashPortion(payment);
  const cheque = chequePortion(payment);
  const cdm = cdmPortion(payment);
  const online = onlineTransferPortion(payment);
  const cheques = getPaymentCheques(payment);
  const cdmDeposits = getPaymentCdmDeposits(payment);
  const onlineTransfers = getPaymentOnlineTransfers(payment);
  const cancelled = Boolean(payment?.cancelled);

  const lines = [
    { kind: 'header', title: 'PAYMENT RECEIPT', subtitle: `No. ${display(payment?.billNumber)}`, cancelled },
    { kind: 'rule' },
    {
      kind: 'cells',
      items: [
        cell('Date', { flex: 1, muted: true }),
        cell(formatDisplayDate(payment?.date), { flex: 1.35, align: 'right' }),
      ],
    },
    {
      kind: 'cells',
      items: [
        cell('Customer', { flex: 0.95, muted: true }),
        cell(display(payment?.customerName), { flex: 1.4, align: 'right' }),
      ],
    },
    {
      kind: 'cells',
      items: [
        cell('Customer ID', { flex: 1, muted: true }),
        cell(display(payment?.customerId), { flex: 1.35, align: 'right' }),
      ],
    },
    { kind: 'rule' },
    { kind: 'section', text: 'AMOUNT RECEIVED' },
    {
      kind: 'cells',
      bold: true,
      size: SMALL_SIZE,
      items: [
        cell('Mode', { flex: 1.45, muted: true }),
        cell('Amount (Rs)', { flex: 1, align: 'right', muted: true }),
      ],
    },
  ];

  const methodRows = [];
  if (cash > 0) methodRows.push(['Cash', formatAmount(cash)]);
  if (cheque > 0) methodRows.push(['Cheque', formatAmount(cheque)]);
  if (cdm > 0) methodRows.push(['CDM deposit', formatAmount(cdm)]);
  if (online > 0) methodRows.push(['Online transfer', formatAmount(online)]);
  if (methodRows.length === 0) methodRows.push(['Received', formatAmount(payment?.amount)]);
  for (const [mode, amount] of methodRows) {
    lines.push({
      kind: 'cells',
      items: [cell(mode, { flex: 1.45 }), cell(amount, { flex: 1, align: 'right' })],
    });
  }

  lines.push({
    kind: 'total',
    items: [
      cell('TOTAL RECEIVED', { flex: 1.45 }),
      cell(formatAmount(payment?.amount), { flex: 1, align: 'right' }),
    ],
  });

  if (cheques.length > 0) {
    lines.push({ kind: 'section', text: cheques.length === 1 ? 'CHEQUE DETAILS' : 'CHEQUES' });
    lines.push({
      kind: 'cells',
      bold: true,
      size: SMALL_SIZE,
      items: [
        cell('Bank', { flex: 1, muted: true }),
        cell('No', { flex: 0.85, muted: true }),
        cell('Date', { flex: 1, muted: true }),
        cell('Amt', { flex: 1, align: 'right', muted: true }),
      ],
    });
    for (const c of cheques) {
      const bankShort = String(c.chequeBank ?? '').trim().slice(0, 8) || '—';
      lines.push({
        kind: 'cells',
        size: SMALL_SIZE,
        items: [
          cell(bankShort, { flex: 1 }),
          cell(c.chequeNumber ? `#${c.chequeNumber}` : '—', { flex: 0.85 }),
          cell(c.chequeDate ? formatDisplayDate(c.chequeDate) : '—', { flex: 1 }),
          cell(formatAmount(c.amount), { flex: 1, align: 'right' }),
        ],
      });
    }
  }

  if (cdmDeposits.length > 0) {
    lines.push({ kind: 'section', text: cdmDeposits.length === 1 ? 'CDM DETAILS' : 'CDM DEPOSITS' });
    lines.push({
      kind: 'cells',
      bold: true,
      size: SMALL_SIZE,
      items: [
        cell('Ref', { flex: 1, muted: true }),
        cell('Date', { flex: 1, muted: true }),
        cell('Amt', { flex: 1, align: 'right', muted: true }),
      ],
    });
    for (const d of cdmDeposits) {
      lines.push({
        kind: 'cells',
        size: SMALL_SIZE,
        items: [
          cell(d.cdmNumber ? `#${d.cdmNumber}` : '—', { flex: 1 }),
          cell(d.cdmDate ? formatDisplayDate(d.cdmDate) : '—', { flex: 1 }),
          cell(formatAmount(d.amount), { flex: 1, align: 'right' }),
        ],
      });
    }
  }

  if (onlineTransfers.length > 0) {
    lines.push({
      kind: 'section',
      text: onlineTransfers.length === 1 ? 'TRANSFER DETAILS' : 'ONLINE TRANSFERS',
    });
    lines.push({
      kind: 'cells',
      bold: true,
      size: SMALL_SIZE,
      items: [
        cell('Ref', { flex: 1, muted: true }),
        cell('Date', { flex: 1, muted: true }),
        cell('Amt', { flex: 1, align: 'right', muted: true }),
      ],
    });
    for (const t of onlineTransfers) {
      lines.push({
        kind: 'cells',
        size: SMALL_SIZE,
        items: [
          cell(t.reference ? `#${t.reference}` : '—', { flex: 1 }),
          cell(t.transferDate ? formatDisplayDate(t.transferDate) : '—', { flex: 1 }),
          cell(formatAmount(t.amount), { flex: 1, align: 'right' }),
        ],
      });
    }
  }

  const invoices = getPaymentReceiptInvoices(payment);
  if (invoices.length > 0) {
    const onlyReturnCheque = invoices.every((inv) => isReturnChequeEffect(inv));
    lines.push({ kind: 'section', text: onlyReturnCheque ? 'RETURN CHEQUE' : 'INVOICES' });
    lines.push({
      kind: 'cells',
      bold: true,
      size: SMALL_SIZE,
      items: [
        cell(onlyReturnCheque ? 'Return' : 'Invoice', { flex: 1.25, muted: true }),
        cell('Date', { flex: 0.9, muted: true }),
        cell('Settled', { flex: 1, align: 'right', muted: true }),
        cell('Rem', { flex: 0.85, align: 'right', muted: true }),
      ],
    });
    for (const inv of invoices) {
      const amtLabel =
        inv.appliedAmount > 0
          ? formatAmount(inv.appliedAmount)
          : inv.billTotal > 0
            ? invoiceAmountWithPriorBalance(inv, formatAmount)
            : '—';
      lines.push({
        kind: 'cells',
        size: SMALL_SIZE,
        items: [
          cell(receiptInvoiceTitle(inv, { onlyReturnCheque }), { flex: 1.25 }),
          cell(inv.date ? formatDisplayDate(inv.date) : '—', { flex: 0.9 }),
          cell(amtLabel, { flex: 1, align: 'right' }),
          cell(inv.remainingAfter == null ? '—' : formatAmount(inv.remainingAfter), {
            flex: 0.85,
            align: 'right',
          }),
        ],
      });
    }
  }

  return lines;
}

function fitText(doc, text, maxWidth) {
  const raw = String(text ?? '');
  if (!raw) return '';
  if (doc.getTextWidth(raw) <= maxWidth) return raw;
  let out = raw;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function lineHeight(line) {
  if (line.kind === 'blank') return LINE_STEP * 0.45;
  if (line.kind === 'rule') return RULE_GAP * 2;
  if (line.kind === 'header') {
    return LINE_STEP * 0.95 + LINE_STEP * 0.55 + FONT_SIZE * 0.38 + 1.55 + (line.cancelled ? LINE_STEP * 0.85 : 0);
  }
  if (line.kind === 'section') return SECTION_GAP + LINE_STEP;
  if (line.kind === 'total') return LINE_STEP + 1.4;
  const size = line.size || FONT_SIZE;
  return size * 0.38 + 1.55;
}

function measureStripHeight(lines) {
  let h = STRIP_PAD_Y * 2;
  for (const line of lines) h += lineHeight(line);
  return h;
}

function layoutCellWidths(items, totalWidth) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const fixed = list.reduce((sum, item) => sum + (Number(item.width) || 0), 0);
  const flexTotal = list.reduce((sum, item) => sum + (Number(item.flex) || 0), 0) || list.length;
  const remaining = Math.max(totalWidth - fixed, 0);
  return list.map((item) => {
    if (Number(item.width) > 0) return Number(item.width);
    const flex = Number(item.flex) || 1;
    return (remaining * flex) / flexTotal;
  });
}

function drawCells(doc, items, x, y, width, { bold = false, size = FONT_SIZE } = {}) {
  const widths = layoutCellWidths(items, width);
  let cx = x;
  items.forEach((item, index) => {
    const colW = widths[index] || 0;
    const pad = 0.45;
    const textW = Math.max(colW - pad * 2, 1);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(item.muted ? MUTED : BLACK));
    const text = fitText(doc, item.text, textW);
    const align = item.align || 'left';
    if (align === 'right') {
      doc.text(text, cx + colW - pad, y, { align: 'right' });
    } else if (align === 'center') {
      doc.text(text, cx + colW / 2, y, { align: 'center' });
    } else {
      doc.text(text, cx + pad, y);
    }
    cx += colW;
  });
  doc.setTextColor(...BLACK);
}

function drawHairline(doc, x1, y, x2) {
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.22);
  doc.line(x1, y, x2, y);
}

/** Small cutting cross at a corner (no receipt outline). */
function drawCutCross(doc, cx, cy) {
  const arm = 1.6;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(cx - arm, cy, cx + arm, cy);
  doc.line(cx, cy - arm, cx, cy + arm);
}

function drawStripCutMarks(doc, x, y, width, height) {
  drawCutCross(doc, x, y);
  drawCutCross(doc, x + width, y);
  drawCutCross(doc, x, y + height);
  drawCutCross(doc, x + width, y + height);
}

function drawStrip(doc, payment, x, y, width) {
  const lines = buildStripLines(payment);
  const height = measureStripHeight(lines);
  const innerW = width - STRIP_PAD_X * 2;
  let cy = y + STRIP_PAD_Y;

  drawStripCutMarks(doc, x, y, width, height);

  for (const line of lines) {
    if (line.kind === 'blank') {
      cy += lineHeight(line);
      continue;
    }

    if (line.kind === 'header') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(TITLE_SIZE);
      doc.setTextColor(...BLACK);
      doc.text(fitText(doc, line.title, innerW), x + width / 2, cy, { align: 'center' });
      cy += LINE_STEP * 0.95;
      doc.setFontSize(FONT_SIZE);
      doc.text(fitText(doc, line.subtitle, innerW), x + width / 2, cy, { align: 'center' });
      if (line.cancelled) {
        cy += LINE_STEP * 0.85;
        doc.setTextColor(185, 28, 28);
        doc.setFontSize(SMALL_SIZE);
        doc.text('CANCELLED', x + width / 2, cy, { align: 'center' });
        doc.setTextColor(...BLACK);
      }
      cy += LINE_STEP * 0.55;
      continue;
    }

    if (line.kind === 'rule') {
      cy += RULE_GAP;
      drawHairline(doc, x + STRIP_PAD_X, cy, x + width - STRIP_PAD_X);
      cy += RULE_GAP;
      continue;
    }

    if (line.kind === 'section') {
      cy += SECTION_GAP;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(SECTION_SIZE);
      doc.setTextColor(...BLACK);
      const label = fitText(doc, line.text, innerW);
      doc.text(label, x + STRIP_PAD_X, cy);
      const labelW = doc.getTextWidth(label);
      doc.setDrawColor(...BLACK);
      doc.setLineWidth(0.28);
      doc.line(x + STRIP_PAD_X, cy + 0.55, x + STRIP_PAD_X + labelW, cy + 0.55);
      cy += LINE_STEP;
      continue;
    }

    if (line.kind === 'total') {
      const bandTop = cy - 1.8;
      const bandH = LINE_STEP + 1.6;
      doc.setFillColor(...TOTAL_BG);
      doc.rect(x + 0.35, bandTop, width - 0.7, bandH, 'F');
      drawCells(doc, line.items || [], x + STRIP_PAD_X, cy + 0.35, innerW, {
        bold: true,
        size: FONT_SIZE,
      });
      cy += bandH;
      continue;
    }

    const size = line.size || FONT_SIZE;
    if (line.kind === 'cells') {
      drawCells(doc, line.items || [], x + STRIP_PAD_X, cy, innerW, {
        bold: Boolean(line.bold),
        size,
      });
    } else if (line.kind === 'center') {
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...BLACK);
      doc.text(fitText(doc, line.text, innerW), x + width / 2, cy, { align: 'center' });
    } else {
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...BLACK);
      doc.text(fitText(doc, line.text, innerW), x + STRIP_PAD_X, cy);
    }
    cy += lineHeight(line);
  }

  return height;
}

function addPageFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setTextColor(...MUTED);
    doc.text(`${i} / ${pageCount}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
    doc.setTextColor(...BLACK);
  }
}

/**
 * Download filtered payments as A4 PDF with thermal-style receipt strips,
 * 3 columns per row.
 * @param {{ rows?: Array, filters?: object, generatedAt?: Date }} data
 */
export function downloadPaymentsListPdf(data = {}) {
  const { rows = [], generatedAt = new Date() } = data;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - PAGE_MARGIN * 2;
  const colWidth = (usableWidth - COL_GAP * (COLS - 1)) / COLS;
  const footerReserve = 10;

  let y = PAGE_MARGIN;

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text('No payments match the selected filters.', pageWidth / 2, pageHeight / 2, {
      align: 'center',
    });
    addPageFooters(doc);
    const safeDate = generatedAt.toISOString().slice(0, 10);
    doc.save(`payments-list-${safeDate}.pdf`);
    return;
  }

  let col = 0;
  let rowMaxHeight = 0;

  for (const payment of rows) {
    const lines = buildStripLines(payment);
    const needed = measureStripHeight(lines);

    if (y + needed > pageHeight - footerReserve) {
      doc.addPage();
      y = PAGE_MARGIN;
      col = 0;
      rowMaxHeight = 0;
    }

    const x = PAGE_MARGIN + col * (colWidth + COL_GAP);
    const drawn = drawStrip(doc, payment, x, y, colWidth);
    rowMaxHeight = Math.max(rowMaxHeight, drawn);
    col += 1;

    if (col >= COLS) {
      y += rowMaxHeight + ROW_GAP;
      col = 0;
      rowMaxHeight = 0;
    }
  }

  addPageFooters(doc);
  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`payments-list-${safeDate}.pdf`);
}
