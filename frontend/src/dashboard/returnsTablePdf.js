import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatBrandLabel, getCachedBrands } from './brandTheme';

const MARGIN = 14;

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function moneyCell(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '—';
  return `LKR ${formatLkr(v)}`;
}

function bagsOnRow(row, brands) {
  return (brands || []).reduce((s, b) => s + (Number(row?.[`${b.key}Bags`]) || 0), 0);
}

function bagsCell(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return v > 0 ? v.toLocaleString() : '—';
}

function kindLabel(row) {
  const kind = String(row?.kind ?? '').trim();
  if (kind === 'damage') return 'Damage items';
  if (kind === 'price_change') {
    return String(row.direction ?? '').trim() === 'up' ? 'Price increase' : 'Price drop';
  }
  const settlement = String(row.settlement ?? '').trim();
  if (settlement === 'damage') return 'Damage items';
  if (settlement === 'cash') return 'Cash return';
  return 'Return invoice';
}

function invoiceRef(row) {
  return (
    row?.returnInvoiceNumber ||
    row?.damageInvoiceNumber ||
    row?.invoiceNumber ||
    '—'
  );
}

function displayFilter(value, fallback = 'All') {
  const s = String(value ?? '').trim();
  return s || fallback;
}

function typeFilterLabel(kindFilter) {
  if (kindFilter === 'item_return') return 'Return items';
  if (kindFilter === 'damage') return 'Damage items';
  if (kindFilter === 'price_change') return 'Price changes';
  return 'All types';
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
 * Admin download of the Returns table. Filter values are printed above the table.
 */
export function downloadReturnsTablePdf(data = {}) {
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
  doc.text('Returns', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  doc.setTextColor(0, 0, 0);

  const filterBody = [
    ['Search', displayFilter(filters.search, 'None')],
    ['From date', displayFilter(filters.dateFrom)],
    ['To date', displayFilter(filters.dateTo)],
    ['Type', typeFilterLabel(filters.kindFilter)],
  ];

  autoTable(doc, {
    startY: 26,
    head: [['Filter', 'Value']],
    body: filterBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, valign: 'middle' },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold', textColor: [71, 85, 105] },
      1: { cellWidth: 80 },
    },
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: 112,
  });

  const tableStartY = (doc.lastAutoTable?.finalY || 46) + 6;
  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalBags = rows.reduce((s, r) => s + bagsOnRow(r, brands), 0);

  const body =
    rows.length === 0
      ? [['—', 'No rows match the current filters', '—', '—', '—', '—', '—']]
      : rows.map((r) => [
          String(r.date || '—'),
          String(r.customerName || '—'),
          kindLabel(r),
          String(invoiceRef(r)),
          moneyCell(r.amount),
          bagsCell(bagsOnRow(r, brands)),
          String(r.enteredBy || '—'),
        ]);

  autoTable(doc, {
    startY: tableStartY,
    head: [['Date', 'Shop', 'Type', 'Invoice', 'Amount', 'Bags', 'By']],
    body,
    foot:
      rows.length === 0
        ? undefined
        : [[
            'Total',
            `${rows.length} record${rows.length === 1 ? '' : 's'}`,
            '',
            '',
            moneyCell(totalAmount),
            bagsCell(totalBags),
            '',
          ]],
    styles: { fontSize: 8, cellPadding: 1.7, overflow: 'linebreak', valign: 'middle' },
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
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 52 },
      2: { cellWidth: 36 },
      3: { cellWidth: 38, font: 'courier', fontSize: 7.5 },
      4: { cellWidth: 36, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 30 },
    },
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
  });

  if (brands.some((b) => rows.some((r) => Number(r[`${b.key}Bags`]) > 0))) {
    const brandHead = ['Brand', 'Bags'];
    const brandBody = brands
      .map((b) => {
        const n = rows.reduce((s, r) => s + (Number(r[`${b.key}Bags`]) || 0), 0);
        return [formatBrandLabel(b) || b.label, bagsCell(n)];
      })
      .filter(([, n]) => n !== '—');
    if (brandBody.length > 0) {
      autoTable(doc, {
        startY: (doc.lastAutoTable?.finalY || tableStartY) + 8,
        head: [brandHead],
        body: brandBody,
        foot: [['All brands', bagsCell(totalBags)]],
        styles: { fontSize: 8, cellPadding: 1.6, valign: 'middle' },
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
        columnStyles: {
          0: { cellWidth: 70 },
          1: { cellWidth: 28, halign: 'right' },
        },
        margin: { left: MARGIN, right: MARGIN, bottom: 16 },
      });
    }
  }

  addPageFooters(doc);
  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`returns-${stamp}.pdf`);
}
