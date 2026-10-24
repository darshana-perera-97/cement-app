const fs = require('fs').promises;
const path = require('path');
const { getAuthFromRequest } = require('./authToken');
const { findUserByUsername } = require('./usersStore');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');
const MAX_HISTORY = 10000;

const SKIP_PATHS = new Set(['/api/login', '/api/driver/login', '/api/field-locations']);

const ENTITY_RULES = [
  ['/api/unload-requests', 'unload request'],
  ['/api/payment-requests', 'payment request'],
  ['/api/collector/unloads', 'unload prices'],
  ['/api/unloads', 'unload'],
  ['/api/purchase-orders', 'purchase order'],
  ['/api/cheque-deposits', 'cheque deposit'],
  ['/api/payments', 'payment collection'],
  ['/api/bills', 'billing'],
  ['/api/returns', 'return'],
  ['/api/customers', 'customer'],
  ['/api/users', 'user'],
  ['/api/stocks', 'stock addition'],
  ['/api/lorries', 'lorry'],
  ['/api/distributors', 'distributor'],
  ['/api/promotion-rules', 'promotion rule'],
  ['/api/promotions', 'promotion'],
  ['/api/cash-book-entries', 'cash book entry'],
  ['/api/bank-guarantees', 'bank guarantee'],
  ['/api/shop/bank-accounts', 'bank account'],
  ['/api/shop/products', 'product'],
  ['/api/shop/door-stock-transport-settings', 'door stock transport settings'],
  ['/api/shop-stocks', 'shop stock'],
  ['/api/map-shops', 'map shops'],
  ['/api/printer-settings', 'printer settings'],
  ['/api/stock-update-settings', 'stock update settings'],
  ['/api/collector-unload-price-settings', 'collector unload price settings'],
  ['/api/stock-item-unload-price-settings', 'unload price settings'],
  ['/api/backup/settings', 'backup settings'],
  ['/api/backup/email', 'data backup'],
  ['/api/collection-day-close', 'collection day'],
  ['/api/messages/notification-settings', 'notification settings'],
  ['/api/messages/email-config', 'email settings'],
  ['/api/messages/company-data', 'company details'],
  ['/api/messages/whatsapp', 'WhatsApp'],
  ['/api/shop', 'shop'],
];

const DETAIL_KEYS = {
  name: ['customerName', 'name', 'shopName', 'driverName', 'distributorName', 'accountName', 'productName', 'product'],
  shop: ['customerName', 'shopName'],
  ref: [
    'invoiceNumber',
    'billNumber',
    'receiptNumber',
    'stockId',
    'vehicleNumber',
    'lorryNumber',
    'chequeNumber',
    'poNumber',
    'orderNumber',
    'number',
    'username',
    'category',
    'bankName',
    'role',
  ],
  amount: ['totalAmount', 'amount', 'discountAmount', 'cashAmount'],
  date: ['date'],
  note: ['note', 'reason', 'particulars', 'description', 'title', 'location'],
};

/** Routes where `name` on the payload is the customer / shop label. */
const SHOP_NAME_AS_NAME_PATHS = [
  '/api/customers',
  '/api/bills',
  '/api/payments',
  '/api/returns',
  '/api/unloads',
  '/api/unload-requests',
  '/api/payment-requests',
  '/api/promotions',
  '/api/shop-stocks',
  '/api/map-shops',
];

const PROMO_TYPE_LABELS = {
  free_bags: 'free bags',
  invoice_discount: 'invoice discount',
  target_promotion: 'target promotion',
  rule_cashback: 'rule cashback',
};

const DESCRIPTION_ENTITY = {
  'payment collection': 'payment',
  'stock addition': 'stock',
  'free bag issue': 'free bags',
  billing: 'billing',
  'purchase order': 'purchase order',
};

let writeQueue = Promise.resolve();

function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function colomboStamp(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  let hour = parts.hour || '00';
  if (hour === '24') hour = '00';
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}:${parts.second}`,
  };
}

async function readActivityHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function appendActivity(entry) {
  return enqueue(async () => {
    const records = await readActivityHistory();
    records.unshift(entry);
    const trimmed = records.slice(0, MAX_HISTORY);
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    await fs.writeFile(HISTORY_FILE, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
    return entry;
  });
}

function pathMatches(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function promotionTypeLabel(records) {
  const type = firstText(records, ['type']).toLowerCase() || 'free_bags';
  return PROMO_TYPE_LABELS[type] || PROMO_TYPE_LABELS.free_bags;
}

function entityFor(pathname, body, response) {
  const records = recordsToScan(body, response, pathname);
  if (pathMatches(pathname, '/api/promotions')) {
    return promotionTypeLabel(records);
  }
  if (pathMatches(pathname, '/api/unload-requests') && /\/approve$/.test(pathname)) {
    return 'billing';
  }
  if (pathMatches(pathname, '/api/payment-requests') && /\/approve$/.test(pathname)) {
    return 'payment collection';
  }
  for (const [prefix, label] of ENTITY_RULES) {
    if (pathMatches(pathname, prefix)) return label;
  }
  return 'record';
}

function descriptionEntity(entity) {
  return DESCRIPTION_ENTITY[entity] || entity;
}

function categoryFor(pathname, body, response) {
  const entity = entityFor(pathname, body, response);
  if (entity === 'free bags') return 'Free bag issue';
  if (entity === 'payment collection') return 'Payment collection';
  if (entity === 'billing') return 'Billing';
  if (entity === 'purchase order') return 'Purchase order';
  if (entity === 'stock addition') return 'Stock addition';
  if (entity === 'invoice discount') return 'Invoice discount';
  if (entity === 'target promotion') return 'Target promotion';
  if (entity === 'rule cashback') return 'Rule cashback';
  return entity.charAt(0).toUpperCase() + entity.slice(1);
}

function classify(method, pathname) {
  if (pathMatches(pathname, '/api/unload-requests') && /\/approve$/.test(pathname)) {
    return { action: 'accept', verb: 'Created' };
  }
  if (pathMatches(pathname, '/api/payment-requests') && /\/approve$/.test(pathname)) {
    return { action: 'accept', verb: 'Recorded' };
  }
  if (/\/approve$/.test(pathname)) return { action: 'accept', verb: 'Accepted' };
  if (/\/reject$/.test(pathname)) return { action: 'cancel', verb: 'Rejected' };
  if (/\/cancel$/.test(pathname) || /\/cancel-cheque$/.test(pathname)) {
    return { action: 'cancel', verb: 'Cancelled' };
  }
  if (/\/cheque-deposited$/.test(pathname)) return { action: 'edit', verb: 'Marked deposited' };
  if (/\/cheque-returned$/.test(pathname)) return { action: 'edit', verb: 'Marked returned' };
  if (pathname === '/api/backup/email') return { action: 'add', verb: 'Sent' };
  if (pathname === '/api/collection-day-close') return { action: 'add', verb: 'Closed' };
  if (pathname.endsWith('/reconnect')) return { action: 'edit', verb: 'Reconnected' };
  if (pathname.endsWith('/reset-session')) return { action: 'edit', verb: 'Reset' };
  if (method === 'DELETE') return { action: 'delete', verb: 'Deleted' };
  if (method === 'POST') {
    if (pathMatches(pathname, '/api/payments')) return { action: 'add', verb: 'Collected' };
    if (pathMatches(pathname, '/api/bills')) return { action: 'add', verb: 'Created' };
    if (pathMatches(pathname, '/api/stocks')) return { action: 'add', verb: 'Added' };
    if (pathMatches(pathname, '/api/purchase-orders')) return { action: 'add', verb: 'Created' };
    if (pathMatches(pathname, '/api/promotions')) return { action: 'add', verb: 'Issued' };
    return { action: 'add', verb: 'Added' };
  }
  if (method === 'PUT' || method === 'PATCH') return { action: 'edit', verb: 'Edited' };
  return null;
}

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function recordsToScan(body, response, pathname) {
  const list = [];
  const push = (value) => {
    const record = asRecord(value);
    if (record) list.push(record);
  };
  const pushMany = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    push(value);
  };
  const responseRecord = asRecord(response);
  if (responseRecord) {
    if (/\/approve$/.test(pathname)) {
      push(responseRecord.bill);
      push(responseRecord.request);
      push(responseRecord.payment);
    } else if (/\/reject$/.test(pathname)) {
      push(responseRecord.request);
      push(responseRecord.payment);
    }
    pushMany(responseRecord.created);
    push(responseRecord);
  }
  push(body);
  return list;
}

function cleanText(value) {
  if (value == null || typeof value === 'object') return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || text.length > 180) return text.slice(0, 180);
  return text;
}

function isGeneratedId(value) {
  return /^[a-z]+-\d{10,}-[a-z0-9]+$/i.test(value);
}

function firstText(records, keys) {
  for (const record of records) {
    for (const key of keys) {
      const text = cleanText(record[key]);
      if (!text || isGeneratedId(text)) continue;
      return text;
    }
  }
  return '';
}

function formatMoney(n) {
  return `LKR ${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(n) {
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function humanizeKey(key) {
  return String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function productLabelFromPrefix(prefix) {
  const raw = String(prefix || '').trim();
  if (!raw) return '';
  if (raw === 'tokyo') return 'Tokyo';
  if (raw === 'samudra') return 'Samudra';
  if (raw === 'nippon') return 'Nippon';
  if (raw === 'atlas') return 'Atlas';
  return humanizeKey(raw);
}

const SKIP_NUMERIC_KEYS = new Set([
  'id',
  'customerId',
  'collectorUserId',
  'distributorId',
  'driverId',
  'bankAccountId',
  'billId',
  'poId',
  'userId',
  'shopId',
  'exp',
  'count',
  'statusCode',
  'overdueDays',
  'pending',
]);

const MONEY_KEY_RE =
  /(amount|total|cost|price|line|cash|cheque|cdm|transfer|discount|charge|balance|credit|debit)$/i;
const BAG_KEY_RE = /(Bags|bags)$/;
const QTY_KEY_RE = /^(quantity|qty|bags)$/i;

function positiveNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function moneyLabelForKey(key) {
  const k = String(key);
  if (/^cashAmount$/i.test(k)) return 'Cash';
  if (/^chequeAmount$/i.test(k)) return 'Cheque';
  if (/^cdmAmount$/i.test(k)) return 'CDM';
  if (/onlineTransferAmount$/i.test(k)) return 'Online transfer';
  if (/^discountAmount$/i.test(k)) return 'Discount';
  if (/^totalAmount$/i.test(k) || /^amount$/i.test(k) || /^lineTotal$/i.test(k)) return 'Total';
  if (/CutOffPrice$/i.test(k)) return 'Cut-off';
  if (/UnloadPrice$/i.test(k)) return 'Unload price';
  if (/UnitPrice$/i.test(k)) return 'Unit price';
  if (/Cost$/i.test(k)) return 'Cost';
  if (/Line$/i.test(k)) return 'Line';
  return humanizeKey(k);
}

function collectProductNumericParts(record) {
  const groups = new Map();
  for (const [key, value] of Object.entries(record || {})) {
    const bagMatch = key.match(/^(.*)Bags$/);
    const unitMatch = key.match(/^(.*)UnitPrice$/);
    const lineMatch = key.match(/^(.*)Line$/);
    const costMatch = key.match(/^(.*)Cost$/);
    const cutMatch = key.match(/^(.*)CutOffPrice$/);
    const unloadMatch = key.match(/^(.*)UnloadPrice$/);
    const match = bagMatch || unitMatch || lineMatch || costMatch || cutMatch || unloadMatch;
    if (!match) continue;
    const prefix = match[1];
    if (!groups.has(prefix)) groups.set(prefix, {});
    const g = groups.get(prefix);
    const n = positiveNumber(value);
    if (n == null) continue;
    if (bagMatch) g.bags = n;
    else if (unitMatch) g.unitPrice = n;
    else if (lineMatch) g.line = n;
    else if (costMatch) g.cost = n;
    else if (cutMatch) g.cutOff = n;
    else if (unloadMatch) g.unload = n;
  }

  const parts = [];
  for (const [prefix, g] of groups) {
    if (!g.bags && !g.line && !g.cost && !g.unitPrice && !g.cutOff && !g.unload) continue;
    const label = productLabelFromPrefix(prefix);
    const bits = [label];
    if (g.bags) bits.push(`${formatNumber(g.bags)} bag${g.bags === 1 ? '' : 's'}`);
    if (g.unitPrice) bits.push(`@ ${formatMoney(g.unitPrice)}`);
    if (g.cutOff) bits.push(`cut-off ${formatMoney(g.cutOff)}`);
    if (g.unload) bits.push(`unload ${formatMoney(g.unload)}`);
    if (g.cost) bits.push(`cost ${formatMoney(g.cost)}`);
    if (g.line) bits.push(`= ${formatMoney(g.line)}`);
    parts.push(bits.join(' '));
  }
  return parts;
}

function collectNestedNumericParts(record) {
  const parts = [];
  const cheques = Array.isArray(record?.cheques) ? record.cheques : [];
  cheques.forEach((cheque, index) => {
    const amount = positiveNumber(cheque?.amount);
    if (amount == null) return;
    const num = cleanText(cheque?.chequeNumber);
    const label = num ? `Cheque #${num}` : `Cheque ${index + 1}`;
    parts.push(`${label} ${formatMoney(amount)}`);
  });

  const items = Array.isArray(record?.items) ? record.items : [];
  items.forEach((item) => {
    const product = cleanText(item?.product || item?.name);
    const qty = positiveNumber(item?.quantity ?? item?.qty ?? item?.bags);
    const unitPrice = positiveNumber(item?.unitPrice ?? item?.price);
    const line = positiveNumber(item?.lineTotal ?? item?.amount ?? item?.totalAmount);
    if (!product && qty == null && unitPrice == null && line == null) return;
    const bits = [];
    if (product) bits.push(product);
    if (qty != null) bits.push(`qty ${formatNumber(qty)}`);
    if (unitPrice != null) bits.push(`@ ${formatMoney(unitPrice)}`);
    if (line != null) bits.push(`= ${formatMoney(line)}`);
    if (bits.length) parts.push(bits.join(' '));
  });

  const cashbackLines = Array.isArray(record?.cashbackLines) ? record.cashbackLines : [];
  cashbackLines.forEach((line) => {
    const bags = positiveNumber(line?.bags);
    const rate = positiveNumber(line?.rate);
    const amount = positiveNumber(line?.amount);
    const key = productLabelFromPrefix(line?.key || '');
    const bits = [];
    if (key) bits.push(key);
    if (bags != null) bits.push(`${formatNumber(bags)} bags`);
    if (rate != null) bits.push(`@ ${formatMoney(rate)}`);
    if (amount != null) bits.push(`= ${formatMoney(amount)}`);
    if (bits.length) parts.push(bits.join(' '));
  });

  const cdm = Array.isArray(record?.cdmDeposits) ? record.cdmDeposits : [];
  cdm.forEach((row, index) => {
    const amount = positiveNumber(row?.amount);
    if (amount == null) return;
    parts.push(`CDM ${index + 1} ${formatMoney(amount)}`);
  });

  const transfers = Array.isArray(record?.onlineTransfers) ? record.onlineTransfers : [];
  transfers.forEach((row, index) => {
    const amount = positiveNumber(row?.amount);
    if (amount == null) return;
    parts.push(`Online transfer ${index + 1} ${formatMoney(amount)}`);
  });

  return parts;
}

function collectTopLevelNumericParts(record, usedKeys) {
  const parts = [];
  for (const [key, value] of Object.entries(record || {})) {
    if (SKIP_NUMERIC_KEYS.has(key)) continue;
    if (usedKeys.has(key)) continue;
    if (/^(.*)(Bags|UnitPrice|Line|Cost|CutOffPrice|UnloadPrice)$/.test(key)) continue;
    const n = positiveNumber(value);
    if (n == null) continue;
    if (BAG_KEY_RE.test(key) || QTY_KEY_RE.test(key)) {
      const label = /^bags$/i.test(key) ? 'Bags' : /^quantity$|^qty$/i.test(key) ? 'Qty' : humanizeKey(key);
      parts.push(`${label} ${formatNumber(n)}`);
      usedKeys.add(key);
      continue;
    }
    if (MONEY_KEY_RE.test(key) || /Amount|Price|Cost|Total|Line/i.test(key)) {
      parts.push(`${moneyLabelForKey(key)} ${formatMoney(n)}`);
      usedKeys.add(key);
    }
  }
  return parts;
}

/** Prefer the richest business record (bill/payment/load/PO/promo), not the wrapper. */
function primaryNumericRecords(records) {
  const scored = records.map((record, index) => {
    let score = 0;
    for (const [key, value] of Object.entries(record || {})) {
      if (positiveNumber(value) != null) score += 1;
      if (/Bags$|Amount$|totalAmount|quantity|unitPrice/i.test(key) && positiveNumber(value) != null) {
        score += 3;
      }
      if (Array.isArray(value) && value.length) score += 2;
    }
    if (record.customerName || record.distributorName || record.stockId || record.poNumber) score += 2;
    return { record, index, score };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = scored.filter((row) => row.score > 0).slice(0, 2).map((row) => row.record);
  return best.length ? best : records.slice(0, 1);
}

function collectAllNumericParts(records) {
  const parts = [];
  const seen = new Set();
  const pushUnique = (part) => {
    const text = String(part || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    parts.push(text);
  };

  for (const record of primaryNumericRecords(records)) {
    const usedKeys = new Set();
    for (const part of collectProductNumericParts(record)) pushUnique(part);
    for (const part of collectNestedNumericParts(record)) pushUnique(part);
    // Mark product-prefixed keys as used so top-level pass skips them.
    for (const key of Object.keys(record || {})) {
      if (/^(.*)(Bags|UnitPrice|Line|Cost|CutOffPrice|UnloadPrice)$/.test(key)) usedKeys.add(key);
    }
    for (const part of collectTopLevelNumericParts(record, usedKeys)) pushUnique(part);
  }
  return parts;
}

function extractShopName(pathname, body, response) {
  const records = recordsToScan(body, response, pathname);
  let shopName = firstText(records, DETAIL_KEYS.shop);
  if (shopName) return shopName;
  const usesNameAsShop = SHOP_NAME_AS_NAME_PATHS.some((prefix) => pathMatches(pathname, prefix));
  if (usesNameAsShop) {
    shopName = firstText(records, ['name']);
  }
  return shopName || '';
}

function buildDescription(kind, pathname, body, response) {
  const entity = entityFor(pathname, body, response);
  const records = recordsToScan(body, response, pathname);
  const shopName = extractShopName(pathname, body, response);
  const name = shopName || firstText(records, DETAIL_KEYS.name);
  const ref = firstText(records, DETAIL_KEYS.ref);
  const date = firstText(records, DETAIL_KEYS.date);
  const note = firstText(records, DETAIL_KEYS.note);
  const parts = [];
  if (name) parts.push(name);
  const readableRef = /_/.test(ref) && !/\d/.test(ref) ? ref.replace(/_/g, ' ') : ref;
  if (readableRef && readableRef.toLowerCase() !== name.toLowerCase()) parts.push(readableRef);
  for (const numericPart of collectAllNumericParts(records)) {
    parts.push(numericPart);
  }
  const label = descriptionEntity(entity);
  const subject = parts.length ? `${label} · ${parts.join(' · ')}` : label;
  let text = `${kind.verb} ${subject}`;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !text.includes(date)) text += ` (${date})`;
  if (note && note.toLowerCase() !== name.toLowerCase() && !text.includes(note)) {
    const short = note.length > 80 ? `${note.slice(0, 77)}…` : note;
    text += ` — ${short}`;
  }
  return text;
}

function actorUsername(req) {
  const auth = getAuthFromRequest(req);
  if (auth?.username) return String(auth.username).trim();
  const body = asRecord(req.body) || {};
  const fallback = [
    body.cancelledBy,
    body.rejectedBy,
    body.enteredBy,
    body.recordedBy,
    body.addedBy,
    body.updatedBy,
    body.username,
  ]
    .map((value) => String(value ?? '').trim())
    .find(Boolean);
  return fallback || '';
}

async function actorName(username) {
  if (!username) return 'Unknown';
  try {
    const user = await findUserByUsername(username);
    const name = String(user?.name || '').trim();
    return name || username;
  } catch (e) {
    console.error('[history] user lookup failed', e);
    return username;
  }
}

async function recordActivity(req, pathname, responseBody) {
  const kind = classify(req.method, pathname);
  if (!kind) return null;
  const username = actorUsername(req);
  const userName = await actorName(username);
  const stamp = colomboStamp();
  const shopName = extractShopName(pathname, req.body, responseBody);
  const category = categoryFor(pathname, req.body, responseBody);
  const entry = {
    id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at: new Date().toISOString(),
    date: stamp.date,
    time: stamp.time,
    userName,
    username,
    shopName,
    category,
    action: kind.action,
    description: buildDescription(kind, pathname, req.body, responseBody),
  };
  await appendActivity(entry);
  return entry;
}

function installActivityHistory(app) {
  app.use((req, res, next) => {
    const method = req.method;
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
      return next();
    }
    const pathname = String(req.path || '').replace(/\/+$/, '') || '/';
    if (!pathname.startsWith('/api/') || SKIP_PATHS.has(pathname)) return next();

    const original = res.json.bind(res);
    let logged = false;
    res.json = function historyJson(body) {
      if (!logged) {
        logged = true;
        const status = res.statusCode || 200;
        if (status >= 200 && status < 300) {
          recordActivity(req, pathname, body).catch((err) => {
            console.error('[history] failed to record activity', err);
          });
        }
      }
      return original(body);
    };
    next();
  });
}

module.exports = {
  HISTORY_FILE,
  MAX_HISTORY,
  readActivityHistory,
  installActivityHistory,
  buildDescription,
  classify,
};
