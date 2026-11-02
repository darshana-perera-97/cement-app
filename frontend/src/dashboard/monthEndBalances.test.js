import { billSuccessPercent, buildMonthEndBalances } from './monthEndBalances';

describe('month end bill success', () => {
  test('scores 100% on or before the credit days, then falls with extra days', () => {
    expect(billSuccessPercent(0, 14)).toBe(100);
    expect(billSuccessPercent(14, 14)).toBe(100);
    expect(billSuccessPercent(15, 14)).toBe(93);
    expect(billSuccessPercent(28, 14)).toBe(50);
    expect(billSuccessPercent(0, 0)).toBe(100);
    expect(billSuccessPercent(10, 0)).toBe(0);
  });

  test('groups settled unloads, pending balances, and customer success', () => {
    const customers = [
      { id: 'c1', name: 'Lake Shop', overdueDays: 14, location: 'Kandy' },
      { id: 'c2', name: 'Hill Shop' },
      { id: 'c3', name: 'Quiet Shop', overdueDays: 14 },
      { id: 'c4', name: 'Bay Shop', overdueDays: 10 },
    ];
    const bills = [
      { id: 'b1', customerName: 'Lake Shop', date: '2026-10-01', totalAmount: 1000, invoiceNumber: 'INV-1' },
      { id: 'b2', customerName: 'Lake Shop', date: '2026-10-01', totalAmount: 400, invoiceNumber: 'INV-2' },
      { id: 'b3', customerName: 'Lake Shop', date: '2026-10-05', totalAmount: 500, invoiceNumber: 'INV-3' },
      { id: 'b4', customerName: 'Lake Shop', date: '2026-09-01', totalAmount: 200, invoiceNumber: 'INV-4' },
      { id: 'b5', customerName: 'Hill Shop', date: '2026-10-28', totalAmount: 800, invoiceNumber: 'INV-5' },
      { id: 'b6', customerName: 'Bay Shop', date: '2026-10-01', totalAmount: 1000, invoiceNumber: 'INV-6' },
    ];
    const payments = [
      { id: 'p-old', customerId: 'c1', customerName: 'Lake Shop', date: '2026-09-05', amount: 200 },
      { id: 'p1', customerId: 'c1', customerName: 'Lake Shop', date: '2026-10-10', amount: 1000 },
      { id: 'p2', customerId: 'c1', customerName: 'Lake Shop', date: '2026-10-29', amount: 400 },
      { id: 'p4', customerId: 'c4', customerName: 'Bay Shop', date: '2026-11-01', amount: 250 },
    ];

    const report = buildMonthEndBalances(customers, bills, payments, {
      month: '2026-10',
      asOf: '2026-11-02',
    });

    expect(report.shops.map((shop) => shop.shopName)).toEqual(['Bay Shop', 'Hill Shop', 'Lake Shop']);
    expect(report.totals).toMatchObject({
      shopCount: 3,
      settledCount: 2,
      settledAmount: 1400,
      pendingCount: 3,
      pendingAmount: 2050,
      overdueCount: 2,
      overdueAmount: 1250,
      successPercent: 66,
    });

    const lake = report.shops.find((shop) => shop.shopName === 'Lake Shop');
    expect(lake.successPercent).toBe(67);
    expect(lake.creditDays).toBe(14);
    expect(lake.settled.map((row) => [row.details, row.daysToSettle, row.settledDate])).toEqual([
      [expect.stringContaining('INV-1'), 9, '2026-10-10'],
      [expect.stringContaining('INV-2'), 28, '2026-10-29'],
    ]);
    expect(lake.pending).toEqual([
      expect.objectContaining({
        balance: 500,
        settledAmount: 0,
        daysFromBillDate: 28,
        overdue: true,
        daysOverdue: 14,
      }),
    ]);

    const hill = report.shops.find((shop) => shop.shopName === 'Hill Shop');
    expect(hill.successPercent).toBe(100);
    expect(hill.settled).toHaveLength(0);
    expect(hill.pending[0]).toMatchObject({
      balance: 800,
      daysFromBillDate: 5,
      overdue: false,
    });
    expect(hill.creditDays).toBe(14);

    const bay = report.shops.find((shop) => shop.shopName === 'Bay Shop');
    expect(bay.successPercent).toBe(31);
    expect(bay.pending[0]).toMatchObject({
      settledAmount: 250,
      balance: 750,
      daysFromBillDate: 32,
      overdue: true,
    });
  });
});
