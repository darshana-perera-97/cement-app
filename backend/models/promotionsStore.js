const fs = require('fs').promises;
const path = require('path');
const { toNonNegNumber } = require('./stocksStore');
const { toNonNegMoney } = require('./customersStore');
const { bagsField, emptyBrandMap } = require('./bagProducts');

const PROMOTIONS_FILE = path.join(__dirname, '..', 'data', 'promotions.json');

const PROMOTION_TYPES = {
  FREE_BAGS: 'free_bags',
  INVOICE_DISCOUNT: 'invoice_discount',
  TARGET_PROMOTION: 'target_promotion',
  RULE_CASHBACK: 'rule_cashback',
};

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

/** @returns {'free_bags' | 'invoice_discount' | 'target_promotion' | 'rule_cashback'} */
function promotionType(row) {
  const t = String(row?.type ?? '').trim();
  if (
    t === PROMOTION_TYPES.INVOICE_DISCOUNT ||
    t === PROMOTION_TYPES.TARGET_PROMOTION ||
    t === PROMOTION_TYPES.RULE_CASHBACK
  ) {
    return t;
  }
  return PROMOTION_TYPES.FREE_BAGS;
}

function isFreeBagPromotion(row) {
  return promotionType(row) === PROMOTION_TYPES.FREE_BAGS;
}

function isLedgerCreditPromotion(row) {
  const type = promotionType(row);
  return (
    type === PROMOTION_TYPES.INVOICE_DISCOUNT ||
    type === PROMOTION_TYPES.TARGET_PROMOTION ||
    type === PROMOTION_TYPES.RULE_CASHBACK
  );
}

function promotionCreditAmount(row) {
  if (!isLedgerCreditPromotion(row)) return 0;
  return toNonNegMoney(row.discountAmount);
}

function formatCreditNoteNumber(n) {
  return `CN-${String(n).padStart(3, '0')}`;
}

function highestCreditNoteSerial(rows) {
  const re = /^CN-(\d+)$/i;
  let max = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = String(row?.creditNoteNumber ?? '').trim().match(re);
    if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
  }
  return max;
}

function nextCreditNoteNumber(rows) {
  return formatCreditNoteNumber(highestCreditNoteSerial(rows) + 1);
}

/** Give every target promotion a stable CN-001 style number. Returns true when a row changed. */
function assignMissingTargetCreditNoteNumbers(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let max = highestCreditNoteSerial(list);
  const pending = [];
  for (let i = 0; i < list.length; i += 1) {
    if (promotionType(list[i]) !== PROMOTION_TYPES.TARGET_PROMOTION) continue;
    if (String(list[i].creditNoteNumber ?? '').trim()) continue;
    pending.push(i);
  }
  pending.sort((ia, ib) => {
    const a = list[ia];
    const b = list[ib];
    const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  let changed = false;
  for (const index of pending) {
    max += 1;
    list[index] = { ...list[index], creditNoteNumber: formatCreditNoteNumber(max) };
    changed = true;
  }
  return changed;
}

function sumPromotionCreditsForBill(promotions, billId, type) {
  const id = String(billId ?? '').trim();
  if (!id) return 0;
  let sum = 0;
  for (const row of Array.isArray(promotions) ? promotions : []) {
    if (promotionType(row) !== type) continue;
    if (String(row.billId ?? '').trim() !== id) continue;
    sum += promotionCreditAmount(row);
  }
  return roundMoney(sum);
}

function sumInvoiceDiscountForBill(promotions, billId) {
  return sumPromotionCreditsForBill(promotions, billId, PROMOTION_TYPES.INVOICE_DISCOUNT);
}

function sumRuleCashbackForBill(promotions, billId) {
  return sumPromotionCreditsForBill(promotions, billId, PROMOTION_TYPES.RULE_CASHBACK);
}

function totalBagsOnBill(bill, products) {
  let sum = 0;
  for (const p of Array.isArray(products) ? products : []) {
    sum += toNonNegNumber(bill?.[p.bagsField]);
  }
  return sum;
}

function computeInvoiceDiscountAmount(bill, discountMode, discountValue, products) {
  const value = toNonNegMoney(discountValue);
  if (value <= 0) return 0;
  const billTotal = toNonNegMoney(bill?.totalAmount);
  if (billTotal <= 0) return 0;
  if (String(discountMode ?? '').trim() === 'whole_invoice') {
    return Math.min(value, billTotal);
  }
  const bags = totalBagsOnBill(bill, products);
  if (bags <= 0) return 0;
  return Math.min(roundMoney(value * bags), billTotal);
}

/** Free bags per promotion issue date (same shape as bill outs for the daily ledger). */
function aggregatePromotionOutsByDate(promotions, keys) {
  const map = {};
  for (const row of promotions) {
    if (!isFreeBagPromotion(row)) continue;
    const d = String(row.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!map[d]) map[d] = emptyBrandMap(keys);
    for (const k of keys) {
      map[d][k] += toNonNegNumber(row[bagsField(k)]);
    }
  }
  return map;
}

function sumAllPromotionBagsByBrand(promotions, keys) {
  const t = emptyBrandMap(keys);
  for (const row of promotions) {
    if (!isFreeBagPromotion(row)) continue;
    for (const k of keys) {
      t[k] += toNonNegNumber(row[bagsField(k)]);
    }
  }
  return t;
}

async function readPromotions() {
  try {
    const raw = await fs.readFile(PROMOTIONS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writePromotions(records) {
  await fs.mkdir(path.dirname(PROMOTIONS_FILE), { recursive: true });
  await fs.writeFile(PROMOTIONS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

module.exports = {
  readPromotions,
  writePromotions,
  aggregatePromotionOutsByDate,
  sumAllPromotionBagsByBrand,
  PROMOTIONS_FILE,
  PROMOTION_TYPES,
  promotionType,
  isFreeBagPromotion,
  isLedgerCreditPromotion,
  promotionCreditAmount,
  nextCreditNoteNumber,
  assignMissingTargetCreditNoteNumbers,
  sumInvoiceDiscountForBill,
  sumRuleCashbackForBill,
  computeInvoiceDiscountAmount,
  totalBagsOnBill,
};
