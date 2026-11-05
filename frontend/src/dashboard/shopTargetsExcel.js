import * as XLSX from 'xlsx';
import { formatReportItemLabel } from './brandTheme';

function itemLabel(brand) {
  return formatReportItemLabel(brand) || brand.label || brand.key;
}

function bagCount(n) {
  return Math.round(Number(n) || 0);
}

function percentCell(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  return Number(pct);
}

/**
 * Shop targets Excel: same columns as the on-screen table and PDF.
 * Item columns with no sales, and free-bag columns with no free bags, are omitted.
 */
export function downloadShopTargetsExcel(data, options = {}) {
  const {
    monthLabel = '',
    rows = [],
    totals = { byBrand: {}, freeByBrand: {}, total: 0, freeBags: 0, monthlyTargetBags: 0 },
    overallProgressPct = null,
    soldBrands = [],
    freeBrands = [],
    generatedAt = new Date(),
  } = data;
  const { monthSlug = '' } = options;
  const safeRows = Array.isArray(rows) ? rows : [];

  const head = [
    'Shop name',
    ...soldBrands.map((b) => `${itemLabel(b)} bags`),
    'Total bags',
    ...freeBrands.map((b) => `${itemLabel(b)} free`),
    'Total free bags',
    'Monthly target',
    'Completed %',
  ];

  const body = safeRows.map((r) => [
    r.shop || '—',
    ...soldBrands.map((b) => bagCount(r.byBrand?.[b.key])),
    bagCount(r.total),
    ...freeBrands.map((b) => bagCount(r.freeByBrand?.[b.key])),
    bagCount(r.freeBags),
    r.monthlyTargetBags > 0 ? bagCount(r.monthlyTargetBags) : '',
    percentCell(r.progressPct),
  ]);

  const foot =
    safeRows.length === 0
      ? []
      : [
          [
            `Total (${safeRows.length} shop${safeRows.length === 1 ? '' : 's'})`,
            ...soldBrands.map((b) => bagCount(totals.byBrand?.[b.key])),
            bagCount(totals.total),
            ...freeBrands.map((b) => bagCount(totals.freeByBrand?.[b.key])),
            bagCount(totals.freeBags),
            totals.monthlyTargetBags > 0 ? bagCount(totals.monthlyTargetBags) : '',
            percentCell(overallProgressPct),
          ],
        ];

  const sheetData = [
    ['Shop Targets'],
    [`Month: ${monthLabel}`],
    [
      `Generated: ${generatedAt.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })}`,
    ],
    ['Sales columns appear only for items someone bought. Free bags are shown per item, plus the total.'],
    [],
    head,
    ...body,
    ...(foot.length ? [[], ...foot] : []),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = head.map((label, index) => ({
    wch: index === 0 ? 28 : Math.max(14, String(label).length + 2),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Shop targets');
  const slug = monthSlug || generatedAt.toISOString().slice(0, 7);
  XLSX.writeFile(workbook, `shop-targets-${slug}.xlsx`);
}
