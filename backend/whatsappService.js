const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { readWhatsAppConfig } = require('./whatsappConfigsStore');
const { readCompanyData } = require('./companyDataStore');
const { appendSentWhatsapp } = require('./sentWhatsappStore');
const {
  buildBillWhatsApp,
  buildPaymentWhatsApp,
  buildPromotionWhatsApp,
} = require('./whatsappTemplates');

const SESSION_PATH = path.join(__dirname, 'data', 'wwebjs_auth');

let client = null;
let clientState = 'idle';
let lastQrDataUrl = null;
let initPromise = null;

function normalizePhoneForWhatsApp(contactNumber) {
  const digits = String(contactNumber ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('94') && digits.length >= 11) return digits;
  if (digits.startsWith('0') && digits.length >= 9) return `94${digits.slice(1)}`;
  if (digits.length === 9) return `94${digits}`;
  return digits;
}

function getWhatsAppStatus() {
  return {
    state: clientState,
    connected: clientState === 'ready',
    qrDataUrl: clientState === 'qr' ? lastQrDataUrl : null,
  };
}

function attachClientEvents(waClient) {
  waClient.on('qr', async (qr) => {
    clientState = 'qr';
    try {
      lastQrDataUrl = await qrcode.toDataURL(qr);
    } catch (err) {
      console.error('whatsapp qr encode', err);
      lastQrDataUrl = null;
    }
  });

  waClient.on('authenticated', () => {
    clientState = 'authenticated';
    lastQrDataUrl = null;
  });

  waClient.on('ready', () => {
    clientState = 'ready';
    lastQrDataUrl = null;
    console.log('[whatsapp] client ready');
  });

  waClient.on('auth_failure', (msg) => {
    clientState = 'auth_failure';
    lastQrDataUrl = null;
    console.error('[whatsapp] auth failure', msg);
  });

  waClient.on('disconnected', (reason) => {
    clientState = 'disconnected';
    lastQrDataUrl = null;
    client = null;
    initPromise = null;
    console.warn('[whatsapp] disconnected', reason);
  });
}

async function destroyClient() {
  if (!client) return;
  try {
    await client.destroy();
  } catch (err) {
    console.error('whatsapp destroy', err);
  }
  client = null;
  initPromise = null;
  clientState = 'idle';
  lastQrDataUrl = null;
}

async function startWhatsAppClient() {
  const config = await readWhatsAppConfig();
  if (!config.enabled) {
    await destroyClient();
    return null;
  }

  if (client && (clientState === 'ready' || clientState === 'qr' || clientState === 'authenticated')) {
    return client;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    await destroyClient();
    clientState = 'initializing';

    const waClient = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    attachClientEvents(waClient);
    client = waClient;

    try {
      await waClient.initialize();
    } catch (err) {
      console.error('whatsapp initialize', err);
      clientState = 'disconnected';
      client = null;
      initPromise = null;
      throw err;
    }

    return waClient;
  })();

  return initPromise;
}

async function applyWhatsAppConfigChange(enabled) {
  if (!enabled) {
    await destroyClient();
    return getWhatsAppStatus();
  }
  startWhatsAppClient().catch((err) => console.error('whatsapp start after config', err));
  return getWhatsAppStatus();
}

async function sendCustomerWhatsApp({ type, customer, record, remainingAmount }) {
  const phone = normalizePhoneForWhatsApp(customer?.contactNumber);
  if (!phone) return null;

  const config = await readWhatsAppConfig();
  if (!config.enabled) return null;

  let built;
  const company = await readCompanyData();
  switch (type) {
    case 'bill':
      built = buildBillWhatsApp({ customer, bill: record, remainingAmount, company });
      break;
    case 'payment':
      built = buildPaymentWhatsApp({ customer, payment: record, remainingAmount, company });
      break;
    case 'promotion':
      built = buildPromotionWhatsApp({ customer, promotion: record, company });
      break;
    default:
      return null;
  }

  try {
    await startWhatsAppClient();
    if (!client || clientState !== 'ready') {
      await appendSentWhatsapp({
        type,
        to: phone,
        customerName: customer.name,
        preview: built.preview,
        status: 'failed',
        error: 'WhatsApp is not connected. Scan the QR code in Messages settings.',
        referenceId: record.id,
      });
      return { ok: false, error: 'WhatsApp not connected' };
    }

    const chatId = `${phone}@c.us`;
    await client.sendMessage(chatId, built.text);
    await appendSentWhatsapp({
      type,
      to: phone,
      customerName: customer.name,
      preview: built.preview,
      status: 'sent',
      error: null,
      referenceId: record.id,
    });
    return { ok: true };
  } catch (err) {
    console.error(`whatsapp notification (${type})`, err);
    await appendSentWhatsapp({
      type,
      to: phone,
      customerName: customer.name,
      preview: built.preview,
      status: 'failed',
      error: err.message || 'Send failed',
      referenceId: record.id,
    });
    return { ok: false, error: err.message };
  }
}

function notifyBillWhatsApp(customer, bill, remainingAmount) {
  return sendCustomerWhatsApp({ type: 'bill', customer, record: bill, remainingAmount });
}

function notifyPaymentWhatsApp(customer, payment, remainingAmount) {
  return sendCustomerWhatsApp({ type: 'payment', customer, record: payment, remainingAmount });
}

function notifyPromotionWhatsApp(customer, promotion) {
  return sendCustomerWhatsApp({ type: 'promotion', customer, record: promotion });
}

module.exports = {
  getWhatsAppStatus,
  startWhatsAppClient,
  applyWhatsAppConfigChange,
  destroyClient,
  notifyBillWhatsApp,
  notifyPaymentWhatsApp,
  notifyPromotionWhatsApp,
  sendCustomerWhatsApp,
  normalizePhoneForWhatsApp,
};
