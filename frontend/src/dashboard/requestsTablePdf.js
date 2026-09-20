import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getCachedBrands } from './brandTheme';
import { getPaymentCheques, getPaymentCdmDeposits, getPaymentOnlineTransfers } from './paymentCheques';

const MARGIN = 14;

function money(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function displayFilter(value, fallback = 'All') {
  const s = String(value ?? '').trim();
  return s || fallback;
}

export function requestTypeLabel(row) {
  if (row?.requestKind === 'payment') return 'Payment approval';
  if (row?.priceChangeRequest) return 'Unload price change';
  return 'Unload';
}

export function requestTypeFilterLabel(typeFilter) {
  if (typeFilter === 'unload') return 'Unload';
  if (typeFilter === 'price_change') return 'Unload price change';
  if (typeFilter === 'payment') return 'Payment approval';
  return 'All types';
}

function bagLines(row, brands) {
  return (brands || [])
    .filter((b) => (Number(row?.[`${b.key}Bags`]) || 0) > 0)
    .map((b) => `${b.label} ${Number(row[`${b.key}Bags`])}`)
    .join(', ');
}

function bankAccountSnapLabel(snap, fallbackId = '') {
  if (snap && typeof snap === 'object') {
    const nick = String(snap.nickName ?? '').trim();
    const detail = [snap.bank, snap.accountNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
    if (nick && detail) return `${nick} — ${detail}`;
    return nick || detail || fallbackId || '—';
  }
  return fallbackId || '—';
}

function paymentRequestSummary(row) {
  const parts = [];
  for (const d of getPaymentCdmDeposits(row)) {
    const bank = bankAccountSnapLabel(d.bankAccount, d.bankAccountId);
    parts.push(
      `CDM ${money(d.amount)}${d.cdmNumber ? ` · ${d.cdmNumber}` : ''}${d.cdmDate ? ` · ${d.cdmDate}` : ''}${bank !== '—' ? ` · ${bank}` : ''}`,
    );
  }
  for (const t of getPaymentOnlineTransfers(row)) {
    const bank = bankAccountSnapLabel(t.bankAccount, t.bankAccountId);
    parts.push(
      `Online ${money(t.amount)}${t.reference ? ` · ${t.reference}` : ''}${t.transferDate ? ` · ${t.transferDate}` : ''}${bank !== '—' ? ` · ${bank}` : ''}`,
    );
  }
  const cheques = getPaymentCheques(row);
  if (cheques.length > 0) {
    parts.push(`${cheques.length} cheque${cheques.length === 1 ? '' : 's'}`);
  }
  const cash = Number(row.cashAmount) || 0;
  if (cash > 0) parts.push(`Cash ${money(cash)}`);
  return parts.join(' · ') || money(row.amount);
}

function detailsForRow(row, brands) {
  if (row?.requestKind === 'payment') return paymentRequestSummary(row);
  const bags = bagLines(row, brands);
  return [row?.driverName, bags].filter(Boolean).join(' · ') || '—';
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
 * Admin download of the Requests table. Filter values are printed above the table.
 */
export function downloadRequestsTablePdf(data = {}) {
  const {
    rows = [],
    filters = {},
    generatedAt = new Date(),
  } = data;
  const brands = Array.isArray(data.brands) && data.brands.length > 0 ? data.brands : getCachedBrands();

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Requests', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    startY: 26,
    head: [['Filter', 'Value']],
    body: [
      ['Search', displayFilter(filters.search, 'None')],
      ['From date', displayFilter(filters.dateFrom)],
      ['To date', displayFilter(filters.dateTo)],
      ['Type', requestTypeFilterLabel(filters.typeFilter)],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, valign: 'middle' },
    headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 'auto' } },
  });

  const startY = (doc.lastAutoTable?.finalY || 40) + 6;
  const body = rows.map((row) => [
    String(row.date || '—'),
    requestTypeLabel(row),
    String(row.customerName || '—'),
    detailsForRow(row, brands),
    String(row.recordedBy || row.driverName || '—'),
  ]);

  autoTable(doc, {
    startY,
    head: [['Date', 'Type', 'Shop', 'Details', 'By']],
    body: body.length > 0 ? body : [['—', '—', 'No matching requests', '—', '—']],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.8, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 38 },
      2: { cellWidth: 48 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 32 },
    },
  });

  addPageFooters(doc);
  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`requests-${stamp}.pdf`);
}
