const fs = require('fs').promises;
const path = require('path');

const PAYMENT_RECEIPT_SETTINGS_FILE = path.join(
  __dirname,
  '..',
  'data',
  'paymentReceiptSettings.json',
);

const DEFAULT_PAYMENT_RECEIPT_SETTINGS = {
  printCustomerOutstanding: false,
};

function normalizePaymentReceiptSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    printCustomerOutstanding: Boolean(src.printCustomerOutstanding),
  };
}

async function readPaymentReceiptSettings() {
  try {
    const raw = await fs.readFile(PAYMENT_RECEIPT_SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return normalizePaymentReceiptSettings(data);
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_PAYMENT_RECEIPT_SETTINGS };
    throw e;
  }
}

async function writePaymentReceiptSettings(settings) {
  const current = await readPaymentReceiptSettings();
  const src = settings && typeof settings === 'object' ? settings : {};
  const next = normalizePaymentReceiptSettings({
    ...current,
    ...src,
  });
  await fs.mkdir(path.dirname(PAYMENT_RECEIPT_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(PAYMENT_RECEIPT_SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function isPrintCustomerOutstandingEnabled() {
  const settings = await readPaymentReceiptSettings();
  return Boolean(settings.printCustomerOutstanding);
}

module.exports = {
  PAYMENT_RECEIPT_SETTINGS_FILE,
  DEFAULT_PAYMENT_RECEIPT_SETTINGS,
  normalizePaymentReceiptSettings,
  readPaymentReceiptSettings,
  writePaymentReceiptSettings,
  isPrintCustomerOutstandingEnabled,
};
