import { buildCustomerInvoiceRows, chequeRealizeYmd } from './pendingBills';

const customer = { id: 'c1', name: 'Lake Shop', overdueDays: 14 };

function invoice(payments, bills = [
  { id: 'b1', customerName: 'Lake Shop', date: '2026-10-01', totalAmount: 1000, invoiceNumber: 'INV-1' },
]) {
  return buildCustomerInvoiceRows(customer, bills, payments).find((row) => row.id === 'b1');
}

describe('days to settle using cheque realizing dates', () => {
  test('uses the later of converting date and deposit date', () => {
    expect(chequeRealizeYmd({
      chequeDate: '2026-10-20',
      chequeDeposited: true,
      chequeDepositedAt: '2026-10-18T09:00:00.000Z',
    })).toBe('2026-10-20');
    expect(chequeRealizeYmd({
      chequeDate: '2026-10-20',
      chequeDeposited: true,
      chequeDepositedAt: '2026-10-25T09:00:00.000Z',
    })).toBe('2026-10-25');
    expect(chequeRealizeYmd({ chequeDate: '2026-10-20', chequeDeposited: false })).toBe('2026-10-20');
  });

  test('cash settles on the receipt date', () => {
    const row = invoice([
      { id: 'p1', customerId: 'c1', customerName: 'Lake Shop', date: '2026-10-10', amount: 1000 },
    ]);
    expect(row.settledDate).toBe('2026-10-10');
    expect(row.daysToSettle).toBe(9);
  });

  test('a cheque settles on its realizing date, not the receipt date', () => {
    const row = invoice([
      {
        id: 'p1',
        customerId: 'c1',
        customerName: 'Lake Shop',
        date: '2026-10-05',
        amount: 1000,
        cashAmount: 0,
        cheques: [{
          id: 'ch1',
          amount: 1000,
          chequeDate: '2026-10-20',
          chequeDeposited: true,
          chequeDepositedAt: '2026-10-28T08:00:00.000Z',
        }],
      },
    ]);
    expect(row.settledDate).toBe('2026-10-28');
    expect(row.daysToSettle).toBe(27);
  });

  test('cash that clears the bill is not delayed by a later cheque on the same receipt', () => {
    const row = invoice([
      {
        id: 'p1',
        customerId: 'c1',
        customerName: 'Lake Shop',
        date: '2026-10-05',
        amount: 1200,
        cashAmount: 1000,
        cheques: [{
          id: 'ch1',
          amount: 200,
          chequeDate: '2026-10-20',
          chequeDeposited: false,
        }],
      },
    ]);
    expect(row.settledDate).toBe('2026-10-05');
    expect(row.daysToSettle).toBe(4);
  });

  test('a bill finished by the cheque uses the realizing date, and the next bill keeps the remaining cheque', () => {
    const bills = [
      { id: 'b1', customerName: 'Lake Shop', date: '2026-10-01', totalAmount: 600, invoiceNumber: 'INV-1' },
      { id: 'b2', customerName: 'Lake Shop', date: '2026-10-02', totalAmount: 600, invoiceNumber: 'INV-2' },
    ];
    const rows = buildCustomerInvoiceRows(customer, bills, [
      {
        id: 'p1',
        customerId: 'c1',
        customerName: 'Lake Shop',
        date: '2026-10-05',
        amount: 1200,
        cashAmount: 600,
        cheques: [{
          id: 'ch1',
          amount: 600,
          chequeDate: '2026-10-20',
          chequeDeposited: false,
        }],
      },
    ]);
    const first = rows.find((row) => row.id === 'b1');
    const second = rows.find((row) => row.id === 'b2');
    expect([first.settledDate, first.daysToSettle]).toEqual(['2026-10-05', 4]);
    expect([second.settledDate, second.daysToSettle]).toEqual(['2026-10-20', 18]);
  });
});
