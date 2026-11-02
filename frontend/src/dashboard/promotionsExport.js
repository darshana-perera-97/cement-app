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
  const { dateFrom = '', dateTo = '', customer = '', search = '', contentLabel = '', itemLabel = '', hideCustomer = false } = options;
  const parts = [];
  const content = String(contentLabel ?? '').trim();
  if (content) parts.push(`Content: ${content}`);
  const items = String(itemLabel ?? '').trim();
  if (items) parts.push(`Items: ${items}`);
  if (dateFrom && dateTo) parts.push(`Period: ${dateFrom} to ${dateTo}`);
  else if (dateFrom) parts.push(`From: ${dateFrom}`);
  else if (dateTo) parts.push(`To: ${dateTo}`);
  else parts.push('Period: all dates');
  if (!hideCustomer) parts.push(`Customer: ${customer || 'All'}`);
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

const SHOP_PDF_HEAD = [['Shop name', 'Bag type', 'Free bags']];
const SHOP_EXCEL_HEAD = ['Shop name', 'Bag type', 'Free bags'];

function dateInRange(dateStr, from, to) {
  if (!from && !to) return true;
  const d = String(dateStr ?? '');
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function brandBags(record, brand) {
  if (!record || !brand) return 0;
  const field = brand.bagsField || `${brand.key}Bags`;
  return Number(record[field]) || 0;
}

function shopItemSlug(itemKeys, itemLabel) {
  if (itemLabel === 'All items') return 'all-items';
  const keys = (Array.isArray(itemKeys) ? itemKeys : [])
    .map((key) =>
      String(key)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean);
  if (keys.length === 0) return 'selected-items';
  const joined = keys.join('-');
  return joined.length > 48 ? `${keys.length}-items` : joined;
}

/**
 * Free bags grouped by shop and bag type.
 * @param {Array} rows
 * @param {Array} brands
 * @param {{ dateFrom?: string, dateTo?: string, itemKeys?: string[], allItems?: boolean, itemLabel?: string }} [options]
 */
export function buildShopWisePromotionReport(rows, brands = [], options = {}) {
  const dateFrom = String(options.dateFrom ?? '');
  const dateTo = String(options.dateTo ?? '');
  const brandList = Array.isArray(brands) ? brands : [];
  const selectedKeys = new Set(
    Array.isArray(options.itemKeys) ? options.itemKeys : brandList.map((brand) => brand.key),
  );
  const everyBrandSelected =
    brandList.length === 0 || brandList.every((brand) => selectedKeys.has(brand.key));
  const allItems = typeof options.allItems === 'boolean' ? options.allItems : everyBrandSelected;
  const groups = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (promoType(row) !== 'free_bags') continue;
    if (!dateInRange(row?.date, dateFrom, dateTo)) continue;
    const shop = String(row?.customerName ?? '').trim() || '—';
    const shopId = String(row?.customerId ?? '').trim();
    const groupKey = `${shopId}||${shop.toLowerCase()}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { shop, shopId, items: new Map() });
    const group = groups.get(groupKey);
    for (const brand of brandList) {
      if (!allItems && !selectedKeys.has(brand.key)) continue;
      const bags = brandBags(row, brand);
      if (bags <= 0) continue;
      const current = group.items.get(brand.key) || {
        key: brand.key,
        label: formatBrandLabel(brand) || brand.label || brand.key,
        bags: 0,
      };
      current.bags += bags;
      group.items.set(brand.key, current);
    }
  }

  const shopGroups = [...groups.values()]
    .map((group) => ({
      shop: group.shop,
      shopId: group.shopId,
      items: [...group.items.values()].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
      ),
    }))
    .filter((group) => group.items.length > 0)
    .sort(
      (a, b) => a.shop.localeCompare(b.shop, undefined, { sensitivity: 'base' }) || a.shopId.localeCompare(b.shopId),
    );

  const lines = [];
  let totalBags = 0;
  for (const group of shopGroups) {
    const shopBags = group.items.reduce((sum, item) => sum + item.bags, 0);
    group.items.forEach((item, index) => {
      lines.push({
        type: 'detail',
        shop: group.shop,
        shopId: group.shopId,
        shopRowSpan: index === 0 ? group.items.length : 0,
        item: item.label,
        itemKeys: [item.key],
        bags: item.bags,
      });
    });
    if (group.items.length > 1) {
      lines.push({
        type: 'shopTotal',
        shop: group.shop,
        shopId: group.shopId,
        shopRowSpan: 0,
        item: '',
        itemKeys: [],
        bags: shopBags,
      });
    }
    totalBags += shopBags;
  }

  const usedItemKeys = new Set(lines.flatMap((line) => line.itemKeys || []));
  const itemLabel = String(options.itemLabel ?? '').trim()
    || (allItems
      ? 'All items'
      : brandList
          .filter((brand) => usedItemKeys.has(brand.key))
          .map((brand) => formatBrandLabel(brand) || brand.label || brand.key)
          .join(', ') || 'No items');

  return {
    lines,
    shopCount: shopGroups.length,
    totalBags,
    itemLabel,
    dateFrom,
    dateTo,
  };
}

function shopPdfBody(lines) {
  return lines.map((line) => {
    if (line.type === 'shopTotal') {
      return [`${line.shop} total`, '', String(line.bags)];
    }
    const bags = String(line.bags);
    const item = display(line.item);
    if (line.shopRowSpan > 0) {
      return [{ content: line.shop, rowSpan: line.shopRowSpan, styles: { valign: 'middle' } }, item, bags];
    }
    return [item, bags];
  });
}

function shopWiseFileBase(report, options = {}) {
  const { rangeSlug, safeDate } = fileSlug({
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    generatedAt: options.generatedAt,
  });
  return `special-promotions-shop-wise-${shopItemSlug(options.itemKeys, report.itemLabel)}-${rangeSlug}-${safeDate}`;
}

function downloadShopWisePromotionsPdf(report, options = {}) {
  const lines = Array.isArray(report?.lines) ? report.lines : [];
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawTitle(
    doc,
    'Special Promotions — shop wise',
    {
      ...options,
      dateFrom: report.dateFrom,
      dateTo: report.dateTo,
      itemLabel: report.itemLabel,
      hideCustomer: true,
    },
    `${report.shopCount} shop${report.shopCount === 1 ? '' : 's'} · Free bags ${report.totalBags}`,
  );

  autoTable(doc, {
    head: SHOP_PDF_HEAD,
    body: lines.length > 0 ? shopPdfBody(lines) : [['-', '-', '-']],
    foot: [[`Total (${report.shopCount} shop${report.shopCount === 1 ? '' : 's'})`, '', String(report.totalBags)]],
    startY,
    margin: { top: 16, left: MARGIN, right: MARGIN, bottom: 16 },
    styles: { fontSize: 10, cellPadding: 2.2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      2: { halign: 'right' },
    },
    showHead: 'everyPage',
    didParseCell(data) {
      if (data.section !== 'body') return;
      const line = lines[data.row.index];
      if (line?.type !== 'shopTotal') return;
      data.cell.styles.fillColor = [226, 232, 240];
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.textColor = [15, 23, 42];
    },
  });

  addPageFooters(doc, 'A4 portrait');
  doc.save(`${shopWiseFileBase(report, options)}.pdf`);
}

function downloadShopWisePromotionsExcel(report, options = {}) {
  const lines = Array.isArray(report?.lines) ? report.lines : [];
  const { generatedAt = new Date() } = options;
  const body = lines.map((line) => {
    if (line.type === 'shopTotal') return [`${line.shop} total`, '', line.bags];
    return [line.shopRowSpan > 0 ? line.shop : '', line.item, line.bags];
  });
  const sheetData = [
    ['Special Promotions — shop wise'],
    [
      filterLine({
        dateFrom: report.dateFrom,
        dateTo: report.dateTo,
        itemLabel: report.itemLabel,
        hideCustomer: true,
      }),
    ],
    [`Generated: ${generatedAt.toISOString()}`],
    [],
    SHOP_EXCEL_HEAD,
    ...body,
    [],
    [`Total (${report.shopCount} shop${report.shopCount === 1 ? '' : 's'})`, '', report.totalBags],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  const merges = [];
  const dataStart = 5;
  lines.forEach((line, index) => {
    if (line.type === 'detail' && line.shopRowSpan > 1) {
      merges.push({
        s: { r: dataStart + index, c: 0 },
        e: { r: dataStart + index + line.shopRowSpan - 1, c: 0 },
      });
    }
  });
  if (merges.length > 0) worksheet['!merges'] = merges;
  worksheet['!cols'] = [{ wch: 32 }, { wch: 42 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Shop wise');
  XLSX.writeFile(workbook, `${shopWiseFileBase(report, { ...options, generatedAt })}.xlsx`);
}

/** Download the shop-wise free bag list as PDF and Excel. */
export function downloadShopWisePromotions(rows, brands = [], options = {}) {
  const report = buildShopWisePromotionReport(rows, brands, options);
  downloadShopWisePromotionsPdf(report, options);
  window.setTimeout(() => downloadShopWisePromotionsExcel(report, options), 200);
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
