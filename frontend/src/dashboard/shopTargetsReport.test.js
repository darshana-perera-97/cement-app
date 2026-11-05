import { setCachedBrands } from './brandTheme';
import { buildShopTargetsRows } from './shopTargetsReport';

const brands = [
  { key: 'tokyo', label: 'Tokyo', bagsField: 'tokyoBags' },
  { key: 'holcim', label: 'Holcim', bagsField: 'holcimBags' },
];

beforeEach(() => {
  setCachedBrands(brands);
});

afterAll(() => {
  setCachedBrands([]);
});

describe('shop targets free bags', () => {
  test('sums every free bag issued to the customer in the selected month', () => {
    const customers = [
      { id: 'c1', name: 'Lake Shop', monthlyTargetBags: 100 },
      { id: 'c2', name: 'Hill Shop', monthlyTargetBags: 50 },
    ];
    const bills = [
      { customerName: 'Lake Shop', date: '2026-11-04', tokyoBags: 20, holcimBags: 5 },
      { customerName: 'Lake Shop', date: '2026-10-31', tokyoBags: 99 },
    ];
    const promotions = [
      {
        type: 'free_bags',
        customerId: 'c1',
        customerName: 'Lake Shop',
        date: '2026-11-02',
        tokyoBags: 3,
        holcimBags: 2,
      },
      {
        type: 'free_bags',
        customerId: 'c1',
        customerName: 'Lake Shop',
        date: '2026-11-10',
        tokyoBags: 4,
      },
      {
        type: 'free_bags',
        customerId: 'c1',
        customerName: 'Lake Shop',
        date: '2026-10-20',
        tokyoBags: 8,
      },
      {
        type: 'invoice_discount',
        customerId: 'c1',
        customerName: 'Lake Shop',
        date: '2026-11-02',
        tokyoBags: 50,
        discountAmount: 100,
      },
      { customerId: 'c2', customerName: 'Hill Shop', date: '2026-11-06', holcimBags: 7 },
    ];

    const report = buildShopTargetsRows(bills, customers, '2026-11', promotions);
    const lake = report.rows.find((r) => r.shop === 'Lake Shop');
    const hill = report.rows.find((r) => r.shop === 'Hill Shop');

    expect(lake.total).toBe(25);
    expect(lake.freeBags).toBe(9);
    expect(hill.freeBags).toBe(7);
    expect(report.totals.freeBags).toBe(16);
  });
});
