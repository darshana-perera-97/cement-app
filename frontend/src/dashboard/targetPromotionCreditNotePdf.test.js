const { TextEncoder, TextDecoder } = require('util');

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const { buildTargetPromotionCreditNotePdf, targetPromotionCreditNoteNumber } = require('./targetPromotionCreditNotePdf');

test('uses the stored credit note number', () => {
  expect(targetPromotionCreditNoteNumber({ creditNoteNumber: 'CN-004' })).toBe('CN-004');
  expect(targetPromotionCreditNoteNumber({ id: 'promo-abc123' })).toBe('CN-ABC123');
});

test('builds a credit note in the tax-invoice layout', () => {
  const built = buildTargetPromotionCreditNotePdf(
    {
      type: 'target_promotion',
      id: 'promo-1',
      creditNoteNumber: 'CN-004',
      date: '2026-11-04',
      customerName: 'Test Shop',
      customerId: 'C1',
      reason: 'October target achieved',
      discountAmount: 11800,
      enteredBy: 'admin',
    },
    {
      shop: {
        shopName: 'CS Store',
        supplierTin: '123456789',
        addressLine1: 'Main Street',
        contactNumber: '0112345678',
      },
      customer: {
        id: 'C1',
        name: 'Test Shop',
        purchaserTin: '999888777',
        purchaserTaxName: 'Test Shop',
        purchaserTaxAddress: 'Kandy',
        purchaserTaxPhone: '0770000000',
        placeOfSupply: 'Kandy',
      },
    },
  );

  expect(built).toBeTruthy();
  expect(built.filename).toBe('credit-note-Test-Shop-CN-004-2026-11-04.pdf');
  expect(built.doc.getNumberOfPages()).toBe(1);
  const text = built.doc.internal.pages
    .map((page) => (Array.isArray(page) ? page.join('') : ''))
    .join('\n');
  expect(text).toContain('Credit Note');
  expect(text).toContain('CN-004');
  expect(text).toContain('Target promotion reward');
  expect(text).toContain('10,000.00');
  expect(text).toContain('1,800.00');
  expect(text).toContain('11,800.00');
});

test('ignores other promotion types', () => {
  expect(buildTargetPromotionCreditNotePdf({ type: 'free_bags', discountAmount: 100 })).toBeNull();
});
