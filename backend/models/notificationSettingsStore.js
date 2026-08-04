const fs = require('fs').promises;
const path = require('path');

const NOTIFICATION_SETTINGS_FILE = path.join(__dirname, '..', 'data', 'notificationSettings.json');

const OVERDUE_BALANCE_SHARE_MODES = ['overdue_only', 'pending_only', 'both'];

/** Default: all customer notification types enabled; share financial details. */
const DEFAULT_NOTIFICATION_SETTINGS = {
  notifyBill: true,
  notifyPayment: true,
  notifyPromotion: true,
  notifyUnload: true,
  notifyChequeReturn: true,
  hideFinancialDetails: false,
  notifyOverdueBalance: false,
  overdueBalanceShareMode: 'both',
  overdueReminderWeekday: 1,
  overdueReminderTime: '09:00',
};

const TYPE_TO_SETTING_KEY = {
  bill: 'notifyBill',
  payment: 'notifyPayment',
  promotion: 'notifyPromotion',
  unload: 'notifyUnload',
  cheque_return: 'notifyChequeReturn',
  overdue_balance: 'notifyOverdueBalance',
};

function normalizeTimeHHMM(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizeWeekday(raw, fallback = 1) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0 || n > 6) return fallback;
  return n;
}

function normalizeShareMode(raw) {
  const mode = String(raw ?? '').trim();
  return OVERDUE_BALANCE_SHARE_MODES.includes(mode) ? mode : 'both';
}

function normalizeNotificationSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const time = normalizeTimeHHMM(src.overdueReminderTime) || DEFAULT_NOTIFICATION_SETTINGS.overdueReminderTime;
  return {
    notifyBill: src.notifyBill !== false,
    notifyPayment: src.notifyPayment !== false,
    notifyPromotion: src.notifyPromotion !== false,
    notifyUnload: src.notifyUnload !== false,
    notifyChequeReturn: src.notifyChequeReturn !== false,
    hideFinancialDetails: Boolean(src.hideFinancialDetails),
    notifyOverdueBalance: Boolean(src.notifyOverdueBalance),
    overdueBalanceShareMode: normalizeShareMode(src.overdueBalanceShareMode),
    overdueReminderWeekday: normalizeWeekday(src.overdueReminderWeekday, 1),
    overdueReminderTime: time,
  };
}

async function readNotificationSettings() {
  try {
    const raw = await fs.readFile(NOTIFICATION_SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return normalizeNotificationSettings(data);
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_NOTIFICATION_SETTINGS };
    throw e;
  }
}

async function writeNotificationSettings(settings) {
  const next = normalizeNotificationSettings(settings);
  await fs.mkdir(path.dirname(NOTIFICATION_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(NOTIFICATION_SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function isNotificationTypeEnabled(settings, type) {
  const key = TYPE_TO_SETTING_KEY[String(type ?? '').trim()];
  if (!key) return false;
  return settings?.[key] !== false;
}

module.exports = {
  NOTIFICATION_SETTINGS_FILE,
  DEFAULT_NOTIFICATION_SETTINGS,
  OVERDUE_BALANCE_SHARE_MODES,
  TYPE_TO_SETTING_KEY,
  normalizeTimeHHMM,
  normalizeWeekday,
  normalizeShareMode,
  normalizeNotificationSettings,
  readNotificationSettings,
  writeNotificationSettings,
  isNotificationTypeEnabled,
};
