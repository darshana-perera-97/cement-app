import { collectReturnChequeSettlementRows, isReturnChequeSettlementLabel } from './dailyCollectionsReturnSettlements';
import { downloadDailyCollectionsReportPdf } from './dailyCollectionsReportPdf';

const mockAutoTableCalls = [];

jest.mock('jspdf', () => {
  function jsPDF() {
    this.internal = {
      getNumberOfPages: () => 1,
      pageSize: {
        getHeight: () => 297,
        getWidth: () => 210,
      },
    };
    this.setFont = () => {};
    this.setFontSize = () => {};
    this.setTextColor = () => {};
    this.text = () => {};
    this.splitTextToSize = (text) => [String(text)];
    this.addPage = () => {};
    this.setPage = () => {};
    this.save = () => {};
    this.lastAutoTable = null;
  }
  return { jsPDF };
});

jest.mock('jspdf-autotable', () => (doc, opts) => {
  mockAutoTableCalls.push(opts);
  const prev = doc.lastAutoTable?.finalY || 30;
  doc.lastAutoTable = { finalY: prev + 20 };
});

function tableWithHeader(label) {
  return mockAutoTableCalls.find((call) => (call.head?.[0] || []).includes(label));
}

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
        {
          customerName: 'Shop A',
          invoiceNumber: 'Return cheque #4521',
          billNumber: 'RE.NO-100',
          amount: 5000,
          recordedBy: 'Nimal',
        },
        { customerName: 'Shop B', invoiceNumber: '26OCT_001', billNumber: 'RE.NO-101', amount: 1000 },
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
    expect(rows[0].billNumber).toBe('RE.NO-100');
    expect(rows.find((row) => row.amount < 0)).toBeUndefined();
  });
});

describe('payment receipt numbers on the daily collections PDF', () => {
  beforeEach(() => {
    mockAutoTableCalls.length = 0;
  });

  test('shows the payment receipt number on every payment list', () => {
    downloadDailyCollectionsReportPdf(
      {
        reportDate: '2026-11-05',
        totals: { collections: 1000, cash: 1000, cheque: 2000, cdm: 750, bankTransfer: 300, paymentCount: 4 },
        shopRows: [
          {
            shop: 'Shop B',
            cashInvoiceNumbers: '26OCT_001',
            paymentBillInvoices: 'RE.NO-101',
            cashCollected: 1000,
            cashIn: 1000,
          },
        ],
        cashRows: [{ customerName: 'Shop B', invoiceNumber: '26OCT_001', billNumber: 'RE.NO-101', amount: 1000 }],
        chequeRows: [
          {
            customerName: 'Shop C',
            invoiceNumber: '26OCT_002',
            billNumber: 'RE.NO-102',
            amount: 2000,
            chequeNumber: '900',
            chequeDate: '2026-11-05',
          },
        ],
        cdmRows: [
          {
            customerName: 'Shop D',
            invoiceNumber: '26OCT_003',
            billNumber: 'RE.NO-103',
            amount: 750,
            cdmNumber: 'CDM-1',
            cdmDate: '2026-11-05',
          },
        ],
        bankTransferRows: [
          {
            customerName: 'Shop E',
            invoiceNumber: '26OCT_010',
            billNumber: 'RE.NO-104',
            amount: 300,
            reference: 'TX1',
          },
        ],
        showInvoiceNumber: true,
        generatedAt: new Date('2026-11-05T08:00:00.000Z'),
      },
      { dateSlug: '2026-11-05' },
    );

    const shop = tableWithHeader('Payment Bill invoice');
    expect(shop.head[0]).toEqual([
      'Shop',
      'Cash invoice #',
      'Payment Bill invoice',
      'Cash',
      'Cheque',
      'CDM',
      'Bank transfer',
      'Collections',
    ]);
    expect(shop.body[0]).toContain('RE.NO-101');

    const cash = tableWithHeader('Invoice #');
    const cheque = tableWithHeader('Cheque #');
    const cdm = tableWithHeader('CDM #');
    const bank = tableWithHeader('Reference #');

    expect(cash.head[0]).toEqual(['Shop', 'Invoice #', 'Bill #', 'Amount']);
    expect(cash.body[0]).toContain('RE.NO-101');
    expect(cheque.head[0]).toContain('Bill #');
    expect(cheque.body[0]).toContain('RE.NO-102');
    expect(cdm.head[0]).toContain('Bill #');
    expect(cdm.body[0]).toContain('RE.NO-103');
    expect(bank.head[0]).toContain('Bill #');
    expect(bank.body[0]).toContain('RE.NO-104');
  });

  test('shows the payment receipt number on return cheque settlements', () => {
    downloadDailyCollectionsReportPdf(
      {
        reportDate: '2026-11-05',
        totals: {},
        cashRows: [
          {
            customerName: 'Shop A',
            invoiceNumber: 'Return cheque #4521',
            billNumber: 'RE.NO-100',
            amount: 5000,
          },
        ],
        showInvoiceNumber: true,
        generatedAt: new Date('2026-11-05T08:00:00.000Z'),
      },
      { dateSlug: '2026-11-05' },
    );

    const settlements = tableWithHeader('Return cheque');
    expect(settlements.head[0]).toContain('Bill #');
    expect(settlements.body[0]).toContain('RE.NO-100');
  });
});
