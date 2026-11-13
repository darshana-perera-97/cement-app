const fs = require('fs').promises;
const path = require('path');
const { toNonNegNumber } = require('./stocksStore');
const { toNonNegMoney } = require('./customersStore');

const QUOTATIONS_FILE = path.join(__dirname, '..', 'data', 'quotations.json');

const DEFAULT_PAYMENT_TERMS = 'Payment within 30 days of invoice.';
const DEFAULT_DELIVERY_TERMS = 'Delivery within 3–5 working days of confirmation.';

async function readQuotations() {
  try {
    const raw = await fs.readFile(QUOTATIONS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeQuotations(records) {
  await fs.mkdir(path.dirname(QUOTATIONS_FILE), { recursive: true });
  await fs.writeFile(QUOTATIONS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function normalizeYmd(value) {
  const d = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function lineTotal(quantity, unitCost) {
  return roundMoney(toNonNegNumber(quantity) * toNonNegMoney(unitCost));
}

/** Next QT-nnnn after the highest existing number; defaults to QT-0001. */
function nextSuggestedQuotationNumber(records) {
  let max = 0;
  for (const r of records) {
    const raw = String(r.quotationNumber ?? '').trim();
    if (!raw) continue;
    const m = /^QT-(\d+)$/i.exec(raw);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
      continue;
    }
    if (/^\d+$/.test(raw)) {
      max = Math.max(max, parseInt(raw, 10));
    }
  }
  return `QT-${String(max + 1).padStart(4, '0')}`;
}

function parseItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const product = String(item.product ?? item.name ?? '').trim();
    const quantity = toNonNegNumber(item.quantity ?? item.amount);
    const unitCost = toNonNegMoney(item.unitCost ?? item.unitPrice ?? item.cost);
    if (!product && quantity <= 0 && unitCost <= 0) continue;
    const entry = {
      product,
      quantity,
      unitCost,
      lineTotal: lineTotal(quantity, unitCost),
    };
    const productKey = String(item.productKey ?? item.key ?? '').trim();
    if (productKey) entry.productKey = productKey;
    out.push(entry);
  }
  return out;
}

function parseConditions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    validUntil: normalizeYmd(src.validUntil),
    paymentTerms: String(src.paymentTerms ?? '').trim(),
    deliveryTerms: String(src.deliveryTerms ?? '').trim(),
    pricesSubjectToChange: Boolean(src.pricesSubjectToChange),
    stockAvailability: Boolean(src.stockAvailability),
    quotationNotOrder: Boolean(src.quotationNotOrder),
    vatAlsoAdded: Boolean(src.vatAlsoAdded),
  };
}

function itemsTotalAmount(items) {
  return roundMoney((Array.isArray(items) ? items : []).reduce((sum, item) => sum + lineTotal(item.quantity, item.unitCost), 0));
}

/**
 * Validate create/update body.
 * @returns {{ error?: string, payload?: object }}
 */
function validateQuotationBody(body, { customerById } = {}) {
  const recordedBy = String(body.recordedBy ?? body.createdBy ?? '').trim();
  if (!recordedBy) {
    return { error: 'recordedBy (username) is required' };
  }

  let date = normalizeYmd(body.date);
  if (!date) date = todayYmdLocal();

  const customerId = String(body.customerId ?? '').trim();
  if (!customerId) {
    return { error: 'Select a customer' };
  }
  const customer = customerById?.get(customerId);
  if (!customer) {
    return { error: 'Selected customer was not found' };
  }

  const items = parseItems(body.items);
  if (items.length === 0) {
    return { error: 'Add at least one item' };
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.product) {
      return { error: `Item ${i + 1}: select a product` };
    }
    if (item.unitCost <= 0) {
      return { error: `Item ${i + 1}: per item cost must be greater than 0` };
    }
    if (item.quantity <= 0) {
      return { error: `Item ${i + 1}: amount must be greater than 0` };
    }
  }

  const conditions = parseConditions(body.conditions ?? body);
  if (!conditions.validUntil) {
    return { error: 'Valid until date is required' };
  }
  if (conditions.validUntil < date) {
    return { error: 'Valid until must be on or after the quotation date' };
  }
  if (!conditions.paymentTerms) {
    return { error: 'Payment terms are required' };
  }
  if (!conditions.deliveryTerms) {
    return { error: 'Delivery terms are required' };
  }
  if (!conditions.pricesSubjectToChange) {
    return { error: 'Confirm that prices are subject to change until confirmation' };
  }
  if (!conditions.stockAvailability) {
    return { error: 'Confirm that supply depends on stock availability' };
  }
  if (!conditions.quotationNotOrder) {
    return { error: 'Confirm that this quotation is not a confirmed order' };
  }

  const note = String(body.note ?? '').trim();
  const quotationNumber = String(body.quotationNumber ?? '').trim();

  const payload = {
    date,
    customerId,
    customerName: String(customer.name ?? '').trim(),
    items,
    totalAmount: itemsTotalAmount(items),
    conditions,
    note,
    recordedBy,
  };
  if (quotationNumber) payload.quotationNumber = quotationNumber;

  return { payload };
}

function normalizeQuotation(row) {
  const items = parseItems(row.items);
  const conditions = parseConditions(row.conditions ?? row);
  const entry = {
    id: String(row.id ?? '').trim(),
    quotationNumber: String(row.quotationNumber ?? '').trim(),
    date: normalizeYmd(row.date) || todayYmdLocal(),
    customerId: String(row.customerId ?? '').trim(),
    customerName: String(row.customerName ?? '').trim(),
    items,
    totalAmount: items.length > 0 ? itemsTotalAmount(items) : toNonNegMoney(row.totalAmount),
    conditions,
    note: String(row.note ?? '').trim(),
    recordedBy: String(row.recordedBy ?? row.createdBy ?? '').trim(),
    createdAt: String(row.createdAt ?? '').trim() || new Date().toISOString(),
  };
  const updatedAt = String(row.updatedAt ?? '').trim();
  if (updatedAt) entry.updatedAt = updatedAt;
  const updatedBy = String(row.updatedBy ?? '').trim();
  if (updatedBy) entry.updatedBy = updatedBy;
  return entry;
}

module.exports = {
  readQuotations,
  writeQuotations,
  normalizeQuotation,
  validateQuotationBody,
  nextSuggestedQuotationNumber,
  parseItems,
  itemsTotalAmount,
  lineTotal,
  DEFAULT_PAYMENT_TERMS,
  DEFAULT_DELIVERY_TERMS,
};
