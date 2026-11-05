import * as XLSX from 'xlsx';
import { downloadShopTargetsExcel } from './shopTargetsExcel';

describe('shop targets excel', () => {
  test('writes the same item columns as the table, including free bags and the total', () => {
    const writeFile = jest.spyOn(XLSX, 'writeFile').mockImplementation(() => {});
    const soldBrands = [{ key: 'tokyo', label: 'Tokyo' }];
    const freeBrands = [
      { key: 'tokyo', label: 'Tokyo' },
      { key: 'holcim', label: 'Holcim' },
    ];

    downloadShopTargetsExcel(
      {
        monthLabel: 'November 2026',
        rows: [
          {
            shop: 'Lake Shop',
            byBrand: { tokyo: 20 },
            freeByBrand: { tokyo: 7, holcim: 2 },
            total: 20,
            freeBags: 9,
            monthlyTargetBags: 100,
            progressPct: 20,
          },
        ],
        totals: {
          byBrand: { tokyo: 20 },
          freeByBrand: { tokyo: 7, holcim: 2 },
          total: 20,
          freeBags: 9,
          monthlyTargetBags: 100,
        },
        overallProgressPct: 20,
        soldBrands,
        freeBrands,
        generatedAt: new Date('2026-11-05T04:30:00.000Z'),
      },
      { monthSlug: '2026-11' },
    );

    const workbook = writeFile.mock.calls[0][0];
    const sheet = workbook.Sheets['Shop targets'];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: true });

    expect(rows[0]).toEqual(['Shop Targets']);
    expect(rows[1]).toEqual(['Month: November 2026']);
    expect(rows[5]).toEqual([
      'Shop name',
      'Tokyo bags',
      'Total bags',
      'Tokyo free',
      'Holcim free',
      'Total free bags',
      'Monthly target',
      'Completed %',
    ]);
    expect(rows[6]).toEqual(['Lake Shop', 20, 20, 7, 2, 9, 100, 20]);
    expect(rows[8]).toEqual(['Total (1 shop)', 20, 20, 7, 2, 9, 100, 20]);
    expect(writeFile).toHaveBeenCalledWith(workbook, 'shop-targets-2026-11.xlsx');
    writeFile.mockRestore();
  });
});
