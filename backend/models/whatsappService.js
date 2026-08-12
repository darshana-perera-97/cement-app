const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { readNotificationSettings, isNotificationTypeEnabled } = require('./notificationSettingsStore');
const { readWhatsAppConfig, writeWhatsAppConfig } = require('./whatsappConfigsStore');
const { readCompanyData } = require('./companyDataStore');
const { getBagProducts } = require('./bagProducts');
const { appendSentWhatsapp } = require('./sentWhatsappStore');
const {
  buildBillWhatsApp,
  buildPaymentWhatsApp,
  buildPromotionWhatsApp,
  buildChequeReturnWhatsApp,
  buildOverdueBalanceWhatsApp,
  buildUnloadWhatsApp,
} = require('./whatsappTemplates');

const SESSION_PATH = path.join(__dirname, '..', 'data', 'wwebjs_auth');
const SESSION_DIR = path.join(SESSION_PATH, 'session');
const WEB_CACHE_PATH = path.join(__dirname, '..', '.wwebjs_cache');
/** Cached WA Web build used when this session was linked (see backend/.wwebjs_cache). */
const WEB_VERSION = '2.3000.1044312693';
const RECONNECT_DELAY_MS = 5000;
const STUCK_RESTORE_TIMEOUT_MS = 90000;

let client = null;
let clientState = 'idle';
let lastQrDataUrl = null;
let initPromise = null;
let reconnectTimer = null;
let stuckWatchdogTimer = null;
let stateEnteredAt = 0;
let connectionInfo = null;
let lastKnownConnection = null;

function normalizeConnectionInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const phone = String(info.phone ?? '').trim();
  const pushname = String(info.pushname ?? '').trim();
  const platform = String(info.platform ?? '').trim();
  const connectedAt = String(info.connectedAt ?? '').trim();
  if (!phone && !pushname && !platform && !connectedAt) return null;
  return { phone, pushname, platform, connectedAt };
}

function readClientConnectionInfo(waClient) {
  const info = waClient?.info;
  if (!info) return null;
  const user = info.wid?.user ? String(info.wid.user) : '';
  return normalizeConnectionInfo({
    phone: user ? `+${user}` : '',
    pushname: info.pushname || '',
    platform: info.platform || '',
    connectedAt: new Date().toISOString(),
  });
}

async function persistConnectionInfo(info) {
  const normalized = normalizeConnectionInfo(info);
  if (!normalized) return;
  lastKnownConnection = normalized;
  try {
    const config = await readWhatsAppConfig();
    await writeWhatsAppConfig({ ...config, lastConnection: normalized });
  } catch (err) {
    console.error('whatsapp persist connection', err);
  }
}

async function loadLastKnownConnection() {
  try {
    const config = await readWhatsAppConfig();
    lastKnownConnection = config.lastConnection || null;
  } catch (err) {
    console.error('whatsapp load last connection', err);
    lastKnownConnection = null;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearStuckWatchdog() {
  if (stuckWatchdogTimer) {
    clearTimeout(stuckWatchdogTimer);
    stuckWatchdogTimer = null;
  }
}

function markStateEntered(state) {
  if (state === 'initializing' || state === 'authenticated') {
    stateEnteredAt = Date.now();
    scheduleStuckWatchdog();
    return;
  }
  clearStuckWatchdog();
}

function scheduleStuckWatchdog() {
  clearStuckWatchdog();
  stuckWatchdogTimer = setTimeout(async () => {
    stuckWatchdogTimer = null;
    if (clientState !== 'initializing' && clientState !== 'authenticated') return;
    const elapsedSec = Math.round((Date.now() - stateEnteredAt) / 1000);
    console.warn(`[whatsapp] stuck in ${clientState} for ${elapsedSec}s — forcing reconnect`);
    try {
      await destroyClient();
      await prepareSessionForLaunch();
      await startWhatsAppClient();
    } catch (err) {
      console.error('[whatsapp] stuck watchdog reconnect', err);
      scheduleReconnect('stuck_watchdog');
    }
  }, STUCK_RESTORE_TIMEOUT_MS);
}

function buildWhatsAppClientOptions() {
  return {
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    webVersion: WEB_VERSION,
    webVersionCache: {
      type: 'local',
      path: WEB_CACHE_PATH,
      strict: true,
    },
    takeoverOnConflict: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killOrphanedSessionBrowsers() {
  const userDataArg = `user-data-dir=${SESSION_DIR}`;
  try {
    execSync(`pkill -f '${userDataArg.replace(/'/g, "'\\''")}'`, { stdio: 'ignore' });
  } catch (_) {
    // pkill exits 1 when no matching process is found
  }

  try {
    execSync(`pkill -f '${SESSION_DIR.replace(/'/g, "'\\''")}'`, { stdio: 'ignore' });
  } catch (_) {}

  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.unlinkSync(path.join(SESSION_DIR, name));
    } catch (_) {}
  }
}

async function prepareSessionForLaunch() {
  killOrphanedSessionBrowsers();
  await sleep(750);
}

let shutdownHandlersRegistered = false;

function registerShutdownHandlers() {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;

  const shutdown = async (signal) => {
    clearReconnectTimer();
    clearStuckWatchdog();
    console.log(`[whatsapp] shutting down (${signal})…`);
    await destroyClient();
    killOrphanedSessionBrowsers();
  };

  process.once('SIGINT', () => {
    shutdown('SIGINT')
      .catch((err) => console.error('whatsapp shutdown', err))
      .finally(() => process.exit(0));
  });

  process.once('SIGTERM', () => {
    shutdown('SIGTERM')
      .catch((err) => console.error('whatsapp shutdown', err))
      .finally(() => process.exit(0));
  });
}

function isBrowserAlreadyRunningError(err) {
  const message = String(err?.message || err || '');
  return message.includes('browser is already running');
}

function scheduleReconnect(reason) {
  clearReconnectTimer();
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      const config = await readWhatsAppConfig();
      if (!config.enabled) return;
      if (
        clientState === 'ready' ||
        clientState === 'qr' ||
        clientState === 'authenticated' ||
        clientState === 'initializing' ||
        initPromise
      ) {
        return;
      }
      console.log('[whatsapp] reconnecting…', reason || '');
      await startWhatsAppClient();
    } catch (err) {
      console.error('whatsapp reconnect', err);
      scheduleReconnect('retry');
    }
  }, RECONNECT_DELAY_MS);
}

function normalizePhoneForWhatsApp(contactNumber) {
  const digits = String(contactNumber ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('94') && digits.length >= 11) return digits;
  if (digits.startsWith('0') && digits.length >= 9) return `94${digits.slice(1)}`;
  if (digits.length === 9) return `94${digits}`;
  return digits;
}

function getWhatsAppStatus() {
  const activeConnection = clientState === 'ready' ? connectionInfo : null;
  return {
    state: clientState,
    connected: clientState === 'ready',
    qrDataUrl: clientState === 'qr' ? lastQrDataUrl : null,
    connection: activeConnection,
    lastConnection: activeConnection || lastKnownConnection,
  };
}

function attachClientEvents(waClient) {
  waClient.on('qr', async (qr) => {
    if (clientState === 'ready') return;
    clientState = 'qr';
    markStateEntered('qr');
    try {
      lastQrDataUrl = await qrcode.toDataURL(qr);
    } catch (err) {
      console.error('whatsapp qr encode', err);
      lastQrDataUrl = null;
    }
  });

  waClient.on('authenticated', () => {
    // whatsapp-web.js may emit authenticated multiple times; never downgrade from ready.
    if (clientState === 'ready') return;
    const firstAuth = clientState !== 'authenticated';
    clientState = 'authenticated';
    markStateEntered('authenticated');
    lastQrDataUrl = null;
    if (firstAuth) {
      console.log('[whatsapp] authenticated — waiting for ready…');
    }
  });

  waClient.on('loading_screen', (percent, message) => {
    if (clientState === 'ready') return;
    console.log(`[whatsapp] loading ${percent}%`, message || '');
  });

  waClient.on('ready', async () => {
    if (clientState === 'ready') return;
    clientState = 'ready';
    markStateEntered('ready');
    lastQrDataUrl = null;
    clearReconnectTimer();
    connectionInfo = readClientConnectionInfo(waClient);
    if (connectionInfo) {
      await persistConnectionInfo(connectionInfo);
    }
    console.log('[whatsapp] client ready', connectionInfo?.phone || '');
  });

  waClient.on('auth_failure', (msg) => {
    clientState = 'auth_failure';
    markStateEntered('auth_failure');
    lastQrDataUrl = null;
    connectionInfo = null;
    console.error('[whatsapp] auth failure', msg);
    scheduleReconnect('auth_failure');
  });

  waClient.on('disconnected', async (reason) => {
    clientState = 'disconnected';
    markStateEntered('disconnected');
    lastQrDataUrl = null;
    connectionInfo = null;
    client = null;
    initPromise = null;
    console.warn('[whatsapp] disconnected', reason);
    try {
      await waClient.destroy();
    } catch (err) {
      console.error('whatsapp destroy on disconnect', err);
      killOrphanedSessionBrowsers();
    }
    scheduleReconnect(reason);
  });
}

async function destroyClient() {
  clearReconnectTimer();
  clearStuckWatchdog();
  const waClient = client;
  client = null;
  initPromise = null;
  clientState = 'idle';
  lastQrDataUrl = null;
  connectionInfo = null;
  if (!waClient) return;
  try {
    await waClient.destroy();
  } catch (err) {
    console.error('whatsapp destroy', err);
    killOrphanedSessionBrowsers();
  }
}

async function startWhatsAppClient() {
  const config = await readWhatsAppConfig();
  if (!config.enabled) {
    await destroyClient();
    return null;
  }

  if (client && (clientState === 'ready' || clientState === 'qr')) {
    return client;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (client) {
      try {
        await client.destroy();
      } catch (err) {
        console.error('whatsapp destroy before restart', err);
        killOrphanedSessionBrowsers();
      }
    }
    client = null;
    clientState = 'initializing';
    markStateEntered('initializing');
    lastQrDataUrl = null;
    connectionInfo = null;
    await prepareSessionForLaunch();

    const waClient = new Client(buildWhatsAppClientOptions());

    attachClientEvents(waClient);
    client = waClient;

    try {
      await waClient.initialize();
    } catch (err) {
      console.error('whatsapp initialize', err);
      try {
        await waClient.destroy();
      } catch (destroyErr) {
        console.error('whatsapp destroy after init failure', destroyErr);
      }
      if (isBrowserAlreadyRunningError(err)) {
        await prepareSessionForLaunch();
      }
      clientState = 'disconnected';
      client = null;
      initPromise = null;
      scheduleReconnect('initialize_failed');
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

async function reconnectWhatsAppClient() {
  const config = await readWhatsAppConfig();
  if (!config.enabled) {
    return { ok: false, error: 'WhatsApp notifications are disabled' };
  }
  await destroyClient();
  startWhatsAppClient().catch((err) => console.error('whatsapp manual reconnect', err));
  return { ok: true, status: getWhatsAppStatus() };
}

async function waitForClientReady(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (clientState === 'ready') return true;
    if (clientState === 'qr' || clientState === 'auth_failure' || clientState === 'disconnected') {
      return false;
    }
    await sleep(500);
  }
  return clientState === 'ready';
}

async function bootstrapWhatsAppOnStartup() {
  registerShutdownHandlers();
  await loadLastKnownConnection();
  const config = await readWhatsAppConfig();
  if (!config.enabled) {
    console.log('[whatsapp] notifications disabled — skipping startup restore');
    return;
  }
  console.log('[whatsapp] restoring connection on startup…');
  await prepareSessionForLaunch();
  startWhatsAppClient().catch((err) => {
    console.error('[whatsapp] startup restore failed', err);
  });
}

async function sendCustomerWhatsApp({ type, customer, record, remainingAmount, referenceId }) {
  const phone = normalizePhoneForWhatsApp(customer?.contactNumber);
  if (!phone) return null;

  const config = await readWhatsAppConfig();
  if (!config.enabled) return null;

  const notificationSettings = await readNotificationSettings();
  if (!isNotificationTypeEnabled(notificationSettings, type)) return null;

  const hideFinancialDetails = Boolean(notificationSettings.hideFinancialDetails);

  const refId =
    referenceId ||
    (record && typeof record === 'object' && record.payment?.id && record.cheque?.id
      ? `${record.payment.id}::${record.cheque.id}`
      : record?.id);

  let built;
  const [company, bagProducts] = await Promise.all([readCompanyData(), getBagProducts()]);
  switch (type) {
    case 'bill':
      built = buildBillWhatsApp({
        customer,
        bill: record,
        remainingAmount,
        company,
        hideFinancialDetails,
        products: bagProducts,
      });
      break;
    case 'payment':
      built = buildPaymentWhatsApp({ customer, payment: record, remainingAmount, company });
      break;
    case 'promotion':
      built = buildPromotionWhatsApp({ customer, promotion: record, company });
      break;
    case 'unload':
      built = buildUnloadWhatsApp({ customer, unload: record, company, products: bagProducts });
      break;
    case 'cheque_return': {
      const payload = record && typeof record === 'object' ? record : {};
      built = buildChequeReturnWhatsApp({
        customer,
        payment: payload.payment,
        cheque: payload.cheque,
        remainingAmount,
        company,
      });
      break;
    }
    case 'overdue_balance': {
      const payload = record && typeof record === 'object' ? record : {};
      built = buildOverdueBalanceWhatsApp({
        customer,
        overdueBills: payload.overdueBills,
        pendingBills: payload.pendingBills,
        totalOverdueAmount: payload.totalOverdueAmount,
        totalPendingAmount: payload.totalPendingAmount,
        shareMode: payload.shareMode,
        company,
      });
      break;
    }
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
        referenceId: refId,
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
      referenceId: refId,
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
      referenceId: refId,
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

function notifyUnloadWhatsApp(customer, unload) {
  return sendCustomerWhatsApp({ type: 'unload', customer, record: unload });
}

function notifyChequeReturnWhatsApp(customer, payload) {
  const payment = payload?.payment;
  const cheque = payload?.cheque;
  const referenceId = payment?.id && cheque?.id ? `${payment.id}::${cheque.id}` : payment?.id;
  return sendCustomerWhatsApp({
    type: 'cheque_return',
    customer,
    record: payload,
    remainingAmount: payload?.remainingAmount,
    referenceId,
  });
}

function notifyOverdueBalanceWhatsApp(customer, payload, referenceId) {
  return sendCustomerWhatsApp({
    type: 'overdue_balance',
    customer,
    record: payload,
    referenceId,
  });
}

module.exports = {
  getWhatsAppStatus,
  startWhatsAppClient,
  applyWhatsAppConfigChange,
  reconnectWhatsAppClient,
  bootstrapWhatsAppOnStartup,
  destroyClient,
  notifyBillWhatsApp,
  notifyPaymentWhatsApp,
  notifyPromotionWhatsApp,
  notifyUnloadWhatsApp,
  notifyChequeReturnWhatsApp,
  notifyOverdueBalanceWhatsApp,
  sendCustomerWhatsApp,
  normalizePhoneForWhatsApp,
};
