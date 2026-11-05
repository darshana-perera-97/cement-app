import { collectReturnChequeSettlementRows, isReturnChequeSettlementLabel } from './dailyCollectionsReturnSettlements';

describe('return cheque settlements in the daily collections PDF', () => {
  test('recognises a payment that only settles return cheques', () => {
    expect(isReturnChequeSettlementLabel('Return cheque #4521')).toBe(true);
    expect(isReturnChequeSettlementLabel('Return cheque #4521, Return cheque')).toBe(true);
    expect(isReturnChequeSettlementLabel('#4521, 26OCT_001')).toBe(false);
    expect(isReturnChequeSettlementLabel('26OCT_001')).toBe(false);
  });

  test('pulls return-cheque settlements out of each method and leaves bounced cheques in the cheque list', () => {
    const rows = collectReturnChequeSettlementRows({
      cashRows: [
        { customerName: 'Shop A', invoiceNumber: 'Return cheque #4521', amount: 5000, recordedBy: 'Nimal' },
        { customerName: 'Shop B', invoiceNumber: '26OCT_001', amount: 1000 },
      ],
      chequeRows: [
        {
          customerName: 'Shop C',
          invoiceNumber: 'Return cheque #88',
          amount: 2000,
          chequeNumber: '900',
          chequeBank: 'BOC',
          chequeDate: '2026-11-05',
        },
        {
          customerName: 'Shop A',
          invoiceNumber: 'Return cheque #4521',
          amount: -5000,
          isReturnDeduction: true,
          chequeNumber: '4521',
        },
      ],
      cdmRows: [
        { customerName: 'Shop D', invoiceNumber: 'Return cheque', amount: 750, cdmNumber: 'CDM-1', cdmDate: '2026-11-05' },
      ],
      bankTransferRows: [
        { customerName: 'Shop E', invoiceNumber: '26OCT_010', amount: 300, reference: 'TX1' },
      ],
    });

    expect(rows.map((row) => [row.customerName, row.method, row.amount])).toEqual([
      ['Shop A', 'Cash', 5000],
      ['Shop C', 'Cheque', 2000],
      ['Shop D', 'CDM deposit', 750],
    ]);
    expect(rows[1].reference).toBe('BOC 900 · 2026-11-05');
    expect(rows.find((row) => row.amount < 0)).toBeUndefined();
  });
});
