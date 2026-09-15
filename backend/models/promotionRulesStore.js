const fs = require('fs').promises;
const path = require('path');
const { toNonNegMoney } = require('./customersStore');
const { toNonNegNumber } = require('./stocksStore');

const PROMOTION_RULES_FILE = path.join(__dirname, '..', 'data', 'promotionRules.json');

function parseYmd(value) {
  const d = String(value ?? '')
    .trim()
    .slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

function parseCashbacks(input, products) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const cashbacks = {};
  let positiveCount = 0;
  for (const p of Array.isArray(products) ? products : []) {
    const key = String(p?.key ?? '').trim();
    if (!key) continue;
    const amount = toNonNegMoney(src[key] ?? src[`${key}Cashback`]);
    cashbacks[key] = amount;
    if (amount > 0) positiveCount += 1;
  }
  return { cashbacks, positiveCount };
}

function buildPromotionRuleRow(body, { customer, products }) {
  const startDate = parseYmd(body.startDate);
  const endDate = parseYmd(body.endDate);
  if (!startDate) {
    return { ok: false, error: 'startDate must be YYYY-MM-DD' };
  }
  if (!endDate) {
    return { ok: false, error: 'endDate must be YYYY-MM-DD' };
  }
  if (endDate < startDate) {
    return { ok: false, error: 'End date must be on or after start date.' };
  }
  const { cashbacks, positiveCount } = parseCashbacks(body.cashbacks, products);
  if (positiveCount <= 0) {
    return { ok: false, error: 'Enter a cashback amount for at least one product.' };
  }
  return {
    ok: true,
    row: {
      customerId: customer.id,
      customerName: customer.name,
      startDate,
      endDate,
      cashbacks,
    },
  };
}

function matchingRulesForCustomer(rules, customerId, date) {
  const id = String(customerId ?? '').trim();
  const d = parseYmd(date);
  if (!id || !d) return [];
  return (Array.isArray(rules) ? rules : []).filter((rule) => {
    if (String(rule.customerId ?? '').trim() !== id) return false;
    const start = parseYmd(rule.startDate);
    const end = parseYmd(rule.endDate);
    if (!start || !end) return false;
    return d >= start && d <= end;
  });
}

/**
 * Cashback for a bill: highest matching rule rate per product × bags on the bill.
 * Overlapping rules for the same product use the higher rate (not summed).
 */
function computeBillRuleCashback(bill, rules, customerId, products) {
  const matched = matchingRulesForCustomer(rules, customerId, bill?.date);
  const catalog = Array.isArray(products) ? products : [];
  const rates = {};
  const ruleIdByKey = {};
  for (const rule of matched) {
    const cashbacks = rule.cashbacks && typeof rule.cashbacks === 'object' ? rule.cashbacks : {};
    for (const p of catalog) {
      const key = String(p?.key ?? '').trim();
      if (!key) continue;
      const rate = toNonNegMoney(cashbacks[key]);
      if (rate <= 0) continue;
      if (rate >= (rates[key] || 0)) {
        rates[key] = rate;
        ruleIdByKey[key] = rule.id;
      }
    }
  }

  const lines = [];
  const ruleIds = new Set();
  let total = 0;
  for (const p of catalog) {
    const key = String(p?.key ?? '').trim();
    const rate = rates[key] || 0;
    if (rate <= 0) continue;
    const bagsField = p.bagsField || `${key}Bags`;
    const bags = toNonNegNumber(bill?.[bagsField]);
    if (bags <= 0) continue;
    const amount = Math.round(rate * bags * 100) / 100;
    if (amount <= 0) continue;
    lines.push({ key, bags, rate, amount });
    total += amount;
    if (ruleIdByKey[key]) ruleIds.add(ruleIdByKey[key]);
  }

  return {
    discountAmount: Math.round(total * 100) / 100,
    lines,
    ruleIds: [...ruleIds],
  };
}

async function readPromotionRules() {
  try {
    const raw = await fs.readFile(PROMOTION_RULES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writePromotionRules(records) {
  await fs.mkdir(path.dirname(PROMOTION_RULES_FILE), { recursive: true });
  await fs.writeFile(PROMOTION_RULES_FILE, JSON.stringify(records, null, 2), 'utf8');
}

module.exports = {
  PROMOTION_RULES_FILE,
  readPromotionRules,
  writePromotionRules,
  buildPromotionRuleRow,
  matchingRulesForCustomer,
  computeBillRuleCashback,
};
