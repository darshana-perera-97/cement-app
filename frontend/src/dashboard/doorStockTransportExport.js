import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { resolveDoorStockExportSettings } from './doorStockTransportSettings';

const MARGIN = 14;

function display(v) {
  const s = String(v ?? '').trim();
  return s || '—';
}

function formatDisplayDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  }
  return s;
}

function formatReportDate(value = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getDate()}/${value.getMonth() + 1}/${value.getFullYear()}`;
  }
  return formatDisplayDate(value);
}

function formatAmount(n) {
  const v = Number(n) || 0;
  if (Number.isInteger(v)) return String(v);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
}

function fileSlug(options = {}) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const safeDate = generatedAt.toISOString().slice(0, 10);
  return { rangeSlug, safeDate };
}

function normalizeSettings(settings = {}, options = {}) {
  const resolved = resolveDoorStockExportSettings(settings, options);
  return {
    companyName: display(resolved.companyName),
    companyAddress: display(resolved.companyAddress),
    companyTel: display(resolved.companyTel),
    clientName: display(resolved.clientName),
    clientAddress: display(resolved.clientAddress),
    destination: display(resolved.to),
    bankAccountName: display(resolved.bankAccountName),
    bankAccountNumber: display(resolved.bankAccountNumber),
    bankName: display(resolved.bankName),
    bankBranch: display(resolved.bankBranch),
    nextInvoiceNumber: display(resolved.nextInvoiceNumber),
  };
}

function exportBodyRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r, i) => [
    String(i + 1),
    formatDisplayDate(r.invoiceDate),
    display(r.invoiceNumber),
    display(r.vehicleNumber),
    String(r.brandLabel ?? '').trim().toUpperCase() || '—',
    String(Number(r.quantity) || 0),
    formatAmount(r.tpRate),
    display(r.locationFrom),
    display(r.locationTo),
    formatAmount(r.amount),
  ]);
}

function totalAmount(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

/**
 * Download door step transport statement PDF (Shakya Transport layout).
 * @param {Array} rows — filtered door step rows
 * @param {object} settings — doorStockTransportSettings from shop
 * @param {object} [options]
 */
export function downloadDoorStockTransportPdf(rows, settings = {}, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const cfg = normalizeSettings(settings, { ...options, rows: safeRows });
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    brandLabel = '',
  } = options;
  const reportDate = formatReportDate(
    dateTo ? new Date(`${dateTo}T12:00:00`) : generatedAt,
  );
  const invoiceNo = cfg.nextInvoiceNumber !== '—' ? cfg.nextInvoiceNumber : '—';
  const total = totalAmount(safeRows);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(cfg.companyName !== '—' ? cfg.companyName : 'TRANSPORT', pageWidth / 2, y, {
    align: 'center',
  });
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (cfg.companyAddress !== '—') {
    doc.text(cfg.companyAddress, pageWidth / 2, y, { align: 'center' });
    y += 4.5;
  }
  if (cfg.companyTel !== '—') {
    doc.text(`Tel: ${cfg.companyTel}`, pageWidth / 2, y, { align: 'center' });
    y += 5;
  }

  doc.setFontSize(9);
  doc.text(`Date: ${reportDate}`, pageWidth - MARGIN, 16, { align: 'right' });
  doc.text(`Invoice No: ${invoiceNo}`, pageWidth - MARGIN, 21, { align: 'right' });

  y += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  if (cfg.clientName !== '—') {
    doc.text(cfg.clientName, MARGIN, y);
    y += 5;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (cfg.clientAddress !== '—') {
    const lines = doc.splitTextToSize(cfg.clientAddress, contentWidth * 0.55);
    doc.text(lines, MARGIN, y);
    y += lines.length * 4.5 + 3;
  } else {
    y += 2;
  }

  autoTable(doc, {
    startY: y,
    head: [
      [
        { content: 'SE.NO', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'DATE', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'INVOICE NO', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'VEHICLE NO', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'BRAND', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'QUANTITY', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'T/P RATE', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'LOCATION', colSpan: 2, styles: { halign: 'center' } },
        { content: 'AMOUNT', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      ],
      ['FROM', 'TO'],
    ],
    body: exportBodyRows(safeRows),
    foot: safeRows.length
      ? [
          [
            {
              content: 'TOTAL',
              colSpan: 9,
              styles: { halign: 'right', fontStyle: 'bold' },
            },
            {
              content: formatAmount(total),
              styles: { halign: 'right', fontStyle: 'bold' },
            },
          ],
        ]
      : undefined,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 1.8,
      lineColor: [0, 0, 0],
      lineWidth: 0.25,
      textColor: [0, 0, 0],
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'center',
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 18, halign: 'center' },
      5: { cellWidth: 16, halign: 'right' },
      6: { cellWidth: 16, halign: 'right' },
      7: { cellWidth: 22, halign: 'center' },
      8: { cellWidth: 22, halign: 'center' },
      9: { cellWidth: 20, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: contentWidth,
  });

  y = (doc.lastAutoTable?.finalY || y) + 10;
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 42) {
    doc.addPage();
    y = 16;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Bank account details', MARGIN, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const bankLines = [
    cfg.bankAccountName !== '—' ? `Name: ${cfg.bankAccountName}` : null,
    cfg.bankAccountNumber !== '—' ? `Account No: ${cfg.bankAccountNumber}` : null,
    cfg.bankName !== '—' ? `Bank: ${cfg.bankName}` : null,
    cfg.bankBranch !== '—' ? `Branch: ${cfg.bankBranch}` : null,
  ].filter(Boolean);
  for (const line of bankLines) {
    doc.text(line, MARGIN, y);
    y += 4.5;
  }

  const sigY = Math.max(y + 12, pageHeight - 28);
  const sigW = contentWidth / 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  ['PREPARED BY', 'CHECKED BY', 'AUTHORIZED BY'].forEach((label, i) => {
    const x = MARGIN + sigW * i + sigW / 2;
    doc.line(MARGIN + sigW * i + 4, sigY, MARGIN + sigW * (i + 1) - 4, sigY);
    doc.text(label, x, sigY + 5, { align: 'center' });
  });

  const filterParts = [];
  if (dateFrom && dateTo) filterParts.push(`${dateFrom} to ${dateTo}`);
  else if (dateFrom) filterParts.push(`from ${dateFrom}`);
  else if (dateTo) filterParts.push(`to ${dateTo}`);
  if (brandLabel) filterParts.push(brandLabel);
  if (filterParts.length) {
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    doc.text(filterParts.join(' · '), MARGIN, pageHeight - 6);
  }

  const { rangeSlug, safeDate } = fileSlug({ dateFrom, dateTo, generatedAt });
  doc.save(`door-step-transport-${rangeSlug}-${safeDate}.pdf`);
}

/** Download door step transport statement as Excel. */
export function downloadDoorStockTransportExcel(rows, settings = {}, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const cfg = normalizeSettings(settings, { ...options, rows: safeRows });
  const {
    generatedAt = new Date(),
    dateFrom = '',
    dateTo = '',
    brandLabel = '',
  } = options;
  const reportDate = formatReportDate(
    dateTo ? new Date(`${dateTo}T12:00:00`) : generatedAt,
  );
  const total = totalAmount(safeRows);

  const filterParts = [];
  if (dateFrom && dateTo) filterParts.push(`Period: ${dateFrom} to ${dateTo}`);
  if (brandLabel) filterParts.push(`Bag type: ${brandLabel}`);

  const sheetData = [
    [cfg.companyName !== '—' ? cfg.companyName : 'TRANSPORT'],
    ...(cfg.companyAddress !== '—' ? [[cfg.companyAddress]] : []),
    ...(cfg.companyTel !== '—' ? [[`Tel: ${cfg.companyTel}`]] : []),
    [],
    [`Date: ${reportDate}`, '', '', '', '', '', '', `Invoice No: ${cfg.nextInvoiceNumber}`],
    [],
    ...(cfg.clientName !== '—' ? [[cfg.clientName]] : []),
    ...(cfg.clientAddress !== '—' ? [[cfg.clientAddress]] : []),
    [],
    ...(filterParts.length ? [[filterParts.join(' · ')]] : []),
    [
      'SE.NO',
      'DATE',
      'INVOICE NO',
      'VEHICLE NO',
      'BRAND',
      'QUANTITY',
      'T/P RATE',
      'FROM',
      'TO',
      'AMOUNT',
    ],
    ...exportBodyRows(safeRows),
    ...(safeRows.length
      ? [['', '', '', '', '', '', '', '', 'TOTAL', formatAmount(total)]]
      : []),
    [],
    ['Bank account details'],
    ...(cfg.bankAccountName !== '—' ? [[`Name: ${cfg.bankAccountName}`]] : []),
    ...(cfg.bankAccountNumber !== '—' ? [[`Account No: ${cfg.bankAccountNumber}`]] : []),
    ...(cfg.bankName !== '—' ? [[`Bank: ${cfg.bankName}`]] : []),
    ...(cfg.bankBranch !== '—' ? [[`Branch: ${cfg.bankBranch}`]] : []),
    [],
    ['PREPARED BY', '', 'CHECKED BY', '', 'AUTHORIZED BY'],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Door Step Transport');
  const { rangeSlug, safeDate } = fileSlug({ dateFrom, dateTo, generatedAt });
  XLSX.writeFile(workbook, `door-step-transport-${rangeSlug}-${safeDate}.xlsx`);
}

/** Download both PDF and Excel. */
export function downloadDoorStockTransport(rows, settings, options = {}) {
  downloadDoorStockTransportPdf(rows, settings, options);
  downloadDoorStockTransportExcel(rows, settings, options);
}
