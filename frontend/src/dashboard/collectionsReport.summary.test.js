import {
  buildAllCollectionsRows,
  summarizeAllCollectionsByDays,
  summarizeCollectionsByBucket,
} from './collectionsReport';

describe('settled collections summary', () => {
  test('adds each line Amount into every Days band that contains that day', () => {
    const summary = summarizeCollectionsByBucket([
      { daysToSettle: 12, amount: 1000, commissionBucket: '0-14' },
      { daysToSettle: 30, amount: 400, commissionBucket: '30-35' },
      { daysToSettle: 36, amount: 50, commissionBucket: 'more than 35' },
      { daysToSettle: null, amount: 999, commissionBucket: null },
    ]);

    expect(summary['0-14']).toEqual({ lineCount: 1, amount: 1000 });
    expect(summary['15-21']).toEqual({ lineCount: 0, amount: 0 });
    expect(summary['22-30']).toEqual({ lineCount: 1, amount: 400 });
    expect(summary['30-35']).toEqual({ lineCount: 1, amount: 400 });
    expect(summary['more than 35']).toEqual({ lineCount: 1, amount: 50 });
  });
});

describe('all collections', () => {
  test('lists each receipt in the month and deducts cheques returned in that month', () => {
    const rows = buildAllCollectionsRows(
      [
        {
          id: 'p1',
          date: '2026-03-02',
          createdAt: '2026-03-02T10:30:00.000Z',
          customerName: 'Shop A',
          recordedBy: 'alice',
          amount: 1000,
          cashAmount: 400,
          chequeAmount: 600,
          cheques: [
            {
              id: 'c1',
              amount: 600,
              chequeNumber: '11',
              chequeReturned: true,
              chequeReturnedAt: '2026-03-10',
            },
          ],
        },
        {
          id: 'p2',
          date: '2026-02-01',
          customerName: 'Old shop',
          recordedBy: 'alice',
          amount: 50,
          cashAmount: 50,
        },
        {
          id: 'p3',
          date: '2026-03-04',
          customerName: 'Other shop',
          recordedBy: 'bob',
          amount: 80,
          cashAmount: 80,
        },
        {
          id: 'p4',
          date: '2026-03-02',
          createdAt: '2026-03-02T08:15:00.000Z',
          customerName: 'Zebra Shop',
          recordedBy: 'alice',
          amount: 20,
          cashAmount: 20,
        },
      ],
      {
        from: '2026-03-01',
        to: '2026-03-31',
        recordedByKeys: ['alice'],
        staff: [{ username: 'alice', name: 'Alice' }],
      },
    );

    expect(rows.map((r) => r.shopName)).toEqual(['Zebra Shop', 'Shop A', 'Shop A']);
    expect(rows.map((r) => r.amount)).toEqual([20, 1000, -600]);
    expect(rows[0].sortAt).toBeLessThan(rows[1].sortAt);
    expect(rows[1].sortAt).toBeLessThan(rows[2].sortAt);
    expect(rows[1]).toMatchObject({
      shopName: 'Shop A',
      cash: 400,
      cheque: 600,
      collectorName: 'Alice',
      isReturnDeduction: false,
    });
    expect(rows[2]).toMatchObject({
      date: '2026-03-10',
      invoiceNumber: 'Return #11',
      cheque: -600,
      isReturnDeduction: true,
    });
  });

  test('shows one line per invoice when a payment covers more than one', () => {
    const rows = buildAllCollectionsRows(
      [
        {
          id: 'p9',
          date: '2026-03-05',
          createdAt: '2026-03-05T09:00:00.000Z',
          customerName: 'Pathiraja',
          recordedBy: 'alice',
          amount: 627000,
          cashAmount: 627000,
          affectedInvoices: [
            {
              billId: 'b93',
              invoiceNumber: '26OCT_093',
              date: '2026-02-20',
              appliedAmount: 327000,
              billTotal: 400000,
            },
            {
              billId: 'b77',
              invoiceNumber: '26OCT_077',
              date: '2026-02-18',
              appliedAmount: 300000,
              billTotal: 300000,
            },
          ],
        },
      ],
      {
        from: '2026-03-01',
        to: '2026-03-31',
        recordedByKeys: ['alice'],
        staff: [{ username: 'alice', name: 'Alice' }],
        settledByBillId: new Map([['b77', '2026-03-05']]),
      },
    );

    expect(rows.map((r) => r.invoiceNumber)).toEqual(['26OCT_077', '26OCT_093']);
    expect(rows.map((r) => r.amount)).toEqual([300000, 327000]);
    expect(rows.map((r) => r.billDate)).toEqual(['2026-02-18', '2026-02-20']);
    expect(rows.map((r) => r.daysFromBill)).toEqual([15, 13]);
    expect(rows.map((r) => r.billAmount)).toEqual([300000, 400000]);
    expect(rows.map((r) => r.billSettled)).toEqual([true, false]);
    expect(rows[0].when).toBe(rows[1].when);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(627000);
  });

  test('names a return cheque settlement only when that payment settles nothing else', () => {
    const onlyReturn = buildAllCollectionsRows(
      [
        {
          id: 'p-rc',
          date: '2026-03-05',
          createdAt: '2026-03-05T09:00:00.000Z',
          customerName: 'Shop A',
          recordedBy: 'alice',
          amount: 5000,
          cashAmount: 5000,
          affectedInvoices: [
            {
              billId: 'return-cheque:pay:chq',
              invoiceNumber: '#4521',
              details: 'Return cheque',
              isReturnCheque: true,
              date: '2026-03-01',
              appliedAmount: 5000,
              billTotal: 5000,
            },
          ],
        },
      ],
      { from: '2026-03-01', to: '2026-03-31' },
    );
    expect(onlyReturn.map((r) => r.invoiceNumber)).toEqual(['Return cheque #4521']);
    expect(onlyReturn.map((r) => r.amount)).toEqual([5000]);

    const mixed = buildAllCollectionsRows(
      [
        {
          id: 'p-mix',
          date: '2026-03-06',
          createdAt: '2026-03-06T09:00:00.000Z',
          customerName: 'Shop A',
          amount: 8000,
          cashAmount: 8000,
          affectedInvoices: [
            {
              billId: 'b1',
              invoiceNumber: '26OCT_001',
              date: '2026-02-01',
              appliedAmount: 3000,
              billTotal: 3000,
            },
            {
              billId: 'return-cheque:pay:chq',
              invoiceNumber: '#4521',
              details: 'Return cheque',
              isReturnCheque: true,
              date: '2026-03-01',
              appliedAmount: 5000,
              billTotal: 5000,
            },
          ],
        },
      ],
      { from: '2026-03-01', to: '2026-03-31' },
    );
    expect(mixed.map((r) => r.invoiceNumber).sort()).toEqual(['#4521', '26OCT_001']);
    expect(mixed.reduce((sum, r) => sum + r.amount, 0)).toBe(8000);
  });
});

describe('all collections day summary', () => {
  test('puts each line in one band, with day 30 only in 22–30 and day 31 in 31–35', () => {
    const summary = summarizeAllCollectionsByDays([
      { daysFromBill: 0, amount: 10 },
      { daysFromBill: 14, amount: 20 },
      { daysFromBill: 21, amount: 30 },
      { daysFromBill: 30, amount: 40 },
      { daysFromBill: 31, amount: 50 },
      { daysFromBill: 35, amount: 60 },
      { daysFromBill: 36, amount: 70 },
      { daysFromBill: null, amount: 999 },
    ]);

    expect(summary['0-14']).toEqual({ lineCount: 2, amount: 30 });
    expect(summary['15-21']).toEqual({ lineCount: 1, amount: 30 });
    expect(summary['22-30']).toEqual({ lineCount: 1, amount: 40 });
    expect(summary['31-35']).toEqual({ lineCount: 2, amount: 110 });
    expect(summary['more than 35']).toEqual({ lineCount: 1, amount: 70 });
  });
});
