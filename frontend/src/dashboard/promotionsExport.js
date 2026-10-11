import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { formatBrandLabel } from './brandTheme';

const MARGIN = 14;

const SPECIAL_PDF_HEAD = [
  ['Date', 'Customer', 'Type', 'Bill / Invoice', 'Amount (LKR)', 'Free bags', 'Bags detail', 'Reason'],
];
const SPECIAL_EXCEL_HEAD = [
  'Date',
  'Customer',
  'Type',
  'Bill / Invoice',
  'Amount (LKR)',
  'Free bags',
  'Bags detail',
  'Reason',
];

const RULE_PDF_HEAD = [['Customer', 'Start date', 'End date', 'Product', 'Cashback (LKR)']];
const RULE_EXCEL_HEAD = ['Customer', 'Start date', 'End date', 'Product', 'Cashback (LKR)'];

const TYPE_LABELS = {
  free_bags: 'Free bag issue',
  invoice_discount: 'Invoice discount',
  target_promotion: 'Target promotion',
  rule_cashback: 'Cashback',
};

function promoType(row) {
  const t = String(row?.type ?? '').trim();
  if (t === 'invoice_discount' || t === 'target_promotion' || t === 'rule_cashback') return t;
  return 'free_bags';
}

function promoTypeLabel(type) {
  return TYPE_LABELS[type] || TYPE_LABELS.free_bags;
}

function promoAmount(row) {
  const type = promoType(row);
  if (type === 'invoice_discount' || type === 'target_promotion') {
    return Number(row.discountAmount) || 0;
  }
  return 0;
}

function totalFreeBags(row, brands) {
  if (promoType(row) !== 'free_bags') return 0;
  return (Array.isArray(brands) ? brands : []).reduce(
    (sum, brand) => sum + (Number(row?.[`${brand.key}Bags`]) || 0),
    0,
  );
}

function bagsDetail(row, brands) {
  if (promoType(row) !== 'free_bags') return '';
  const parts = [];
  for (const brand of Array.isArray(brands) ? brands : []) {
    const bags = Number(row?.[`${brand.key}Bags`]) || 0;
    if (bags <= 0) continue;
    parts.push(`${formatBrandLabel(brand) || brand.label || brand.key}: ${bags}`);
  }
  return parts.join(', ');
}

function billLabel(row) {
  const invoice = String(row?.invoiceNumber ?? '').trim();
  if (invoice) return invoice;
  const bill = String(row?.billNumber ?? '').trim();
  return bill ? `#${bill}` : '';
}

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function display(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function fileSlug(options = {}) {
  const { dateFrom = '', dateTo = '', generatedAt = new Date() } = options;
  const rangeSlug =
    dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || 'all-dates';
  const safeDate = generatedAt.toISOString().slice(0, 10);
  return { rangeSlug, safeDate };
}

function specialTitle(options = {}) {
  const label = String(options.contentLabel ?? '').trim();
  if (!label || label === 'All types') return 'Special Promotions';
  return `Special Promotions: ${label}`;
}

function specialSheetName(options = {}) {
  const label = String(options.contentLabel ?? '').trim();
  if (!label || label === 'All types') return 'Special Promotions';
  return label.slice(0, 31);
}

function specialFileBase(options = {}) {
  const { rangeSlug, safeDate } = fileSlug(options);
  const content = String(options.contentSlug ?? '').trim();
  return content
    ? `special-promotions-${content}-${rangeSlug}-${safeDate}`
    : `special-promotions-${rangeSlug}-${safeDate}`;
}

function filterLine(options = {}) {
  const { dateFrom = '', dateTo = '', customer = '', search = '', contentLabel = '' } = options;
  const parts = [];
  const content = String(contentLabel ?? '').trim();
  if (content) parts.push(`Content: ${content}`);
  if (dateFrom && dateTo) parts.push(`Period: ${dateFrom} to ${dateTo}`);
  else if (dateFrom) parts.push(`From: ${dateFrom}`);
  else if (dateTo) parts.push(`To: ${dateTo}`);
  else parts.push('Period: all dates');
  parts.push(`Customer: ${customer || 'All'}`);
  const query = String(search ?? '').trim();
  if (query) parts.push(`Search: ${query}`);
  return parts.join(' · ');
}

function addPageFooters(doc, orientationLabel) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · ${orientationLabel}`, MARGIN, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }
}

function drawTitle(doc, title, options, summary) {
  const { generatedAt = new Date() } = options;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(title, MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, MARGIN, 22);
  const filterLines = doc.splitTextToSize(filterLine(options), doc.internal.pageSize.getWidth() - MARGIN * 2);
  doc.text(filterLines, MARGIN, 27);
  const summaryY = 27 + filterLines.length * 4;
  doc.text(summary, MARGIN, summaryY);
  doc.setTextColor(0, 0, 0);
  return summaryY + 6;
}

function specialBody(rows, brands) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const amount = promoAmount(row);
    const bags = totalFreeBags(row, brands);
    const type = promoType(row);
    return [
      display(row.date),
      display(row.customerName),
      promoTypeLabel(type),
      display(billLabel(row)),
      amount > 0 ? formatLkr(amount) : '-',
      type === 'free_bags' ? String(bags) : '-',
      display(bagsDetail(row, brands)),
      display(row.reason),
    ];
  });
}

function specialExcelBody(rows, brands) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const amount = promoAmount(row);
    const bags = totalFreeBags(row, brands);
    const type = promoType(row);
    return [
      String(row.date ?? '').slice(0, 10),
      String(row.customerName ?? '').trim(),
      promoTypeLabel(type),
      billLabel(row),
      amount > 0 ? amount : '',
      type === 'free_bags' ? bags : '',
      bagsDetail(row, brands),
      String(row.reason ?? '').trim(),
    ];
  });
}

function specialTotals(rows, brands) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    count: list.length,
    amount: list.reduce((sum, row) => sum + promoAmount(row), 0),
    bags: list.reduce((sum, row) => sum + totalFreeBags(row, brands), 0),
  };
}

/**
 * Download the filtered Special Promotions list as a PDF.
 * @param {Array} rows
 * @param {Array} brands
 * @param {{ dateFrom?: string, dateTo?: string, customer?: string, search?: string, contentLabel?: string, contentSlug?: string, generatedAt?: Date }} [options]
 */
export function downloadSpecialPromotionsPdf(rows, brands = [], options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totals = specialTotals(safeRows, brands);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const startY = drawTitle(
    doc,
    specialTitle(options),
    options,
    `${totals.count} promotion${totals.count === 1 ? '' : 's'} · Amount ${formatLkr(totals.amount)} LKR · Free bags ${totals.bags}`,
  );

  autoTable(doc, {
    head: SPECIAL_PDF_HEAD,
    body:
      safeRows.length > 0
        ? specialBody(safeRows, brands)
        : [['-', '-', '-', '-', '-', '-', '-', '-']],
    foot: [
      [
        '',
        '',
        '',
        `Total (${totals.count})`,
        formatLkr(totals.amount),
        String(totals.bags),
        '',
        '',
      ],
    ],
    startY,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc, 'A4 landscape');
  doc.save(`${specialFileBase(options)}.pdf`);
}

/**
 * Download the filtered Special Promotions list as an Excel workbook.
 * @param {Array} rows
 * @param {Array} brands
 * @param {{ dateFrom?: string, dateTo?: string, customer?: string, search?: string, contentLabel?: string, contentSlug?: string, generatedAt?: Date }} [options]
 */
export function downloadSpecialPromotionsExcel(rows, brands = [], options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const { generatedAt = new Date() } = options;
  const totals = specialTotals(safeRows, brands);
  const sheetData = [
    [specialTitle(options)],
    [filterLine(options)],
    [`Generated: ${generatedAt.toISOString()}`],
    [],
    SPECIAL_EXCEL_HEAD,
    ...specialExcelBody(safeRows, brands),
    [],
    ['', '', '', `Total (${totals.count})`, totals.amount, totals.bags, '', ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 28 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
    { wch: 36 },
    { wch: 42 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, specialSheetName(options));
  XLSX.writeFile(workbook, `${specialFileBase({ ...options, generatedAt })}.xlsx`);
}

/** Download Special Promotions as PDF and Excel from one click. */
export function downloadSpecialPromotions(rows, brands = [], options = {}) {
  downloadSpecialPromotionsPdf(rows, brands, options);
  window.setTimeout(() => downloadSpecialPromotionsExcel(rows, brands, options), 200);
}

function ruleBody(items) {
  return (Array.isArray(items) ? items : []).map((item) => [
    display(item.rule?.customerName),
    display(item.rule?.startDate),
    display(item.rule?.endDate),
    display(item.productLabel),
    formatLkr(item.amount),
  ]);
}

function ruleExcelBody(items) {
  return (Array.isArray(items) ? items : []).map((item) => [
    String(item.rule?.customerName ?? '').trim(),
    String(item.rule?.startDate ?? '').slice(0, 10),
    String(item.rule?.endDate ?? '').slice(0, 10),
    String(item.productLabel ?? '').trim(),
    Number(item.amount) || 0,
  ]);
}

/**
 * Download the filtered Promotion Rules list as a PDF.
 * @param {Array<{ rule: object, productLabel: string, amount: number }>} items
 * @param {{ dateFrom?: string, dateTo?: string, customer?: string, search?: string, generatedAt?: Date }} [options]
 */
export function downloadPromotionRulesPdf(items, options = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const startY = drawTitle(
    doc,
    'Promotion Rules',
    options,
    `${safeItems.length} product row${safeItems.length === 1 ? '' : 's'} · Cashback is the rate per product`,
  );

  autoTable(doc, {
    head: RULE_PDF_HEAD,
    body: safeItems.length > 0 ? ruleBody(safeItems) : [['—', '—', '—', '—', '—']],
    foot: [['', '', '', `Rows (${safeItems.length})`, '']],
    startY,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      4: { halign: 'right' },
    },
    showHead: 'everyPage',
  });

  addPageFooters(doc, 'A4 landscape');
  const { rangeSlug, safeDate } = fileSlug(options);
  doc.save(`promotion-rules-${rangeSlug}-${safeDate}.pdf`);
}

/**
 * Download the filtered Promotion Rules list as an Excel workbook.
 * @param {Array<{ rule: object, productLabel: string, amount: number }>} items
 * @param {{ dateFrom?: string, dateTo?: string, customer?: string, search?: string, generatedAt?: Date }} [options]
 */
export function downloadPromotionRulesExcel(items, options = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const { generatedAt = new Date() } = options;
  const sheetData = [
    ['Promotion Rules'],
    [filterLine(options)],
    [`Generated: ${generatedAt.toISOString()}`],
    ['Cashback is the rate per product, not a summed total.'],
    [],
    RULE_EXCEL_HEAD,
    ...ruleExcelBody(safeItems),
    [],
    ['', '', '', `Rows (${safeItems.length})`, ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [
    { wch: 28 },
    { wch: 14 },
    { wch: 14 },
    { wch: 36 },
    { wch: 18 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Promotion Rules');
  const { rangeSlug, safeDate } = fileSlug({ ...options, generatedAt });
  XLSX.writeFile(workbook, `promotion-rules-${rangeSlug}-${safeDate}.xlsx`);
}

/** Download Promotion Rules as PDF and Excel from one click. */
export function downloadPromotionRules(items, options = {}) {
  downloadPromotionRulesPdf(items, options);
  window.setTimeout(() => downloadPromotionRulesExcel(items, options), 200);
}
