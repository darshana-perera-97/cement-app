const fs = require('fs').promises;
const path = require('path');

const BILLING_PRICE_REQUESTS_FILE = path.join(__dirname, '..', 'data', 'billingPriceRequests.json');

function normalizeStatus(status) {
  const s = String(status ?? 'pending').trim().toLowerCase();
  if (s === 'approved' || s === 'rejected') return s;
  return 'pending';
}

async function readBillingPriceRequests() {
  try {
    const raw = await fs.readFile(BILLING_PRICE_REQUESTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeBillingPriceRequests(records) {
  await fs.mkdir(path.dirname(BILLING_PRICE_REQUESTS_FILE), { recursive: true });
  await fs.writeFile(BILLING_PRICE_REQUESTS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

module.exports = {
  readBillingPriceRequests,
  writeBillingPriceRequests,
  normalizeBillingPriceRequestStatus: normalizeStatus,
  BILLING_PRICE_REQUESTS_FILE,
};
