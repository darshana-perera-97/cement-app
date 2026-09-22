const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const {
  readStocks,
  writeStocks,
  toNonNegNumber,
  sumLoadBagsByBrand,
  lastCutOffPricesByBrand,
  normalizePurchaseOrderIds,
} = require('./models/stocksStore');
const {
  refreshLiveStockFromSources,
  getLiveStockSummary,
  getLiveDailyLedgerPayload,
} = require('./models/liveStockStore');
const {
  readCustomers,
  writeCustomers,
  toNonNegMoney,
  defaultDueDateYmd,
  normalizeCustomerRecordId,
  customerRecordIdKey,
} = require('./models/customersStore');
const {
  normalizeCustomerName,
  computeCustomerBalance,
  computeRemainingAmount,
  paymentCreditToCustomer,
  paymentGrossCredit,
  computeBillPaymentAllocation,
  effectiveBillTotal,
  openingBalanceBillId,
  isOpeningBalanceBillId,
  openingBalanceBillDate,
  listPaymentAffectedInvoices,
  mapPaymentAffectedInvoices,
} = require('./models/customerBalance');
const {
  readOverdueDates,
  setCustomerOverdueDays,
  getOverdueDaysForCustomer,
  normalizeOverdueDays,
  DEFAULT_OVERDUE_DAYS,
} = require('./models/overdueDatesStore');
const { readEmailConfig, writeEmailConfig, maskEmailConfig } = require('./models/emailConfigsStore');
const { readWhatsAppConfig, writeWhatsAppConfig } = require('./models/whatsappConfigsStore');
const {
  readNotificationSettings,
  writeNotificationSettings,
  normalizeNotificationSettings,
  normalizeTimeHHMM,
} = require('./models/notificationSettingsStore');
const {
  readPrinterSettings,
  writePrinterSettings,
} = require('./models/printerSettingsStore');
const {
  readStockUpdateSettings,
  writeStockUpdateSettings,
  isStockUpdateEnabled,
} = require('./models/stockUpdateSettingsStore');
const {
  readCollectorUnloadPriceSettings,
  writeCollectorUnloadPriceSettings,
  isCollectorUnloadPriceEnabled,
} = require('./models/collectorUnloadPriceSettingsStore');
const {
  readStockItemUnloadPriceSettings,
  writeStockItemUnloadPriceSettings,
  isStockItemUnloadPriceEnabled,
} = require('./models/stockItemUnloadPriceSettingsStore');
const {
  isSmtpConfigured,
  sendDataBackupEmail,
  startBackupScheduler,
  readBackupHistory,
  latestBackupHistory,
} = require('./models/backupService');
const {
  parseEmailList,
  publicBackupSettings,
  readBackupSettings,
  writeBackupSettings,
} = require('./models/backupSettingsStore');
const { startOverdueReminderScheduler } = require('./models/overdueReminderService');
const { readCompanyData, writeCompanyData } = require('./models/companyDataStore');
const { readShopData, writeShopData, normalizeShopData, addBankAccount, updateBankAccount, deleteBankAccount, addProduct, updateProduct, deleteProduct, updateDoorStockTransportSettings } = require('./models/shopDataStore');
const {
  readDistributors,
  writeDistributors,
  normalizeProducts,
  normalizeLocations,
  withNormalizedLists,
} = require('./models/distributorsStore');
const {
  readLorries,
  writeLorries,
  normalizeNumber: normalizeLorryNumber,
  normalizeLorry,
  findDuplicate: findDuplicateLorry,
} = require('./models/lorriesStore');
const { readMapShops, writeMapShops, normalizeMapShop, coordKey } = require('./models/mapShopsStore');
const {
  MAX_UPDATE_DISTANCE_M,
  distanceMeters,
  readShopStocks,
  writeShopStocks,
  findShopStock,
  findLastUnloadRecord,
  toNonNegInt,
} = require('./models/shopStockStore');
const { readSentEmails } = require('./models/sentEmailsStore');
const { readSentWhatsapp } = require('./models/sentWhatsappStore');
const { notifyBillEmail, notifyPaymentEmail, notifyPromotionEmail, notifyUnloadEmail } = require('./models/emailService');
const {
  getWhatsAppStatus,
  startWhatsAppClient,
  applyWhatsAppConfigChange,
  reconnectWhatsAppClient,
  resetWhatsAppSession,
  bootstrapWhatsAppOnStartup,
  notifyBillWhatsApp,
  notifyPaymentWhatsApp,
  notifyPromotionWhatsApp,
  notifyUnloadWhatsApp,
  notifyChequeReturnWhatsApp,
} = require('./models/whatsappService');

function enrichCustomerBalance(customer, bills, payments, overdueDates = {}, promotions = [], returnsRows = []) {
  const { amountToPay, overpaymentAmount } = computeCustomerBalance(
    customer,
    bills,
    payments,
    promotions,
    returnsRows,
  );
  return {
    ...customer,
    remainingAmount: amountToPay,
    overpaymentAmount,
    overdueDays: getOverdueDaysForCustomer(overdueDates, customer.id),
    ...monthlyTargetFieldsForCustomer(customer, bills),
  };
}

function collectorDisplayName(user) {
  if (!user) return '';
  return String(user.name || '').trim() || user.username || '';
}

function enrichCustomerWithCollector(customer, users) {
  const collectorUserId = String(customer.collectorUserId ?? '').trim();
  if (!collectorUserId) {
    return { ...customer, collectorName: '' };
  }
  const u = users.find((x) => x.id === collectorUserId);
  return { ...customer, collectorName: collectorDisplayName(u) };
}

async function listCollectorStaff() {
  const users = await readUsers();
  return users
    .filter((u) => String(u.role || '').trim() === 'Collector')
    .map((u) => ({
      id: u.id,
      name: collectorDisplayName(u),
      contact: u.contact || '',
      nic: u.nic || u.username || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Collectors, managers, and admins who can record customer payments. */
async function listCollectionStaff() {
  const users = await readUsers();
  const allowed = new Set(['Collector', 'Manager', 'Admin']);
  const rows = [];
  const seen = new Set();
  for (const u of users) {
    const role = String(u.role || '').trim();
    if (!allowed.has(role)) continue;
    const username = String(u.username || '').trim();
    if (!username) continue;
    const key = username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: u.id,
      name: collectorDisplayName(u),
      username,
      nic: String(u.nic || '').trim() || username,
      role,
    });
  }
  const envAdmin = String(process.env.ADMIN_USERNAME || '').trim();
  if (envAdmin && !seen.has(envAdmin.toLowerCase())) {
    rows.push({
      id: `env-admin:${envAdmin}`,
      name: 'Admin',
      username: envAdmin,
      nic: envAdmin,
      role: 'Admin',
    });
  }
  const rank = (role) => {
    if (role === 'Admin') return 0;
    if (role === 'Collector') return 1;
    if (role === 'Manager') return 2;
    return 3;
  };
  rows.sort((a, b) => {
    const byRole = rank(a.role) - rank(b.role);
    if (byRole !== 0) return byRole;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return rows;
}

async function validateCollectorUserId(collectorUserId) {
  const id = String(collectorUserId ?? '').trim();
  if (!id) return { ok: true, collectorUserId: '' };
  const users = await readUsers();
  const u = users.find((x) => x.id === id);
  if (!u || String(u.role || '').trim() !== 'Collector') {
    return { ok: false, error: 'Select a valid collector from the list' };
  }
  return { ok: true, collectorUserId: id };
}
const { readBills, writeBills, lineTotal, sumAllBillBagsByBrand } = require('./models/billsStore');
const {
  readReturns,
  writeReturns,
  RETURN_KINDS,
  PRICE_DIRECTIONS,
  SETTLEMENTS,
  returnKind,
  returnAmount,
  priceDirection,
  settlementOf,
  sumReturnedBagsForBill,
  suggestNextReturnInvoiceNumber,
  suggestNextDamageInvoiceNumber,
  invoiceNumberTaken,
} = require('./models/returnsStore');
const {
  getPaymentCheques,
  sumChequeAmounts,
  parseChequesFromBody,
  buildChequesForStorage,
  buildChequesForUpdate,
  applyLegacyChequeFields,
  chequeDepositQueueItem,
  bankAccountSnapshot,
  markChequeDepositedOnPayment,
  markChequeReturnedOnPayment,
} = require('./models/paymentCheques');
const {
  parseOtherPaymentMethodsFromBody,
  resolveOtherMethodBankAccounts,
  resolveApprovalBankAccounts,
  attachOtherPaymentMethodsToRow,
  attachApprovalMetaToRow,
  cdmPortion,
  onlineTransferPortion,
  getPaymentCdmDeposits,
  getPaymentOnlineTransfers,
  isPaymentApprovalPending,
  isPaymentCreditActive,
} = require('./models/paymentOtherMethods');
const {
  readPayments,
  writePayments,
  todayYmdLocal: paymentDateDefaultYmd,
  normalizePaymentBillNumber,
  isPaymentBillNumberTaken,
  allocatePaymentReceiptNumber,
} = require('./models/paymentsStore');
const {
  normalizeYmd: normalizeCollectionCloseYmd,
  getCollectionDayClose,
  isCollectionClosedForCollector,
  closeCollectionDay,
} = require('./models/collectionDayCloseStore');
const { inferStockIdForBillBags } = require('./models/billStockId');
const {
  normalizeMonthlyTargetBags,
  monthlyTargetFieldsForCustomer,
} = require('./models/customerMonthlyTarget');
const { signToken, requireAdmin, getAuthFromRequest } = require('./models/authToken');
const { getEffectiveManagerAccess } = require('./models/managerAccess');
const { getEffectiveCollectorAccess } = require('./models/collectorAccess');
const {
  readUsers,
  verifyStoredUser,
  findUserByUsername,
  createUser,
  updateUser,
  deleteUserById,
  toPublicUser,
} = require('./models/usersStore');

async function resolveStaffUser(auth) {
  if (!auth || auth.role === 'admin') return null;
  return findUserByUsername(auth.username);
}

function isCollectorStaff(user) {
  return Boolean(user && String(user.role || '').trim() === 'Collector');
}

function isDriverStaff(user) {
  return Boolean(user && String(user.role || '').trim() === 'Driver');
}

function staffMustUseTodayRecordDate(user) {
  return isCollectorStaff(user) || isDriverStaff(user);
}

/** Collectors/drivers may only create records dated today; admin/manager may pick any date. */
async function resolveRecordDate(req, requestedDate, { required = false } = {}) {
  const auth = getAuthFromRequest(req);
  const staffUser = await resolveStaffUser(auth);
  if (staffMustUseTodayRecordDate(staffUser)) {
    return { date: paymentDateDefaultYmd() };
  }
  let date = String(requestedDate ?? '').trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    if (required) return { error: 'date must be YYYY-MM-DD' };
    date = paymentDateDefaultYmd();
  }
  return { date };
}

async function collectorAssignedCustomerNames(collectorUserId) {
  const customers = await readCustomers();
  const names = new Set();
  const id = String(collectorUserId ?? '').trim();
  if (!id) return names;
  for (const c of customers) {
    if (String(c.collectorUserId ?? '').trim() === id) {
      const nk = normalizeCustomerName(c.name);
      if (nk) names.add(nk);
    }
  }
  return names;
}

async function filterRowsForCollector(rows, auth, nameFromRow) {
  const user = await resolveStaffUser(auth);
  if (!isCollectorStaff(user)) return rows;
  const names = await collectorAssignedCustomerNames(user.id);
  return rows.filter((row) => names.has(normalizeCustomerName(nameFromRow(row))));
}

function customerAssignedToCollector(customer, collectorUserId) {
  return String(customer.collectorUserId ?? '').trim() === String(collectorUserId ?? '').trim();
}

async function collectorCannotAddPaymentError(req, date) {
  const auth = getAuthFromRequest(req);
  const staffUser = await resolveStaffUser(auth);
  if (!isCollectorStaff(staffUser)) return null;
  if (!(await isCollectionClosedForCollector(staffUser.id, date))) return null;
  return 'Collection for this day is over. You cannot add more payments.';
}

const {
  readPromotions,
  writePromotions,
  sumAllPromotionBagsByBrand,
  PROMOTION_TYPES,
  promotionType,
  isFreeBagPromotion,
  promotionCreditAmount,
  computeInvoiceDiscountAmount,
} = require('./models/promotionsStore');
const {
  readPromotionRules,
  writePromotionRules,
  buildPromotionRuleRow,
  computeBillRuleCashback,
} = require('./models/promotionRulesStore');
const { readUnloads, writeUnloads, sumPendingUnloadBagsByBrand, normalizeStatus } = require('./models/unloadsStore');
const {
  getBagProducts,
  getBagProductKeys,
  parseLoadBrandFields,
  loadTotalCost,
  validateLoadBrandRefs,
  sumBagFields,
  brandLabelsMap,
  bagsField,
  formatProductLabel,
  activeBagProductsOnRecord,
} = require('./models/bagProducts');
const {
  readPurchaseOrders,
  writePurchaseOrders,
  lineTotal: poLineTotal,
  nextSuggestedPoNumber,
  parseCheques: parsePoCheques,
  validatePoCheques,
  findLastUnitPrice,
  lastPricesByProduct,
  cancelIssuedCheque,
  cancelPurchaseOrder,
  isPoCashPayment,
} = require('./models/purchaseOrdersStore');
const { computeBankAccountBalances } = require('./models/bankAccountBalance');
const {
  readCashBookEntries,
  writeCashBookEntries,
  normalizeEntry,
  validateCreateBody,
  markCompanyChequeDeposited,
  CATEGORIES: CASH_BOOK_CATEGORIES,
} = require('./models/cashBookStore');
const {
  readBankGuarantees,
  writeBankGuarantees,
  normalizeEntry: normalizeBankGuarantee,
  validateCreateBody: validateBankGuaranteeCreateBody,
} = require('./models/bankGuaranteesStore');

const app = express();
const PORT = Number(process.env.PORT) || 1249;
const SHOP_NAME = String(process.env.SHOP_NAME || 'CS Store').trim() || 'CS Store';

function resolveCorsOrigin() {
  const raw = String(process.env.CORS_ORIGIN ?? '').trim();
  if (!raw || raw === 'true' || raw === '*') return true;
  if (raw === 'false') return false;
  return raw;
}

app.use(cors({ origin: resolveCorsOrigin() }));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'bluetooth=(self)');
  next();
});
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'backend' });
});

/** Public app config (shop branding). No auth — used on login and chrome. */
app.get('/api/config', async (req, res) => {
  try {
    const shopData = await readShopData();
    const shopName = String(shopData.shopName || '').trim() || SHOP_NAME;
    const stockUpdate = await readStockUpdateSettings();
    const collectorUnloadPrice = await readCollectorUnloadPriceSettings();
    const stockItemUnloadPrice = await readStockItemUnloadPriceSettings();
    res.json({
      shopName,
      stockUpdateEnabled: Boolean(stockUpdate.enabled),
      collectorUnloadPriceEnabled: Boolean(collectorUnloadPrice.enabled),
      stockItemUnloadPriceEnabled: Boolean(stockItemUnloadPrice.enabled),
    });
  } catch (e) {
    console.error(e);
    res.json({
      shopName: SHOP_NAME,
      stockUpdateEnabled: false,
      collectorUnloadPriceEnabled: false,
      stockItemUnloadPriceEnabled: false,
    });
  }
});

app.get('/api/shop', async (req, res) => {
  try {
    const data = await readShopData();
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load shop details' });
  }
});

app.put('/api/shop', async (req, res) => {
  try {
    const body = req.body || {};
    const current = await readShopData();
    const next = await writeShopData({
      shopName: body.shopName,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2,
      contactNumber: body.contactNumber,
      email: body.email,
      ownerName: body.ownerName,
      registrationNo: body.registrationNo,
      dealerCode: body.dealerCode,
      dealerTagline: body.dealerTagline,
      deliveryNote: body.deliveryNote,
      supplierTin: body.supplierTin != null ? body.supplierTin : current.supplierTin,
      collectorSeparateBillSettlement:
        body.collectorSeparateBillSettlement != null
          ? Boolean(body.collectorSeparateBillSettlement)
          : current.collectorSeparateBillSettlement,
      collectorCommissionRates:
        body.collectorCommissionRates != null
          ? normalizeShopData({ collectorCommissionRates: body.collectorCommissionRates })
              .collectorCommissionRates
          : current.collectorCommissionRates,
      bankAccounts: current.bankAccounts,
      products: current.products,
      doorStockTransportSettings: current.doorStockTransportSettings,
    });
    res.json(next);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save shop details' });
  }
});

app.put('/api/shop/door-stock-transport-settings', async (req, res) => {
  try {
    const settings = await updateDoorStockTransportSettings(req.body || {});
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save door step transport settings' });
  }
});

app.get('/api/printer-settings', async (req, res) => {
  try {
    const settings = await readPrinterSettings();
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load printer settings' });
  }
});

app.put('/api/printer-settings', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again as admin to change printer settings' });
  }
  if (auth.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can change printer settings' });
  }
  try {
    const settings = await writePrinterSettings(req.body || {});
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save printer settings' });
  }
});

app.get('/api/stock-update-settings', async (req, res) => {
  try {
    const settings = await readStockUpdateSettings();
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load stock update settings' });
  }
});

app.put('/api/stock-update-settings', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again as admin to change stock update settings' });
  }
  if (auth.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can change stock update settings' });
  }
  try {
    const settings = await writeStockUpdateSettings(req.body || {});
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save stock update settings' });
  }
});

app.get('/api/collector-unload-price-settings', async (req, res) => {
  try {
    const settings = await readCollectorUnloadPriceSettings();
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load collector unload price settings' });
  }
});

app.put('/api/collector-unload-price-settings', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again as admin to change collector unload price settings' });
  }
  if (auth.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can change collector unload price settings' });
  }
  try {
    const settings = await writeCollectorUnloadPriceSettings(req.body || {});
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save collector unload price settings' });
  }
});

app.get('/api/stock-item-unload-price-settings', async (req, res) => {
  try {
    const settings = await readStockItemUnloadPriceSettings();
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load stock item unload price settings' });
  }
});

app.put('/api/stock-item-unload-price-settings', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again as admin to change stock item unload price settings' });
  }
  if (auth.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can change stock item unload price settings' });
  }
  try {
    const settings = await writeStockItemUnloadPriceSettings(req.body || {});
    res.json(settings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save stock item unload price settings' });
  }
});

app.get('/api/backup/status', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again as admin to send a backup' });
  }
  if (auth.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can send a backup' });
  }
  try {
    const [shopData, settings, history] = await Promise.all([
      readShopData(),
      readBackupSettings(),
      readBackupHistory(),
    ]);
    const shopName = String(shopData.shopName || '').trim() || SHOP_NAME;
    res.json({
      smtpConfigured: isSmtpConfigured(),
      shopName,
      defaultEmail: String(shopData.email || '').trim(),
      settings: publicBackupSettings(settings),
      history: latestBackupHistory(history, 10),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load backup status' });
  }
});

app.put('/api/backup/settings', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again as admin to save backup settings' });
  }
  if (auth.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can save backup settings' });
  }
  try {
    const body = req.body || {};
    const parsed = parseEmailList(body.emails ?? body.email);
    if (parsed.invalid.length > 0) {
      return res.status(400).json({
        error: `Invalid email address${parsed.invalid.length === 1 ? '' : 'es'}: ${parsed.invalid.join(', ')}`,
      });
    }
    const scheduleEnabled = Boolean(body.scheduleEnabled);
    if (scheduleEnabled && parsed.emails.length === 0) {
      return res.status(400).json({ error: 'Add at least one email before enabling the daily schedule' });
    }
    const next = await writeBackupSettings({
      emails: parsed.emails,
      scheduleEnabled,
      scheduleTime: body.scheduleTime,
    });
    res.json({ settings: publicBackupSettings(next) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save backup settings' });
  }
});

app.post('/api/backup/email', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again as admin to send a backup' });
  }
  if (auth.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can send a backup' });
  }
  try {
    const shopData = await readShopData();
    const shopName = String(shopData.shopName || '').trim() || SHOP_NAME;
    const parsed = parseEmailList(req.body?.emails ?? req.body?.email);
    if (parsed.invalid.length > 0) {
      return res.status(400).json({
        error: `Invalid email address${parsed.invalid.length === 1 ? '' : 'es'}: ${parsed.invalid.join(', ')}`,
      });
    }
    let emails = parsed.emails;
    if (emails.length === 0) {
      const saved = await readBackupSettings();
      emails = saved.emails;
    }
    if (emails.length > 0) {
      await writeBackupSettings({ emails });
    }
    const result = await sendDataBackupEmail({
      to: emails,
      shopName,
      trigger: 'manual',
    });
    const history = latestBackupHistory(await readBackupHistory(), 10);
    if (!result.ok) {
      return res.status(400).json({ error: result.error, history });
    }
    res.json({ ...result, history });
  } catch (e) {
    console.error('backup email', e);
    res.status(500).json({ error: e.message || 'Failed to send backup email' });
  }
});

app.post('/api/shop/bank-accounts', async (req, res) => {
  try {
    const result = await addBankAccount(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result.account);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add bank account' });
  }
});

app.patch('/api/shop/bank-accounts/:id', async (req, res) => {
  try {
    const result = await updateBankAccount(req.params.id, req.body || {});
    if (result.error) {
      const status = result.error === 'Bank account not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    res.json(result.account);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update bank account' });
  }
});

app.delete('/api/shop/bank-accounts/:id', async (req, res) => {
  try {
    const result = await deleteBankAccount(req.params.id);
    if (result.error) {
      const status = result.error === 'Bank account not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete bank account' });
  }
});

app.post('/api/shop/products', async (req, res) => {
  try {
    const result = await addProduct(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result.product);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add product' });
  }
});

app.patch('/api/shop/products/:id', async (req, res) => {
  try {
    const result = await updateProduct(req.params.id, req.body || {});
    if (result.error) {
      const status = result.error === 'Product not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    res.json(result.product);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/shop/products/:id', async (req, res) => {
  try {
    const result = await deleteProduct(req.params.id);
    if (result.error) {
      const status = result.error === 'Product not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

app.get('/api/lorries', async (req, res) => {
  try {
    const rows = await readLorries();
    const sorted = [...rows].sort((a, b) =>
      String(a.number || '').localeCompare(String(b.number || ''), undefined, {
        sensitivity: 'base',
      }),
    );
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read lorries' });
  }
});

app.post('/api/lorries', async (req, res) => {
  try {
    const body = req.body || {};
    const number = normalizeLorryNumber(body.number ?? body.vehicleNumber ?? body.name);
    const note = String(body.note ?? '').trim();
    if (!number) {
      return res.status(400).json({ error: 'lorry number is required' });
    }

    const lorries = await readLorries();
    if (findDuplicateLorry(lorries, number)) {
      return res.status(400).json({ error: 'A lorry with this number already exists' });
    }

    const row = normalizeLorry({
      id: `lorry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      number,
      note,
      createdAt: new Date().toISOString(),
    });

    lorries.push(row);
    await writeLorries(lorries);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save lorry' });
  }
});

app.patch('/api/lorries/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const lorries = await readLorries();
    const idx = lorries.findIndex((l) => l.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Lorry not found' });
    }

    const current = lorries[idx];
    const hasNumber = body.number !== undefined || body.vehicleNumber !== undefined || body.name !== undefined;
    const hasNote = body.note !== undefined;
    if (!hasNumber && !hasNote) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const next = { ...current };
    if (hasNumber) {
      const number = normalizeLorryNumber(body.number ?? body.vehicleNumber ?? body.name);
      if (!number) return res.status(400).json({ error: 'lorry number cannot be empty' });
      if (findDuplicateLorry(lorries, number, id)) {
        return res.status(400).json({ error: 'A lorry with this number already exists' });
      }
      next.number = number;
    }
    if (hasNote) {
      next.note = String(body.note ?? '').trim();
    }
    next.updatedAt = new Date().toISOString();

    lorries[idx] = normalizeLorry(next);
    await writeLorries(lorries);
    res.json(lorries[idx]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update lorry' });
  }
});

app.get('/api/map-shops', async (req, res) => {
  try {
    const rows = await readMapShops();
    const sorted = [...rows].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      }),
    );
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read map shops' });
  }
});

app.put('/api/map-shops', async (req, res) => {
  try {
    const auth = await requireManagerOrAdmin(req, res);
    if (!auth) return;
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? auth.username ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }
    const raw = Array.isArray(body.shops) ? body.shops : [];
    const now = new Date().toISOString();
    const seenIds = new Set();
    const seenCustomers = new Set();
    const seenCoords = new Set();
    const shops = [];
    for (const row of raw) {
      const customerId = String(row?.customerId ?? '').trim();
      const normalized = normalizeMapShop({
        ...row,
        id: String(row?.id ?? '').trim() || customerId || `shop-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        customerId,
        updatedAt: now,
        createdAt: String(row?.createdAt ?? '').trim() || now,
      });
      if (!normalized) continue;
      if (seenIds.has(normalized.id)) {
        return res.status(400).json({ error: 'Duplicate shop on the map' });
      }
      if (normalized.customerId) {
        if (seenCustomers.has(normalized.customerId)) {
          return res.status(400).json({ error: 'This customer already has a map location' });
        }
        seenCustomers.add(normalized.customerId);
      }
      const key = coordKey(normalized.lat, normalized.lng);
      if (seenCoords.has(key)) {
        return res.status(400).json({ error: 'A shop is already pinned at this location' });
      }
      seenIds.add(normalized.id);
      seenCoords.add(key);
      shops.push(normalized);
    }
    shops.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
    );
    await writeMapShops(shops);
    res.json(shops);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save map shops' });
  }
});

app.get('/api/shop-stocks', async (req, res) => {
  const auth = await requireMapStockViewer(req, res);
  if (!auth) return;
  try {
    const [shops, stocks, unloads, bills, products, customers] = await Promise.all([
      readMapShops(),
      readShopStocks(),
      readUnloads(),
      readBills(),
      getBagProducts(),
      readCustomers(),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    let visibleShops = shops;
    if (auth.staffRole === 'Collector') {
      visibleShops = shops.filter((shop) => {
        const customer = customerById.get(String(shop.customerId || shop.id || '').trim());
        return customer && customerAssignedToCollector(customer, auth.staffUserId);
      });
    }
    const visibleIds = new Set(visibleShops.map((s) => s.id));
    const rows = [];
    for (const shop of visibleShops) {
      const customer =
        customerById.get(String(shop.customerId || shop.id || '').trim()) || {
          id: shop.customerId || shop.id,
          name: shop.name,
        };
      const last = findLastUnloadRecord(unloads, bills, customer);
      const items = last ? lastUnloadItems(last.row, products) : [];
      const saved = findShopStock(stocks, shop.id);
      rows.push({
        shopId: shop.id,
        customerId: shop.customerId || '',
        name: shop.name,
        items: shopStockPublicRow(saved, products, items).items,
        updatedAt: saved?.updatedAt || '',
      });
    }
    res.json({
      stocks: rows,
      allowedShopIds: auth.staffRole === 'Collector' ? [...visibleIds] : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load shop stocks' });
  }
});

app.get('/api/shop-stocks/:shopId', async (req, res) => {
  const auth = await requireMapStockViewer(req, res);
  if (!auth) return;
  try {
    const shopId = String(req.params.shopId ?? '').trim();
    const shops = await readMapShops();
    const shop = shops.find((s) => s.id === shopId);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found on the map' });
    }
    const customer = await resolveShopCustomer(shop);
    if (auth.staffRole === 'Collector') {
      if (!customer || !customerAssignedToCollector(customer, auth.staffUserId)) {
        return res.status(403).json({ error: 'This shop is not assigned to you' });
      }
    }
    const [unloads, bills, products, stocks] = await Promise.all([
      readUnloads(),
      readBills(),
      getBagProducts(),
      readShopStocks(),
    ]);
    const last = customer ? findLastUnloadRecord(unloads, bills, customer) : null;
    const items = last ? lastUnloadItems(last.row, products) : [];
    const saved = findShopStock(stocks, shop.id);
    const publicRow = shopStockPublicRow(saved, products, items);
    res.json({
      shopId: shop.id,
      customerId: shop.customerId || customer?.id || '',
      name: shop.name,
      location: shop.location || '',
      lat: shop.lat,
      lng: shop.lng,
      lastUnloadId: last?.row?.id || '',
      lastUnloadDate: last?.row?.date || '',
      lastUnloadKind: last?.kind || '',
      items: publicRow.items,
      updatedAt: publicRow.updatedAt,
      updatedBy: publicRow.updatedBy,
      maxDistanceM: MAX_UPDATE_DISTANCE_M,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load shop stock' });
  }
});

app.put('/api/shop-stocks/:shopId', async (req, res) => {
  const auth = await requireShopStockUpdater(req, res);
  if (!auth) return;
  try {
    const shopId = String(req.params.shopId ?? '').trim();
    const shops = await readMapShops();
    const shop = shops.find((s) => s.id === shopId);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found on the map' });
    }
    const customer = await resolveShopCustomer(shop);
    if (auth.staffRole === 'Collector') {
      if (!customer || !customerAssignedToCollector(customer, auth.staffUserId)) {
        return res.status(403).json({ error: 'This shop is not assigned to you' });
      }
    }
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Current location is required to update shop stock' });
    }
    const meters = distanceMeters(lat, lng, shop.lat, shop.lng);
    if (meters > MAX_UPDATE_DISTANCE_M) {
      return res.status(400).json({
        error: `You must be within ${MAX_UPDATE_DISTANCE_M} m of the shop to update stock.`,
        distanceM: Math.round(meters),
        maxDistanceM: MAX_UPDATE_DISTANCE_M,
      });
    }
    const [unloads, bills, products] = await Promise.all([
      readUnloads(),
      readBills(),
      getBagProducts(),
    ]);
    const last = customer ? findLastUnloadRecord(unloads, bills, customer) : null;
    const lastItems = last ? lastUnloadItems(last.row, products) : [];
    if (lastItems.length === 0) {
      return res.status(400).json({ error: 'This shop has no last unloaded items to update' });
    }
    const bodyStock = req.body?.stock && typeof req.body.stock === 'object' ? req.body.stock : {};
    const stock = {};
    for (const item of lastItems) {
      stock[item.key] = toNonNegInt(bodyStock[item.key]);
    }
    const records = await readShopStocks();
    const next = {
      shopId: shop.id,
      customerId: shop.customerId || customer?.id || '',
      stock,
      lastUnloadId: last?.row?.id || '',
      lastUnloadDate: last?.row?.date || '',
      updatedAt: new Date().toISOString(),
      updatedBy: auth.username,
      lat,
      lng,
    };
    const idx = records.findIndex((r) => String(r.shopId ?? r.id ?? '').trim() === shop.id);
    if (idx >= 0) records[idx] = next;
    else records.push(next);
    await writeShopStocks(records);
    res.json({
      shopId: shop.id,
      customerId: next.customerId,
      name: shop.name,
      items: shopStockPublicRow(next, products, lastItems).items,
      updatedAt: next.updatedAt,
      updatedBy: next.updatedBy,
      distanceM: Math.round(meters),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save shop stock' });
  }
});

app.get('/api/distributors', async (req, res) => {
  try {
    const rows = await readDistributors();
    const normalized = rows.map((d) => withNormalizedLists(d));
    const sorted = [...normalized].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      }),
    );
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read distributors' });
  }
});

app.post('/api/distributors', async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim();
    const contact = String(body.contact ?? '').trim();
    const locations = normalizeLocations(body.locations, body.location);
    const products = normalizeProducts(body.products);

    if (!name || !contact) {
      return res.status(400).json({ error: 'name and contact are required' });
    }
    if (locations.length === 0) {
      return res.status(400).json({ error: 'at least one location is required' });
    }

    const row = {
      id: `dist-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      name,
      locations,
      location: locations[0],
      contact,
      ...(email ? { email } : {}),
      products,
      createdAt: new Date().toISOString(),
    };

    const distributors = await readDistributors();
    distributors.push(row);
    await writeDistributors(distributors);
    res.status(201).json(withNormalizedLists(row));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save distributor' });
  }
});

app.patch('/api/distributors/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const distributors = await readDistributors();
    const idx = distributors.findIndex((d) => d.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Distributor not found' });
    }

    const current = distributors[idx];
    const hasName = body.name !== undefined;
    const hasLocation = body.location !== undefined;
    const hasLocations = body.locations !== undefined;
    const hasContact = body.contact !== undefined;
    const hasEmail = body.email !== undefined;
    const hasProducts = body.products !== undefined;
    if (!hasName && !hasLocation && !hasLocations && !hasContact && !hasEmail && !hasProducts) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const next = { ...current };

    if (hasName) {
      const name = String(body.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      next.name = name;
    }
    if (hasLocations || hasLocation) {
      const resolved = hasLocations
        ? normalizeLocations(body.locations, hasLocation ? body.location : undefined)
        : normalizeLocations(undefined, body.location);
      if (resolved.length === 0) {
        return res.status(400).json({ error: 'at least one location is required' });
      }
      next.locations = resolved;
      next.location = resolved[0];
    }
    if (hasContact) {
      const contact = String(body.contact ?? '').trim();
      if (!contact) return res.status(400).json({ error: 'contact cannot be empty' });
      next.contact = contact;
    }
    if (hasEmail) {
      const email = String(body.email ?? '').trim();
      if (email) next.email = email;
      else delete next.email;
    }
    if (hasProducts) {
      next.products = normalizeProducts(body.products);
    }

    next.updatedAt = new Date().toISOString();
    distributors[idx] = next;
    await writeDistributors(distributors);
    res.json(withNormalizedLists(next));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update distributor' });
  }
});

/** Bag products from Shop → Products catalog (falls back to supplier lists if empty). */
app.get('/api/bag-products', async (req, res) => {
  try {
    const products = await getBagProducts();
    res.json({ products });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load bag products' });
  }
});

/** Aggregates for dashboard "Your card": receivables, stock spend, payments in */
app.get('/api/cash-summary', async (req, res) => {
  try {
    const [customers, bills, payments, stocks, overdueDates, promotions, returnsRows] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
      readStocks(),
      readOverdueDates(),
      readPromotions(),
      readReturns(),
    ]);
    let pendingFromCustomers = 0;
    for (const c of customers) {
      pendingFromCustomers += computeRemainingAmount(c, bills, payments, promotions, returnsRows);
    }
    let cashToBuyStock = 0;
    for (const s of stocks) {
      cashToBuyStock += toNonNegMoney(s.totalAmount);
    }
    let cashReceivedFromCustomers = 0;
    for (const p of payments) {
      cashReceivedFromCustomers += paymentCreditToCustomer(p);
    }
    const round2 = (n) => Math.round(Number(n) * 100) / 100;
    const overdueRows = collectOverdueBillRows(customers, bills, payments, overdueDates, promotions, returnsRows);
    const maxDaysOverdue = overdueRows.length
      ? Math.max(...overdueRows.map((r) => r.daysOverdue))
      : 0;
    const overdueTotal = round2(
      overdueRows.reduce((s, r) => s + toNonNegMoney(r.outstandingAmount), 0),
    );
    const overduePriority = overduePriorityFromMaxDays(maxDaysOverdue);
    res.json({
      pendingFromCustomers: round2(pendingFromCustomers),
      cashToBuyStock: round2(cashToBuyStock),
      cashReceivedFromCustomers: round2(cashReceivedFromCustomers),
      overdue: {
        totalOutstanding: overdueTotal,
        billCount: overdueRows.length,
        maxDaysOverdue,
        priority: overduePriority,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load cash summary' });
  }
});

/** Last N calendar days (local server time): oldest first. Each key is YYYY-MM-DD. */
function lastNDaysYmdLocal(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/** Default credit bill settlement window when a customer has no override in overduedates.json. */
const BILL_SETTLEMENT_DAYS = DEFAULT_OVERDUE_DAYS;

function parseAppliedBillIdsFromBody(body) {
  const raw = body?.appliedBillIds;
  if (raw == null || raw === '') return { ids: [] };
  if (!Array.isArray(raw)) {
    return { error: 'appliedBillIds must be an array of bill ids' };
  }
  const ids = [...new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))];
  return { ids };
}

function validateAppliedBillIdsForCustomer(bills, cust, ids) {
  if (!ids.length) return null;
  const nk = normalizeCustomerName(cust.name);
  for (const id of ids) {
    if (isOpeningBalanceBillId(id, cust.id)) {
      if (toNonNegMoney(cust.pastBill) <= 0) {
        return 'This customer has no opening balance to select';
      }
      continue;
    }
    const bill = bills.find((b) => String(b.id ?? '').trim() === id);
    if (!bill) return 'One or more selected bills were not found';
    if (normalizeCustomerName(bill.customerName) !== nk) {
      return 'Each selected bill must belong to the payment customer';
    }
  }
  return null;
}

function appliedBillSnapshots(bills, ids, cust) {
  if (!ids.length) return [];
  return ids.map((id) => {
    if (cust && isOpeningBalanceBillId(id, cust.id)) {
      return {
        id: openingBalanceBillId(cust.id),
        date: openingBalanceBillDate(cust),
        totalAmount: toNonNegMoney(cust.pastBill),
        invoiceNumber: 'Opening',
        details: 'Opening balance',
      };
    }
    const bill = bills.find((b) => String(b.id ?? '').trim() === id);
    if (!bill) return null;
    return {
      id: bill.id,
      date: bill.date,
      totalAmount: toNonNegMoney(bill.totalAmount),
      invoiceNumber: String(bill.invoiceNumber ?? '').trim(),
      details: billDetailsLine(bill),
    };
  }).filter(Boolean);
}

function attachAppliedBillsToPaymentRow(row, bills, ids, cust) {
  if (!ids.length) {
    delete row.appliedBillIds;
    delete row.appliedBills;
    return;
  }
  row.appliedBillIds = ids;
  row.appliedBills = appliedBillSnapshots(bills, ids, cust);
}

function parseBillCashAllocationsFromBody(body) {
  const raw = body?.billCashAllocations;
  if (raw == null || raw === '') return { allocations: [] };
  if (!Array.isArray(raw)) {
    return { error: 'billCashAllocations must be an array' };
  }
  const byBillId = new Map();
  for (const item of raw) {
    const billId = String(item?.billId ?? item?.id ?? '').trim();
    const cashAmount = toNonNegMoney(item?.cashAmount ?? item?.amount ?? 0);
    if (!billId || cashAmount <= 0) continue;
    byBillId.set(billId, cashAmount);
  }
  const allocations = [...byBillId.entries()].map(([billId, cashAmount]) => ({ billId, cashAmount }));
  return { allocations };
}

function validateBillCashAllocationsForCustomer(bills, cust, allocations, payments = [], promotions = []) {
  if (!allocations.length) return null;
  const nk = normalizeCustomerName(cust.name);
  const { pastPaid } = computeBillPaymentAllocation(cust, bills, payments, promotions);
  for (const { billId, cashAmount } of allocations) {
    if (isOpeningBalanceBillId(billId, cust.id)) {
      const pastTotal = toNonNegMoney(cust.pastBill);
      if (pastTotal <= 0) return 'This customer has no opening balance to allocate';
      if (cashAmount <= 0) return 'Each bill allocation must have an amount greater than 0';
      const openingRemaining = Math.round((pastTotal - pastPaid) * 100) / 100;
      if (cashAmount > openingRemaining + 0.009) {
        return 'Amount for opening balance cannot exceed the remaining opening balance';
      }
      continue;
    }
    const bill = bills.find((b) => String(b.id ?? '').trim() === billId);
    if (!bill) return 'One or more bill allocations were not found';
    if (normalizeCustomerName(bill.customerName) !== nk) {
      return 'Each bill allocation must belong to the payment customer';
    }
    if (cashAmount <= 0) return 'Each bill allocation must have an amount greater than 0';
    const billTotal = toNonNegMoney(bill.totalAmount);
    if (billTotal > 0 && cashAmount > billTotal) {
      return `Amount for bill ${bill.date || billId} cannot exceed the bill total`;
    }
  }
  return null;
}

function attachBillCashAllocationsToPaymentRow(row, bills, allocations, cust) {
  if (!allocations.length) {
    delete row.billCashAllocations;
    return;
  }
  row.billCashAllocations = allocations.map(({ billId, cashAmount }) => {
    if (cust && isOpeningBalanceBillId(billId, cust.id)) {
      return {
        billId,
        cashAmount: toNonNegMoney(cashAmount),
        billDate: openingBalanceBillDate(cust),
        billTotal: toNonNegMoney(cust.pastBill),
        invoiceNumber: 'Opening',
        details: 'Opening balance',
      };
    }
    const bill = bills.find((b) => String(b.id ?? '').trim() === billId);
    return {
      billId,
      cashAmount: toNonNegMoney(cashAmount),
      billDate: bill?.date,
      billTotal: bill ? toNonNegMoney(bill.totalAmount) : undefined,
      invoiceNumber: String(bill?.invoiceNumber ?? '').trim(),
      details: bill ? billDetailsLine(bill) : undefined,
    };
  });
  const ids = allocations.map((a) => a.billId);
  attachAppliedBillsToPaymentRow(row, bills, ids, cust);
}

function attachAffectedInvoicesToPaymentRow(row, bills, cust, payments, promotions = []) {
  if (!row?.id || !cust) {
    if (row) delete row.affectedInvoices;
    return;
  }
  const items = listPaymentAffectedInvoices(cust, bills, payments, row.id, promotions);
  assignAffectedInvoices(row, bills, items);
}

function assignAffectedInvoices(row, bills, items) {
  if (!items || !items.length) {
    delete row.affectedInvoices;
    return;
  }
  row.affectedInvoices = items.map((item) => {
    if (item.invoiceNumber === 'Opening' || item.details) return item;
    const bill = bills.find((b) => String(b.id ?? '').trim() === item.billId);
    return {
      ...item,
      details: bill ? billDetailsLine(bill) : item.details,
    };
  });
}

function hydratePaymentReceiptInvoices(rows, allPayments, bills, customers, promotions = []) {
  const custById = new Map((customers || []).map((c) => [c.id, c]));
  const mapsByCustomer = new Map();
  for (const row of rows) {
    const cust = custById.get(row.customerId);
    if (!cust) continue;
    if (!mapsByCustomer.has(cust.id)) {
      mapsByCustomer.set(cust.id, mapPaymentAffectedInvoices(cust, bills, allPayments, promotions));
    }
    assignAffectedInvoices(row, bills, mapsByCustomer.get(cust.id).get(String(row.id ?? '').trim()) || []);
  }
}

/** How a payment settled the account (customer transaction list). */
function paymentSettlementSummary(p) {
  const credit = paymentCreditToCustomer(p);
  if (credit <= 0) return null;
  const cash = toNonNegMoney(p?.cashAmount);
  const cdm = cdmPortion(p);
  const onlineTransfer = onlineTransferPortion(p);
  const chequeLines = getPaymentCheques(p);
  const chq = sumChequeAmounts(chequeLines);
  if (cash <= 0 && chq <= 0 && cdm <= 0 && onlineTransfer <= 0) {
    return `Settled LKR ${credit}`;
  }
  const parts = [];
  if (cash > 0) parts.push(`cash LKR ${cash}`);
  for (const d of getPaymentCdmDeposits(p)) {
    let s = `CDM LKR ${d.amount}`;
    if (d.cdmNumber) s += ` #${d.cdmNumber}`;
    if (d.cdmDate) s += ` · ${d.cdmDate}`;
    parts.push(s);
  }
  for (const t of getPaymentOnlineTransfers(p)) {
    let s = `online transfer LKR ${t.amount}`;
    if (t.reference) s += ` ref ${t.reference}`;
    if (t.transferDate) s += ` · ${t.transferDate}`;
    parts.push(s);
  }
  for (const line of chequeLines) {
    let s = `cheque LKR ${line.amount}`;
    if (line.chequeNumber) s += ` #${line.chequeNumber}`;
    if (line.chequeDate) s += ` · ${line.chequeDate}`;
    parts.push(s);
  }
  return parts.length ? `Settled: ${parts.join(' · ')}` : `Settled LKR ${credit}`;
}

function ymdTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToYmd(ymd, days) {
  const parts = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;
  const d = new Date(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + (Number(days) || 0));
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

async function validateBillAgainstPooledStock(
  loads,
  existingBills,
  promotions,
  billBagFields,
  pendingUnloads = [],
  excludeRequestId = null,
  products = [],
  excludePromotionId = null,
  issueNoun = 'bill',
) {
  const keys = products.map((p) => p.key);
  const labels = brandLabelsMap(products);
  const loaded = sumLoadBagsByBrand(loads, keys);
  const soldSoFar = sumAllBillBagsByBrand(existingBills, keys);
  const promoRows = excludePromotionId
    ? promotions.filter((p) => p.id !== excludePromotionId)
    : promotions;
  const promoOut = sumAllPromotionBagsByBrand(promoRows, keys);
  const pendingRows = Array.isArray(pendingUnloads) ? pendingUnloads : [];
  const pending = sumPendingUnloadBagsByBrand(
    excludeRequestId ? pendingRows.filter((r) => r.id !== excludeRequestId) : pendingRows,
    keys,
  );
  for (const k of keys) {
    const available = Math.max(
      0,
      toNonNegNumber(loaded[k]) -
        toNonNegNumber(soldSoFar[k]) -
        toNonNegNumber(promoOut[k]) -
        toNonNegNumber(pending[k]),
    );
    const need = toNonNegNumber(billBagFields[bagsField(k)]);
    if (need > available) {
      return {
        ok: false,
        error: `Not enough ${labels[k] || k} bags in stock: ${available} available, this ${issueNoun} needs ${need}.`,
      };
    }
  }
  return { ok: true };
}

async function parseBillBagFields(body) {
  const products = await getBagProducts();
  const fields = {};
  let totalAmount = 0;
  for (const p of products) {
    const bags = toNonNegNumber(body[p.bagsField]);
    const unitPrice = toNonNegMoney(body[p.unitPriceField]);
    fields[p.bagsField] = bags;
    fields[p.unitPriceField] = unitPrice;
    const line = lineTotal(bags, unitPrice);
    fields[`${p.key}Line`] = line;
    totalAmount += line;
  }
  fields.totalAmount = Math.round(totalAmount * 100) / 100;
  return { fields, products };
}

async function parseProductBagFields(body) {
  const products = await getBagProducts();
  const fields = {};
  for (const p of products) {
    fields[p.bagsField] = toNonNegNumber(body[p.bagsField]);
  }
  return { fields, products };
}

async function buildLoadRowFromBody(body, meta = {}) {
  const products = await getBagProducts();
  const trimStr = (v) => String(v ?? '').trim();
  const cutOffNumberOrUndef = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return toNonNegNumber(n);
  };
  const brandFields = parseLoadBrandFields(body, products, { trimStr, cutOffNumberOrUndef });
  const row = {
    ...meta,
    ...brandFields,
    transportCostPerBag: toNonNegNumber(body.transportCostPerBag),
    doorStockTransportCostPerBag: toNonNegNumber(body.doorStockTransportCostPerBag),
    marginPerBag:
      body.marginPerBag === '' || body.marginPerBag == null ? 0 : toNonNegNumber(body.marginPerBag),
  };
  row.totalAmount = loadTotalCost(brandFields, products);
  const missingRefs = validateLoadBrandRefs(
    row,
    products,
    meta.date || String(body.date ?? '').trim(),
  );
  return { row, products, missingRefs };
}

function normalizeBillInvoiceNumber(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function incrementBillInvoiceNumber(last) {
  const s = String(last ?? '').trim();
  if (!s) return '001';
  const match = s.match(/^(.*?)(\d+)$/);
  if (!match) return `${s}1`;
  const prefix = match[1];
  const numStr = match[2];
  const next = String(parseInt(numStr, 10) + 1);
  return `${prefix}${next.padStart(numStr.length, '0')}`;
}

function latestBillInvoiceNumber(bills) {
  const list = Array.isArray(bills) ? bills : [];
  if (list.length === 0) return '';
  const sorted = [...list].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );
  for (const bill of sorted) {
    const n = normalizeBillInvoiceNumber(bill.invoiceNumber);
    if (n) return n;
  }
  return '';
}

function suggestNextBillInvoiceNumber(bills) {
  return incrementBillInvoiceNumber(latestBillInvoiceNumber(bills));
}

function parseBillInvoiceNumber(body) {
  const invoiceNumber = normalizeBillInvoiceNumber(body.invoiceNumber);
  if (!invoiceNumber) {
    return { error: 'invoiceNumber is required' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 \-._/]*$/.test(invoiceNumber)) {
    return { error: 'Invoice # can use letters, numbers, spaces, and . _ - /' };
  }
  return { invoiceNumber };
}

function billInvoiceNumberTaken(bills, invoiceNumber, excludeId = null) {
  const norm = normalizeBillInvoiceNumber(invoiceNumber).toLowerCase();
  if (!norm) return false;
  const exclude = String(excludeId ?? '').trim();
  for (const bill of bills) {
    if (exclude && bill.id === exclude) continue;
    if (normalizeBillInvoiceNumber(bill.invoiceNumber).toLowerCase() === norm) return true;
  }
  return false;
}

/** Assign unique invoice numbers to legacy bills that never had one saved. */
function ensureBillInvoiceNumbers(bills) {
  const list = Array.isArray(bills) ? bills : [];
  let changed = false;
  let last = latestBillInvoiceNumber(list);
  const missing = list
    .filter((bill) => !normalizeBillInvoiceNumber(bill.invoiceNumber))
    .sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
    );
  for (const bill of missing) {
    do {
      last = incrementBillInvoiceNumber(last);
    } while (billInvoiceNumberTaken(list, last));
    bill.invoiceNumber = last;
    changed = true;
  }
  return changed;
}

async function syncBillRuleCashback(bill, { enteredBy, products, promotions }) {
  const promoRows = Array.isArray(promotions) ? promotions : await readPromotions();
  const existingIdx = promoRows.findIndex(
    (p) =>
      promotionType(p) === PROMOTION_TYPES.RULE_CASHBACK &&
      String(p.billId ?? '').trim() === String(bill?.id ?? '').trim(),
  );

  const customers = await readCustomers();
  const cust = customers.find(
    (c) => normalizeCustomerName(c.name) === normalizeCustomerName(bill?.customerName),
  );
  const rules = await readPromotionRules();
  const computed = cust
    ? computeBillRuleCashback(bill, rules, cust.id, products)
    : { discountAmount: 0, lines: [], ruleIds: [] };

  if (computed.discountAmount <= 0) {
    if (existingIdx >= 0) {
      promoRows.splice(existingIdx, 1);
      await writePromotions(promoRows);
    }
    return promoRows;
  }

  if (!cust) return promoRows;

  const payload = {
    type: PROMOTION_TYPES.RULE_CASHBACK,
    date: bill.date,
    customerId: cust.id,
    customerName: cust.name,
    billId: bill.id,
    invoiceNumber: bill.invoiceNumber || '',
    discountAmount: computed.discountAmount,
    cashbackLines: computed.lines,
    ruleIds: computed.ruleIds,
    reason: 'Promotion rule cashback',
  };

  if (existingIdx >= 0) {
    promoRows[existingIdx] = {
      ...promoRows[existingIdx],
      ...payload,
      updatedBy: enteredBy,
      updatedAt: new Date().toISOString(),
    };
  } else {
    promoRows.push({
      id: `promo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...payload,
      enteredBy,
      createdAt: new Date().toISOString(),
    });
  }
  await writePromotions(promoRows);
  return promoRows;
}

async function refreshCustomerBalancesForBillNames(bills, paymentsList, ...nameKeys) {
  const keys = new Set(nameKeys.map((n) => normalizeCustomerName(n)).filter(Boolean));
  if (keys.size === 0) return;
  const [customers, promotions, returnsRows] = await Promise.all([
    readCustomers(),
    readPromotions(),
    readReturns(),
  ]);
  let dirty = false;
  for (const c of customers) {
    if (keys.has(normalizeCustomerName(c.name))) {
      c.remainingAmount = computeRemainingAmount(c, bills, paymentsList, promotions, returnsRows);
      dirty = true;
    }
  }
  if (dirty) await writeCustomers(customers);
}

async function refreshCustomerBalancesForCustomerIds(bills, paymentsList, ...customerIds) {
  const ids = new Set(customerIds.map((id) => String(id ?? '').trim()).filter(Boolean));
  if (ids.size === 0) return;
  const [customers, promotions, returnsRows] = await Promise.all([
    readCustomers(),
    readPromotions(),
    readReturns(),
  ]);
  let dirty = false;
  for (const c of customers) {
    if (ids.has(c.id)) {
      c.remainingAmount = computeRemainingAmount(c, bills, paymentsList, promotions, returnsRows);
      dirty = true;
    }
  }
  if (dirty) await writeCustomers(customers);
}

function daysFromDueToToday(dueYmd, todayYmd) {
  if (!dueYmd || !todayYmd || dueYmd.length < 10 || todayYmd.length < 10) return 0;
  const t0 = new Date(
    parseInt(dueYmd.slice(0, 4), 10),
    parseInt(dueYmd.slice(5, 7), 10) - 1,
    parseInt(dueYmd.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(todayYmd.slice(0, 4), 10),
    parseInt(todayYmd.slice(5, 7), 10) - 1,
    parseInt(todayYmd.slice(8, 10), 10),
  ).getTime();
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

function billDetailsLine(bill) {
  const parts = [];
  const invoiceNumber = String(bill.invoiceNumber ?? '').trim();
  if (invoiceNumber) parts.push(`Inv ${invoiceNumber}`);
  const stockId = String(bill.stockId ?? '').trim();
  if (stockId) parts.push(`Stock ${stockId}`);
  const bagParts = [];
  const labels = [
    ['tokyo', 'Tokyo'],
    ['samudra', 'Samudra'],
    ['atlas', 'Atlas'],
    ['nippon', 'Nippon'],
  ];
  for (const [key, label] of labels) {
    const n = toNonNegNumber(bill[`${key}Bags`]);
    if (n > 0) bagParts.push(`${label} ${n} bags`);
  }
  if (bagParts.length) parts.push(bagParts.join(', '));
  const line = parts.join(' · ');
  if (line) return line;
  const amt = toNonNegMoney(bill.totalAmount);
  return amt > 0 ? `Total LKR ${amt}` : 'Credit bill';
}

/**
 * Unpaid credit bills (remaining > 0 after payments). Payments apply to `pastBill` first,
 * then bills in chronological order (same idea as balances).
 * @param {{ overdueOnly?: boolean }} [options]
 */
function collectUnpaidBillRows(customers, bills, payments, overdueDates = {}, options = {}, promotions = []) {
  const { overdueOnly = false, returnsRows = [] } = options;
  const todayYmd = ymdTodayLocal();
  const rows = [];

  const pushIfMatch = (row) => {
    const isOverdue = Boolean(row.dueDate && todayYmd > row.dueDate);
    if (overdueOnly && !isOverdue) return;
    rows.push({
      ...row,
      daysOverdue: isOverdue ? daysFromDueToToday(row.dueDate, todayYmd) : 0,
    });
  };

  for (const cust of customers) {
    const settlementDays = getOverdueDaysForCustomer(overdueDates, cust.id);
    const { paidByBillId, pastPaid, custBills } = computeBillPaymentAllocation(
      cust,
      bills,
      payments,
      promotions,
      returnsRows,
    );

    const pastOwed = toNonNegMoney(cust.pastBill);
    const openingRemaining = Math.round((pastOwed - pastPaid) * 100) / 100;
    if (openingRemaining > 0) {
      const billDate = openingBalanceBillDate(cust);
      const dueRaw = String(cust.dueDate ?? '').slice(0, 10);
      const due = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : addDaysToYmd(billDate, settlementDays);
      pushIfMatch({
        id: openingBalanceBillId(cust.id),
        customerName: cust.name,
        billDate,
        dueDate: due,
        daysFromBillDate: daysFromDueToToday(billDate, todayYmd),
        outstandingAmount: openingRemaining,
        billTotal: pastOwed,
        invoiceNumber: 'Opening',
        details: 'Opening balance',
        settlementDays,
        isOpeningBalance: true,
      });
    }

    for (const bill of custBills) {
      const total = effectiveBillTotal(bill, promotions, returnsRows);
      const id = String(bill.id ?? '').trim();
      const paidTowardBill = id ? paidByBillId.get(id) || 0 : 0;
      const remaining = Math.round((total - paidTowardBill) * 100) / 100;
      const due = addDaysToYmd(bill.date, settlementDays);
      if (remaining > 0) {
        pushIfMatch({
          id: bill.id,
          customerName: cust.name,
          billDate: bill.date,
          dueDate: due,
          daysFromBillDate: daysFromDueToToday(bill.date, todayYmd),
          outstandingAmount: remaining,
          billTotal: total,
          invoiceNumber: String(bill.invoiceNumber ?? '').trim(),
          details: billDetailsLine(bill),
          settlementDays,
        });
      }
    }
  }

  const registeredNk = new Set(customers.map((c) => normalizeCustomerName(c.name)));
  const orphanBillsByNk = new Map();
  for (const bill of bills) {
    const nk = normalizeCustomerName(bill.customerName);
    if (registeredNk.has(nk)) continue;
    if (!orphanBillsByNk.has(nk)) orphanBillsByNk.set(nk, []);
    orphanBillsByNk.get(nk).push(bill);
  }

  for (const [nk, obills] of orphanBillsByNk) {
    let paySum = 0;
    for (const p of payments) {
      if (normalizeCustomerName(p.customerName) === nk) paySum += paymentCreditToCustomer(p);
    }
    const sortedBills = [...obills].sort((a, b) => {
      const cmp = String(a.date).localeCompare(String(b.date));
      if (cmp !== 0) return cmp;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    let remainingCredit = paySum;
    for (const bill of sortedBills) {
      const total = toNonNegMoney(bill.totalAmount);
      const paidTowardBill = Math.min(total, remainingCredit);
      remainingCredit -= paidTowardBill;
      const remaining = Math.round((total - paidTowardBill) * 100) / 100;
      const due = addDaysToYmd(bill.date, BILL_SETTLEMENT_DAYS);
      if (remaining > 0) {
        const name = String(bill.customerName ?? '').trim() || 'Unknown';
        pushIfMatch({
          id: bill.id,
          customerName: name,
          billDate: bill.date,
          dueDate: due,
          daysFromBillDate: daysFromDueToToday(bill.date, todayYmd),
          outstandingAmount: remaining,
          billTotal: total,
          details: billDetailsLine(bill),
        });
      }
    }
  }

  rows.sort((a, b) => {
    const shopCmp = String(a.customerName ?? '').localeCompare(String(b.customerName ?? ''));
    if (shopCmp !== 0) return shopCmp;
    if (Boolean(a.isOpeningBalance) !== Boolean(b.isOpeningBalance)) {
      return a.isOpeningBalance ? -1 : 1;
    }
    const dateCmp = String(a.billDate ?? '').localeCompare(String(b.billDate ?? ''));
    if (dateCmp !== 0) return dateCmp;
    return (Number(b.outstandingAmount) || 0) - (Number(a.outstandingAmount) || 0);
  });
  return rows;
}

/** Overdue credit bills (same rules as `/api/overdue-bills`). */
function collectOverdueBillRows(customers, bills, payments, overdueDates = {}, promotions = [], returnsRows = []) {
  return collectUnpaidBillRows(
    customers,
    bills,
    payments,
    overdueDates,
    { overdueOnly: true, returnsRows },
    promotions,
  ).sort(
    (a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return b.outstandingAmount - a.outstandingAmount;
    },
  );
}

/** All unpaid credit bills (pending), including those not yet overdue. */
function collectPendingBillRows(customers, bills, payments, overdueDates = {}, promotions = [], returnsRows = []) {
  return collectUnpaidBillRows(
    customers,
    bills,
    payments,
    overdueDates,
    { overdueOnly: false, returnsRows },
    promotions,
  );
}

/** Longest days past due → UI priority tier (green → red). */
function overduePriorityFromMaxDays(maxDays) {
  if (!maxDays || maxDays <= 0) return 'none';
  if (maxDays <= 7) return 'low';
  if (maxDays <= 14) return 'moderate';
  if (maxDays <= 30) return 'high';
  return 'critical';
}

/** Daily cash in (customer payments) vs cash out (load/stock purchases) */
app.get('/api/cash-flow', async (req, res) => {
  try {
    const n = Math.min(90, Math.max(1, parseInt(String(req.query.days), 10) || 7));
    const dayKeys = lastNDaysYmdLocal(n);
    const daySet = new Set(dayKeys);
    const [payments, stocks] = await Promise.all([readPayments(), readStocks()]);

    const inByDate = Object.fromEntries(dayKeys.map((d) => [d, 0]));
    const outByDate = Object.fromEntries(dayKeys.map((d) => [d, 0]));

    for (const p of payments) {
      const d = String(p.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      inByDate[d] += paymentCreditToCustomer(p);
    }
    for (const s of stocks) {
      const d = String(s.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      outByDate[d] += toNonNegMoney(s.totalAmount);
    }

    const round2 = (x) => Math.round(Number(x) * 100) / 100;
    const series = dayKeys.map((date) => ({
      date,
      label: date.slice(5).replace('-', '/'),
      cashIn: round2(inByDate[date]),
      cashOut: round2(outByDate[date]),
    }));
    res.json(series);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load cash flow' });
  }
});

/** Running balance per shop bank account (deposits + deposited cheques + approved CDM / online − cleared PO cheques; pending until converting date). */
app.get('/api/bank-account-balances', async (req, res) => {
  try {
    const shop = await readShopData();
    const [cashBookEntries, payments, purchaseOrders] = await Promise.all([
      readCashBookEntries(),
      readPayments(),
      readPurchaseOrders(),
    ]);
    const payload = computeBankAccountBalances({
      bankAccounts: shop.bankAccounts || [],
      cashBookEntries,
      payments,
      purchaseOrders,
      asOf: req.query.asOf,
    });
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load bank account balances' });
  }
});

app.get('/api/cash-book-entries', async (req, res) => {
  try {
    const from = String(req.query.from ?? '').trim().slice(0, 10);
    const to = String(req.query.to ?? '').trim().slice(0, 10);
    const category = String(req.query.category ?? '').trim();
    const excludeCategory = String(req.query.excludeCategory ?? '').trim();
    const staffUserId = String(req.query.staffUserId ?? '').trim();
    const lorryId = String(req.query.lorryId ?? '').trim();

    let rows = await readCashBookEntries();
    if (category && CASH_BOOK_CATEGORIES.includes(category)) {
      rows = rows.filter((r) => r.category === category);
    }
    if (excludeCategory && CASH_BOOK_CATEGORIES.includes(excludeCategory)) {
      rows = rows.filter((r) => r.category !== excludeCategory);
    }
    if (staffUserId) {
      rows = rows.filter((r) => String(r.staffUserId ?? '').trim() === staffUserId);
    }
    if (lorryId) {
      rows = rows.filter((r) => String(r.lorryId ?? '').trim() === lorryId);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      rows = rows.filter((r) => r.date >= from);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      rows = rows.filter((r) => r.date <= to);
    }

    rows.sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read cash book entries' });
  }
});

app.post('/api/cash-book-entries', async (req, res) => {
  try {
    const body = req.body || {};
    const [users, lorries, shop] = await Promise.all([readUsers(), readLorries(), readShopData()]);
    const staffById = new Map(users.map((u) => [u.id, u]));
    const lorryById = new Map(lorries.map((l) => [l.id, l]));
    const bankAccountById = new Map((shop.bankAccounts || []).map((a) => [a.id, a]));

    const validated = validateCreateBody(body, { staffById, lorryById, bankAccountById });
    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }

    const entries = await readCashBookEntries();
    const row = normalizeEntry({
      id: `cbe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...validated.payload,
      createdAt: new Date().toISOString(),
    });
    entries.push(row);
    await writeCashBookEntries(entries);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save cash book entry' });
  }
});

app.get('/api/bank-guarantees', async (req, res) => {
  try {
    const from = String(req.query.from ?? '').trim().slice(0, 10);
    const to = String(req.query.to ?? '').trim().slice(0, 10);
    const guaranteeType = String(req.query.guaranteeType ?? '').trim();
    const distributorId = String(req.query.distributorId ?? '').trim();

    let rows = await readBankGuarantees();
    if (guaranteeType) {
      rows = rows.filter((r) => r.guaranteeType === guaranteeType);
    }
    if (distributorId) {
      rows = rows.filter((r) => r.distributorId === distributorId);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      rows = rows.filter((r) => r.date >= from);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      rows = rows.filter((r) => r.date <= to);
    }

    rows.sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read bank guarantees' });
  }
});

app.post('/api/bank-guarantees', async (req, res) => {
  try {
    const body = req.body || {};
    const shop = await readShopData();
    const bankAccountById = new Map((shop.bankAccounts || []).map((a) => [a.id, a]));
    const distributors = await readDistributors();
    const distributorById = new Map(distributors.map((d) => [d.id, d]));

    const validated = validateBankGuaranteeCreateBody(body, { bankAccountById, distributorById });
    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }

    const entries = await readBankGuarantees();
    const row = normalizeBankGuarantee({
      id: `bg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...validated.payload,
      createdAt: new Date().toISOString(),
    });
    entries.push(row);
    await writeBankGuarantees(entries);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save bank guarantee' });
  }
});

app.delete('/api/bank-guarantees/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Bank guarantee id is required' });
    }
    const entries = await readBankGuarantees();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Bank guarantee not found' });
    }
    entries.splice(idx, 1);
    await writeBankGuarantees(entries);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to remove bank guarantee' });
  }
});

/** Daily bag totals from credit bills (distributor-configured products) */
app.get('/api/bag-sales-by-day', async (req, res) => {
  try {
    const n = Math.min(90, Math.max(1, parseInt(String(req.query.days), 10) || 7));
    const dayKeys = lastNDaysYmdLocal(n);
    const daySet = new Set(dayKeys);
    const products = await getBagProducts();
    const bills = await readBills();
    const byDay = Object.fromEntries(
      dayKeys.map((d) => [d, Object.fromEntries(products.map((p) => [p.key, 0]))]),
    );
    for (const b of bills) {
      const d = String(b.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      for (const p of products) {
        byDay[d][p.key] += toNonNegNumber(b[p.bagsField]);
      }
    }
    const series = dayKeys.map((date) => ({
      date,
      label: date.slice(5).replace('-', '/'),
      ...byDay[date],
    }));
    res.json(series);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load bag sales by day' });
  }
});

/** Latest customer payments (cash in) and stock load purchases (cash out), merged by time */
app.get('/api/recent-transfers', async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit), 10) || 5));
    const [payments, stocks] = await Promise.all([readPayments(), readStocks()]);
    const rows = [];

    for (const p of payments) {
      const id = String(p.id ?? '').trim();
      const at = p.createdAt || `${String(p.date ?? '').slice(0, 10)}T12:00:00`;
      const title = String(p.customerName ?? '').trim() || 'Customer payment';
      const billNum = String(p.billNumber ?? '').trim();
      rows.push({
        id: id ? `payment-${id}` : `payment-${at}-${billNum}-${paymentCreditToCustomer(p)}`,
        kind: 'payment_in',
        at,
        title,
        subtitle: billNum ? `Bill #${billNum} · Payment in` : 'Payment in',
        amount: paymentCreditToCustomer(p),
      });
    }

    for (const s of stocks) {
      const id = String(s.id ?? '').trim();
      const at = s.createdAt || `${String(s.date ?? '').slice(0, 10)}T12:00:00`;
      const stockId = String(s.stockId ?? '').trim();
      const veh = String(s.vehicleNumber ?? '').trim();
      rows.push({
        id: id ? `stock-${id}` : `stock-${at}-${stockId}`,
        kind: 'stock_purchase',
        at,
        title: stockId ? `Load ${stockId}` : 'Stock purchase',
        subtitle: veh ? `${veh} · Paid for stock` : 'Paid for stock',
        amount: toNonNegMoney(s.totalAmount),
      });
    }

    rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(rows.slice(0, limit));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load recent transfers' });
  }
});

/**
 * Bills that are still unpaid past the settlement window (bill date + per-customer overdue days, default 14 local).
 * Payments apply to `pastBill` first, then to bills in chronological order (same idea as balances).
 */
app.get('/api/overdue-bills', async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    const [customers, bills, payments, overdueDates, promotions, returnsRows] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
      readOverdueDates(),
      readPromotions(),
      readReturns(),
    ]);
    let rows = collectOverdueBillRows(customers, bills, payments, overdueDates, promotions, returnsRows);
    rows = await filterRowsForCollector(rows, auth, (row) => row.customerName);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load overdue bills' });
  }
});

/**
 * All unpaid credit bills (pending), including bills not yet past the settlement window.
 * Same payment allocation as `/api/overdue-bills`.
 */
app.get('/api/pending-bills', async (req, res) => {
  try {
    const [customers, bills, payments, overdueDates, promotions, returnsRows] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
      readOverdueDates(),
      readPromotions(),
      readReturns(),
    ]);
    res.json(collectPendingBillRows(customers, bills, payments, overdueDates, promotions, returnsRows));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load pending bills' });
  }
});

app.post('/api/login', async (req, res) => {
  const expectedUser = (process.env.ADMIN_USERNAME || '').trim();
  const expectedPass = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expectedUser || !expectedPass) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const body = req.body || {};
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '').trim();
  try {
    if (username === expectedUser && password === expectedPass) {
      return res.json({
        ok: true,
        role: 'admin',
        token: signToken(expectedUser, 'admin'),
        username: expectedUser,
        stockUpdateEnabled: await isStockUpdateEnabled(),
        collectorUnloadPriceEnabled: await isCollectorUnloadPriceEnabled(),
        stockItemUnloadPriceEnabled: await isStockItemUnloadPriceEnabled(),
      });
    }
    if (await verifyStoredUser(username, password)) {
      const u = await findUserByUsername(username);
      if (!u) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const userRole = String(u.role || '').trim();
      const stockUpdateEnabled = await isStockUpdateEnabled();
      const collectorUnloadPriceEnabled = await isCollectorUnloadPriceEnabled();
      const stockItemUnloadPriceEnabled = await isStockItemUnloadPriceEnabled();
      if (userRole === 'DSR' && !stockUpdateEnabled) {
        return res.status(403).json({
          error: 'DSR sign-in is disabled. Enable stock update in Settings.',
        });
      }
      if (userRole === 'Admin') {
        return res.json({
          ok: true,
          role: 'admin',
          token: signToken(u.username, 'admin'),
          username: u.username,
          stockUpdateEnabled,
          collectorUnloadPriceEnabled,
          stockItemUnloadPriceEnabled,
        });
      }
      return res.json({
        ok: true,
        role: 'staff',
        staffRole: userRole,
        managerAccess: userRole === 'Manager' ? getEffectiveManagerAccess(u.access) : undefined,
        token: signToken(u.username, 'staff'),
        username: u.username,
        name: String(u.name || '').trim() || u.username,
        stockUpdateEnabled,
        collectorUnloadPriceEnabled,
        stockItemUnloadPriceEnabled,
      });
    }
    return res.status(401).json({ error: 'Invalid username or password' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/me', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  try {
    const stockUpdateEnabled = await isStockUpdateEnabled();
    const collectorUnloadPriceEnabled = await isCollectorUnloadPriceEnabled();
    const stockItemUnloadPriceEnabled = await isStockItemUnloadPriceEnabled();
    if (auth.role === 'admin') {
      const adminUser = await findUserByUsername(auth.username);
      if (adminUser) {
        return res.json({
          username: adminUser.username,
          role: 'admin',
          name: String(adminUser.name || '').trim() || adminUser.username,
          staffRole: 'Administrator',
          contact: String(adminUser.contact || '').trim(),
          nic: String(adminUser.nic || '').trim(),
          stockUpdateEnabled,
          collectorUnloadPriceEnabled,
          stockItemUnloadPriceEnabled,
        });
      }
      return res.json({
        username: auth.username,
        role: 'admin',
        name: auth.username,
        staffRole: 'Administrator',
        stockUpdateEnabled,
        collectorUnloadPriceEnabled,
        stockItemUnloadPriceEnabled,
      });
    }
    const u = await findUserByUsername(auth.username);
    if (!u) {
      return res.status(401).json({ error: 'User not found' });
    }
    const staffRole = String(u.role || '').trim();
    if (staffRole === 'DSR' && !stockUpdateEnabled) {
      return res.status(403).json({ error: 'DSR sign-in is disabled. Enable stock update in Settings.' });
    }
    const payload = {
      username: u.username,
      role: 'staff',
      staffRole,
      name: String(u.name || '').trim() || u.username,
      contact: String(u.contact || '').trim(),
      nic: String(u.nic || '').trim(),
      stockUpdateEnabled,
      collectorUnloadPriceEnabled,
      stockItemUnloadPriceEnabled,
    };
    if (staffRole === 'Manager') {
      payload.managerAccess = getEffectiveManagerAccess(u.access);
    }
    if (staffRole === 'Collector') {
      payload.collectorAccess = getEffectiveCollectorAccess();
      payload.staffUserId = u.id;
    }
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

/** Driver portal sign-in (NIC + password, Driver role only). */
app.post('/api/driver/login', async (req, res) => {
  const body = req.body || {};
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '').trim();
  if (!username || !password) {
    return res.status(400).json({ error: 'NIC and password are required' });
  }
  try {
    if (!(await verifyStoredUser(username, password))) {
      return res.status(401).json({ error: 'Invalid NIC or password' });
    }
    const u = await findUserByUsername(username);
    if (!u) {
      return res.status(401).json({ error: 'Invalid NIC or password' });
    }
    if (String(u.role || '').trim() !== 'Driver') {
      return res.status(403).json({ error: 'This sign-in is for driver accounts only' });
    }
    return res.json({
      ok: true,
      role: 'staff',
      staffRole: 'Driver',
      token: signToken(u.username, 'staff'),
      username: u.username,
      name: String(u.name || '').trim() || u.username,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

async function requireDriverOrAdmin(req, res) {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'Sign in as driver to continue' });
    return null;
  }
  if (auth.role === 'admin') {
    return { ...auth, name: auth.username, driverName: auth.username };
  }
  const u = await findUserByUsername(auth.username);
  if (!u || String(u.role || '').trim() !== 'Driver') {
    res.status(403).json({ error: 'Only drivers can use this action' });
    return null;
  }
  const name = String(u.name || '').trim() || u.username;
  return { ...auth, name, driverName: name };
}

async function requireCollectorUnloadPriceAccess(req, res) {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'Sign in to continue' });
    return null;
  }
  if (!(await isCollectorUnloadPriceEnabled())) {
    res.status(403).json({ error: 'Collector unload price updates are disabled' });
    return null;
  }
  const u = await findUserByUsername(auth.username);
  if (!u || String(u.role || '').trim() !== 'Collector') {
    res.status(403).json({ error: 'Only collectors can update unload prices' });
    return null;
  }
  return { ...auth, staffUser: u };
}

async function requireManagerOrAdmin(req, res) {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'Sign in again to continue' });
    return null;
  }
  if (auth.role === 'admin') {
    return auth;
  }
  const u = await findUserByUsername(auth.username);
  if (!u || String(u.role || '').trim() !== 'Manager') {
    res.status(403).json({ error: 'Only managers or admin can perform this action' });
    return null;
  }
  return auth;
}

async function requireMapStockViewer(req, res) {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'Sign in to view shop stock' });
    return null;
  }
  if (auth.role === 'admin') {
    return { ...auth, staffRole: 'Admin' };
  }
  const u = await findUserByUsername(auth.username);
  const role = String(u?.role || '').trim();
  if (role === 'Collector' || role === 'DSR') {
    if (!(await isStockUpdateEnabled())) {
      res.status(403).json({ error: 'Stock update is disabled' });
      return null;
    }
    return {
      ...auth,
      staffRole: role,
      staffUserId: u.id,
      name: String(u.name || '').trim() || u.username,
    };
  }
  res.status(403).json({ error: 'Only admin, collector, or DSR can view shop stock' });
  return null;
}

async function requireShopStockUpdater(req, res) {
  const viewer = await requireMapStockViewer(req, res);
  if (!viewer) return null;
  if (viewer.staffRole === 'Collector' || viewer.staffRole === 'DSR') {
    return viewer;
  }
  res.status(403).json({ error: 'Only collector or DSR can update shop stock' });
  return null;
}

function lastUnloadItems(record, products) {
  return activeBagProductsOnRecord(record || {}, products).map(({ product, bags }) => ({
    key: product.key,
    label: formatProductLabel(product) || product.label,
    code: product.code || '',
    lastUnloadBags: bags,
    bagsField: product.bagsField,
  }));
}

function shopStockPublicRow(row, products, lastItems) {
  const items = (lastItems || []).map((item) => ({
    ...item,
    bags: row?.stock?.[item.key] != null ? toNonNegInt(row.stock[item.key]) : item.lastUnloadBags,
  }));
  return {
    shopId: row?.shopId || '',
    customerId: row?.customerId || '',
    items,
    updatedAt: row?.updatedAt || '',
    updatedBy: row?.updatedBy || '',
  };
}

async function resolveShopCustomer(shop) {
  const customers = await readCustomers();
  const customerId = String(shop.customerId ?? shop.id ?? '').trim();
  return (
    customers.find((c) => c.id === customerId) ||
    customers.find((c) => normalizeCustomerName(c.name) === normalizeCustomerName(shop.name)) ||
    null
  );
}

app.get('/api/unloads', async (req, res) => {
  const auth = await requireDriverOrAdmin(req, res);
  if (!auth) return;
  try {
    let rows = await readUnloads();
    if (auth.role !== 'admin') {
      const u = await findUserByUsername(auth.username);
      if (u && String(u.role || '').trim() === 'Driver') {
        rows = rows.filter((r) => String(r.recordedBy || '') === auth.username);
      }
    }
    const sorted = [...rows].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    const products = await getBagProducts();
    const bills = await readBills();
    res.json(sorted.map((row) => attachLastPricesToUnload(row, bills, products)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read unloads' });
  }
});

/** Manager/admin: pending driver unload requests. */
app.get('/api/unload-requests', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    const statusFilter = String(req.query.status ?? 'pending').trim().toLowerCase();
    let rows = await readUnloads();
    const stockItemUnloadPriceEnabled = await isStockItemUnloadPriceEnabled();
    if (statusFilter === 'all') {
      rows = rows.filter(
        (r) =>
          normalizeStatus(r.status) !== 'pending' ||
          shouldListUnloadRequestForAdmin(r, stockItemUnloadPriceEnabled),
      );
    } else if (statusFilter === 'pending') {
      rows = rows.filter((r) => shouldListUnloadRequestForAdmin(r, stockItemUnloadPriceEnabled));
    } else {
      rows = rows.filter((r) => normalizeStatus(r.status) === statusFilter);
    }
    const sorted = [...rows].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
    const products = await getBagProducts();
    const bills = await readBills();
    const stocks = await readStocks();
    res.json(
      sorted.map((row) =>
        presentUnloadRequestForAdmin(row, bills, products, { stocks, stockItemUnloadPriceEnabled }),
      ),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read unload requests' });
  }
});

async function sendUnloadCustomerNotifications(customer, unloadRecord) {
  const notificationSettings = await readNotificationSettings();
  if (notificationSettings.notifyUnload === false) return;
  if (customer?.email) {
    notifyUnloadEmail(customer, unloadRecord).catch((err) =>
      console.error('unload email notification', err),
    );
  }
  if (customer?.contactNumber) {
    notifyUnloadWhatsApp(customer, unloadRecord).catch((err) =>
      console.error('unload whatsapp notification', err),
    );
  }
}

function lastBillUnitPricesForCustomer(bills, customerName, products) {
  const nk = normalizeCustomerName(customerName);
  if (!nk) return null;
  const matches = bills.filter((b) => normalizeCustomerName(b.customerName) === nk);
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da !== db) return db.localeCompare(da);
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
  const latest = matches[0];
  const prices = { billId: latest.id, date: latest.date, customerName: latest.customerName };
  for (const p of products) {
    let unit = null;
    for (const bill of matches) {
      const n = Number(bill[p.unitPriceField]);
      if (Number.isFinite(n) && n > 0) {
        unit = n;
        break;
      }
    }
    prices[p.unitPriceField] = unit;
  }
  return prices;
}

function roundMoney2(n) {
  return Math.round(toNonNegMoney(n) * 100) / 100;
}

function stockUnloadPricesFromLoad(load, products) {
  if (!load || !Array.isArray(products)) return null;
  const prices = {};
  let any = false;
  for (const p of products) {
    const field = p.unloadPriceField || `${p.key}UnloadPrice`;
    const n = toNonNegMoney(load[field]);
    prices[p.unitPriceField] = n > 0 ? n : null;
    if (n > 0) any = true;
  }
  return any ? prices : null;
}

function resolveStockUnloadPrices(row, stocks, bills, products) {
  if (!Array.isArray(stocks) || stocks.length === 0) return null;
  let stockId = String(row?.stockId || '').trim();
  if (!stockId) {
    const keys = products.map((p) => p.key);
    stockId = inferStockIdForBillBags(stocks, bills || [], row, keys);
  }
  if (!stockId) return null;
  const load = stocks.find((s) => String(s.stockId || '').trim() === stockId);
  return stockUnloadPricesFromLoad(load, products);
}

function submittedPricesMatchStockDefaults(pricedRow, defaults, products) {
  if (!defaults) return false;
  let compared = 0;
  for (const p of products) {
    const bags = toNonNegNumber(pricedRow[p.bagsField]);
    if (bags <= 0) continue;
    const submitted = roundMoney2(pricedRow[p.unitPriceField]);
    const def = roundMoney2(defaults[p.unitPriceField]);
    if (!(def > 0) || submitted !== def) return false;
    compared += 1;
  }
  return compared > 0;
}

function collectorHasPricedUnload(row) {
  return Boolean(String(row?.priceUpdatedAt ?? '').trim() || String(row?.priceUpdatedBy ?? '').trim());
}

function isVisiblePriceChangeRequest(row, stockItemUnloadPriceEnabled) {
  return Boolean(stockItemUnloadPriceEnabled) && Boolean(row?.priceChangeRequest);
}

/** Pending unloads the admin/manager should see. Collector-priced bags skip lorry stock approval. */
function shouldListUnloadRequestForAdmin(row, stockItemUnloadPriceEnabled) {
  if (normalizeStatus(row.status) !== 'pending') return false;
  if (!collectorHasPricedUnload(row)) return true;
  return isVisiblePriceChangeRequest(row, stockItemUnloadPriceEnabled);
}

function stripCollectorUnitPrices(row, products) {
  const next = { ...row };
  for (const p of products || []) {
    next[p.unitPriceField] = 0;
    next[`${p.key}Line`] = 0;
  }
  next.totalAmount = 0;
  return next;
}

function presentUnloadRequestForAdmin(row, bills, products, options = {}) {
  const stockItemUnloadPriceEnabled = Boolean(options.stockItemUnloadPriceEnabled);
  const visiblePriceChange = isVisiblePriceChangeRequest(row, stockItemUnloadPriceEnabled);
  let next = { ...row, priceChangeRequest: visiblePriceChange };
  if (!visiblePriceChange && collectorHasPricedUnload(row)) {
    next = stripCollectorUnitPrices(next, products);
    next.priceChangeRequest = false;
    return next;
  }
  next = attachLastPricesToUnload(next, bills, products, {
    stocks: options.stocks,
    stockItemUnloadPriceEnabled,
  });
  next.priceChangeRequest = visiblePriceChange;
  return next;
}

function attachLastPricesToUnload(row, bills, products, options = {}) {
  const { stocks = null, stockItemUnloadPriceEnabled = false } = options;
  const last = lastBillUnitPricesForCustomer(bills, row?.customerName, products);
  const stockPrices =
    stockItemUnloadPriceEnabled ? resolveStockUnloadPrices(row, stocks, bills, products) : null;
  const next = { ...row };
  if (stockItemUnloadPriceEnabled) {
    next.stockItemUnloadPriceEnabled = true;
    if (stockPrices) next.stockUnloadPrices = stockPrices;
  }
  let totalAmount = 0;
  for (const p of products) {
    const bags = toNonNegNumber(next[p.bagsField]);
    let unit = toNonNegMoney(next[p.unitPriceField]);
    if (!(unit > 0) && stockPrices) {
      const fromStock = toNonNegMoney(stockPrices[p.unitPriceField]);
      if (fromStock > 0) unit = fromStock;
    }
    if (!(unit > 0) && last) {
      const fromLast = toNonNegMoney(last[p.unitPriceField]);
      if (fromLast > 0) unit = fromLast;
    }
    if (unit > 0) next[p.unitPriceField] = unit;
    const line = lineTotal(bags, unit);
    next[`${p.key}Line`] = line;
    totalAmount += line;
  }
  next.totalAmount = Math.round(totalAmount * 100) / 100;
  return next;
}

function applyUnitPricesToRecord(record, body, products) {
  const next = { ...record };
  let totalAmount = 0;
  let anyPriced = false;
  for (const p of products) {
    const bags = toNonNegNumber(next[p.bagsField]);
    let unit = toNonNegMoney(next[p.unitPriceField]);
    if (bags > 0) {
      if (body[p.unitPriceField] === undefined || String(body[p.unitPriceField]).trim() === '') {
        return { error: `Enter a unit price for ${formatProductLabel(p) || p.label}` };
      }
      unit = toNonNegMoney(body[p.unitPriceField]);
      if (!(unit > 0)) {
        return { error: `Enter a unit price for ${formatProductLabel(p) || p.label}` };
      }
      anyPriced = true;
    }
    next[p.unitPriceField] = bags > 0 ? unit : toNonNegMoney(next[p.unitPriceField]);
    const line = lineTotal(bags, next[p.unitPriceField]);
    next[`${p.key}Line`] = line;
    totalAmount += line;
  }
  if (!anyPriced) return { error: 'This unload has no bags' };
  next.totalAmount = Math.round(totalAmount * 100) / 100;
  return { row: next };
}

function enrichUnloadForCollector(row, bills, stocks, products, options = {}) {
  const status = normalizeStatus(row.status);
  let next = { ...row };
  if (status === 'approved') {
    const bill = bills.find((b) => String(b.id) === String(row.billId));
    if (bill) {
      for (const p of products) {
        next[p.unitPriceField] = bill[p.unitPriceField];
        next[`${p.key}Line`] = bill[`${p.key}Line`];
      }
      next.totalAmount = bill.totalAmount;
      if (bill.invoiceNumber) next.invoiceNumber = bill.invoiceNumber;
      if (bill.stockId) next.stockId = bill.stockId;
    }
  }
  next = attachLastPricesToUnload(next, bills, products, {
    stocks,
    stockItemUnloadPriceEnabled: Boolean(options.stockItemUnloadPriceEnabled),
  });
  let stockId = String(next.stockId || '').trim();
  if (!stockId) {
    const keys = products.map((p) => p.key);
    stockId = inferStockIdForBillBags(stocks, bills, next, keys);
  }
  if (stockId) {
    next.stockId = stockId;
    const load = stocks.find((s) => String(s.stockId || '').trim() === stockId);
    if (load) next.vehicleNumber = String(load.vehicleNumber || '').trim();
  }
  return next;
}

function suggestNextInvoiceForUnload(bills, unloads) {
  const pending = (Array.isArray(unloads) ? unloads : [])
    .filter((r) => normalizeStatus(r.status) === 'pending')
    .map((r) => ({ createdAt: r.createdAt, invoiceNumber: r.invoiceNumber }));
  return suggestNextBillInvoiceNumber([...(Array.isArray(bills) ? bills : []), ...pending]);
}

app.get('/api/bills/last-unit-prices', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again to continue' });
  }
  try {
    const staffUser = await resolveStaffUser(auth);
    const isMgr = auth.role === 'admin' || (staffUser && String(staffUser.role || '').trim() === 'Manager');
    const isCollectorPrice =
      staffUser && isCollectorStaff(staffUser) && (await isCollectorUnloadPriceEnabled());
    if (!isMgr && !isCollectorPrice) {
      return res.status(403).json({ error: 'Only managers, admin, or collectors with unload price access can load last prices' });
    }
    const customerId = String(req.query.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    if (isCollectorPrice && !customerAssignedToCollector(cust, staffUser.id)) {
      return res.status(403).json({ error: 'This shop is not assigned to you' });
    }
    const bills = await readBills();
    const products = await getBagProducts();
    const last = lastBillUnitPricesForCustomer(bills, cust.name, products);
    if (!last) {
      return res.json({ found: false, customerId: cust.id, customerName: cust.name });
    }
    res.json({ found: true, customerId: cust.id, customerName: cust.name, ...last });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load last unit prices' });
  }
});

app.get('/api/collector/unloads', async (req, res) => {
  const auth = await requireCollectorUnloadPriceAccess(req, res);
  if (!auth) return;
  try {
    const [unloads, bills, stocks, products] = await Promise.all([
      readUnloads(),
      readBills(),
      readStocks(),
      getBagProducts(),
    ]);
    const stockItemUnloadPriceEnabled = await isStockItemUnloadPriceEnabled();
    let rows = unloads.filter((r) => normalizeStatus(r.status) === 'pending');
    rows = await filterRowsForCollector(rows, auth, (row) => row.customerName);
    const sorted = [...rows].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(
      sorted.map((row) =>
        enrichUnloadForCollector(row, bills, stocks, products, { stockItemUnloadPriceEnabled }),
      ),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read unloads' });
  }
});

async function createBillFromPendingUnload({ unloads, idx, priceBody = {}, enteredBy, approvedBy }) {
  const requestRow = unloads[idx];
  if (!requestRow) return { ok: false, error: 'Request not found', status: 404 };
  if (normalizeStatus(requestRow.status) !== 'pending') {
    return { ok: false, error: 'This request is no longer pending', status: 400 };
  }
  const billBody = { ...requestRow, ...priceBody };
  const { fields, products } = await parseBillBagFields(billBody);
  const bagSum = sumBagFields(fields, products);
  if (bagSum <= 0) return { ok: false, error: 'Request has no bags', status: 400 };
  if (fields.totalAmount <= 0) {
    return { ok: false, error: 'Enter unit price for at least one brand with bags', status: 400 };
  }
  const approver = String(approvedBy ?? enteredBy ?? '').trim() || enteredBy;

  const stocks = await readStocks();
  const bills = await readBills();
  const promotions = await readPromotions();
  const check = await validateBillAgainstPooledStock(
    stocks,
    bills,
    promotions,
    fields,
    unloads,
    requestRow.id,
    products,
  );
  if (!check.ok) return { ok: false, error: check.error, status: 400 };

  const customerName = String(requestRow.customerName ?? '').trim();
  const keys = products.map((p) => p.key);
  const stockId = inferStockIdForBillBags(stocks, bills, fields, keys);
  let invoiceNumber = normalizeBillInvoiceNumber(requestRow.invoiceNumber);
  if (!invoiceNumber || billInvoiceNumberTaken(bills, invoiceNumber)) {
    invoiceNumber = suggestNextBillInvoiceNumber(bills);
  }
  const billRow = {
    id: `bill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    date: String(requestRow.date ?? '').trim(),
    customerName,
    stockId,
    invoiceNumber,
    ...fields,
    enteredBy,
    unloadRequestId: requestRow.id,
    createdAt: new Date().toISOString(),
  };

  bills.push(billRow);
  await writeBills(bills);

  unloads[idx] = {
    ...requestRow,
    ...fields,
    status: 'approved',
    billId: billRow.id,
    invoiceNumber: billRow.invoiceNumber,
    priceChangeRequest: false,
    approvedAt: new Date().toISOString(),
    approvedBy: approver,
  };
  await writeUnloads(unloads);

  await syncBillRuleCashback(billRow, { enteredBy, products, promotions });

  const paymentsList = await readPayments();
  await refreshCustomerBalancesForBillNames(bills, paymentsList, customerName);

  try {
    await refreshLiveStockFromSources();
  } catch (err) {
    console.error('liveStock refresh after request approve', err);
  }

  const notificationSettings = await readNotificationSettings();
  const hideFinancialDetails = Boolean(notificationSettings.hideFinancialDetails);
  const sendBill = notificationSettings.notifyBill !== false;
  const skipBillBecauseUnload =
    hideFinancialDetails && notificationSettings.notifyUnload !== false;

  if (sendBill && !skipBillBecauseUnload) {
    const customersForNotify = await readCustomers();
    const custForNotify = customersForNotify.find(
      (c) => normalizeCustomerName(c.name) === normalizeCustomerName(customerName),
    );
    if (custForNotify?.email) {
      notifyBillEmail(custForNotify, billRow, custForNotify.remainingAmount).catch((err) =>
        console.error('bill email notification', err),
      );
    }
    if (custForNotify?.contactNumber) {
      notifyBillWhatsApp(custForNotify, billRow, custForNotify.remainingAmount).catch((err) =>
        console.error('bill whatsapp notification', err),
      );
    }
  }

  return { ok: true, billRow, requestRow: unloads[idx], products };
}

app.patch('/api/collector/unloads/:id/prices', async (req, res) => {
  const auth = await requireCollectorUnloadPriceAccess(req, res);
  if (!auth) return;
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? auth.username ?? '').trim();
    if (!id) return res.status(400).json({ error: 'Unload id is required' });
    if (!updatedBy) return res.status(400).json({ error: 'updatedBy is required' });

    const unloads = await readUnloads();
    const idx = unloads.findIndex((r) => r.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Unload not found' });
    const existing = unloads[idx];
    const status = normalizeStatus(existing.status);
    if (status === 'rejected') {
      return res.status(400).json({ error: 'Rejected unloads cannot be priced' });
    }

    const customers = await readCustomers();
    const cust =
      customers.find((c) => c.id === existing.customerId) ||
      customers.find((c) => normalizeCustomerName(c.name) === normalizeCustomerName(existing.customerName));
    if (!cust || !customerAssignedToCollector(cust, auth.staffUser.id)) {
      return res.status(403).json({ error: 'This shop is not assigned to you' });
    }

    const products = await getBagProducts();
    const priced = applyUnitPricesToRecord(existing, body, products);
    if (priced.error) return res.status(400).json({ error: priced.error });

    const now = new Date().toISOString();
    const stockItemUnloadPriceEnabled = await isStockItemUnloadPriceEnabled();
    const stocks = await readStocks();
    const billsForDefaults = await readBills();
    const stockPrices = stockItemUnloadPriceEnabled
      ? resolveStockUnloadPrices(existing, stocks, billsForDefaults, products)
      : null;
    const matchesStockDefault =
      stockItemUnloadPriceEnabled &&
      submittedPricesMatchStockDefaults(priced.row, stockPrices, products);
    const autoApproveAsAdmin = !stockItemUnloadPriceEnabled;
    const priceChangeRequest = Boolean(stockItemUnloadPriceEnabled && !matchesStockDefault);
    const shouldCreateInvoiceNow =
      status === 'pending' && (matchesStockDefault || autoApproveAsAdmin);

    unloads[idx] = {
      ...priced.row,
      priceUpdatedBy: updatedBy,
      priceUpdatedAt: now,
      priceChangeRequest,
    };

    let billRow = null;
    if (status === 'approved' && existing.billId) {
      const bills = await readBills();
      const billIdx = bills.findIndex((b) => b.id === existing.billId);
      if (billIdx < 0) {
        return res.status(400).json({ error: 'Linked credit bill was not found' });
      }
      const billed = applyUnitPricesToRecord(bills[billIdx], body, products);
      if (billed.error) return res.status(400).json({ error: billed.error });
      billRow = {
        ...billed.row,
        updatedBy,
        updatedAt: now,
      };
      bills[billIdx] = billRow;
      await writeBills(bills);
      await syncBillRuleCashback(billRow, { enteredBy: updatedBy, products });
      const paymentsList = await readPayments();
      await refreshCustomerBalancesForBillNames(bills, paymentsList, billRow.customerName);
      await writeUnloads(unloads);
    } else if (shouldCreateInvoiceNow) {
      const created = await createBillFromPendingUnload({
        unloads,
        idx,
        priceBody: priced.row,
        enteredBy: updatedBy,
        approvedBy: autoApproveAsAdmin ? 'admin' : updatedBy,
      });
      if (!created.ok) {
        return res.status(created.status || 400).json({ error: created.error });
      }
      billRow = created.billRow;
    } else {
      await writeUnloads(unloads);
    }

    const [stocksForView, billsForView] = await Promise.all([readStocks(), readBills()]);
    res.json({
      unload: enrichUnloadForCollector(unloads[idx], billsForView, stocksForView, products, {
        stockItemUnloadPriceEnabled,
      }),
      bill: billRow,
      billedImmediately: Boolean(billRow && status === 'pending'),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update unload prices' });
  }
});

app.post('/api/unload-requests/:id/approve', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const enteredBy = String(body.enteredBy ?? auth.username ?? '').trim();
    if (!enteredBy) {
      return res.status(400).json({ error: 'enteredBy is required' });
    }

    const unloads = await readUnloads();
    const idx = unloads.findIndex((r) => r.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    const created = await createBillFromPendingUnload({
      unloads,
      idx,
      priceBody: body,
      enteredBy,
    });
    if (!created.ok) {
      return res.status(created.status || 400).json({ error: created.error });
    }
    res.status(201).json({ request: created.requestRow, bill: created.billRow });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

app.post('/api/unload-requests/:id/reject', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const rejectedBy = String(body.rejectedBy ?? auth.username ?? '').trim();
    const unloads = await readUnloads();
    const idx = unloads.findIndex((r) => r.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (normalizeStatus(unloads[idx].status) !== 'pending') {
      return res.status(400).json({ error: 'This request is no longer pending' });
    }
    unloads[idx] = {
      ...unloads[idx],
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy,
      rejectReason: String(body.reason ?? '').trim(),
    };
    await writeUnloads(unloads);
    res.json(unloads[idx]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

/** Manager/admin: pending payment approvals (CDM deposit / online transfer). */
app.get('/api/payment-requests', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    const statusFilter = String(req.query.status ?? 'pending').trim().toLowerCase();
    let rows = await readPayments();
    rows = rows.filter((p) => !!p.requiresApproval);
    if (statusFilter !== 'all') {
      rows = rows.filter((p) => {
        const s = String(p.approvalStatus ?? 'pending').trim().toLowerCase();
        if (statusFilter === 'pending') return s !== 'approved' && s !== 'rejected';
        return s === statusFilter;
      });
    }
    const sorted = [...rows].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read payment requests' });
  }
});

/** Manager/admin: pending request counts for sidebar badge. */
app.get('/api/requests/pending-count', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    const unloads = await readUnloads();
    const stockItemUnloadPriceEnabled = await isStockItemUnloadPriceEnabled();
    const unloadRequests = unloads.filter((r) =>
      shouldListUnloadRequestForAdmin(r, stockItemUnloadPriceEnabled),
    ).length;
    const payments = await readPayments();
    const paymentRequests = payments.filter((p) => isPaymentApprovalPending(p)).length;
    res.json({
      total: unloadRequests + paymentRequests,
      unloadRequests,
      paymentRequests,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read pending request count' });
  }
});

app.post('/api/payment-requests/:id/approve', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const approvedBy = String(body.approvedBy ?? auth.username ?? '').trim();
    if (!approvedBy) {
      return res.status(400).json({ error: 'approvedBy is required' });
    }
    const payments = await readPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Payment request not found' });
    }
    const existing = payments[idx];
    if (!existing.requiresApproval) {
      return res.status(400).json({ error: 'This payment does not require approval' });
    }
    if (!isPaymentApprovalPending(existing)) {
      return res.status(400).json({ error: 'This payment request is no longer pending' });
    }
    const shopForBanks = await readShopData();
    const resolvedBanks = resolveApprovalBankAccounts(
      existing,
      body,
      shopForBanks.bankAccounts || [],
    );
    if (resolvedBanks.error) {
      return res.status(400).json({ error: resolvedBanks.error });
    }
    const row = {
      ...existing,
      approvalStatus: 'approved',
      approvedBy,
      approvedAt: new Date().toISOString(),
    };
    attachOtherPaymentMethodsToRow(row, resolvedBanks);
    delete row.rejectedBy;
    delete row.rejectedAt;
    delete row.rejectReason;
    payments[idx] = row;
    await writePayments(payments);
    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === row.customerId);
    const billsList = await readBills();
    const promotions = await readPromotions();
    if (cust) {
      cust.remainingAmount = computeRemainingAmount(cust, billsList, payments, promotions);
      await writeCustomers(customers);
      if (cust.email) {
        notifyPaymentEmail(cust, row, cust.remainingAmount).catch((err) =>
          console.error('payment email notification', err),
        );
      }
      if (cust.contactNumber) {
        notifyPaymentWhatsApp(cust, row, cust.remainingAmount).catch((err) =>
          console.error('payment whatsapp notification', err),
        );
      }
    }
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to approve payment request' });
  }
});

app.post('/api/payment-requests/:id/reject', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const rejectedBy = String(body.rejectedBy ?? auth.username ?? '').trim();
    const payments = await readPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Payment request not found' });
    }
    const existing = payments[idx];
    if (!existing.requiresApproval) {
      return res.status(400).json({ error: 'This payment does not require approval' });
    }
    if (!isPaymentApprovalPending(existing)) {
      return res.status(400).json({ error: 'This payment request is no longer pending' });
    }
    payments[idx] = {
      ...existing,
      approvalStatus: 'rejected',
      rejectedBy,
      rejectedAt: new Date().toISOString(),
      rejectReason: String(body.reason ?? '').trim(),
    };
    await writePayments(payments);
    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === existing.customerId);
    const billsList = await readBills();
    const promotions = await readPromotions();
    if (cust) {
      cust.remainingAmount = computeRemainingAmount(cust, billsList, payments, promotions);
      await writeCustomers(customers);
    }
    res.json(payments[idx]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to reject payment request' });
  }
});

app.post('/api/unloads', async (req, res) => {
  const auth = await requireDriverOrAdmin(req, res);
  if (!auth) return;
  try {
    const body = req.body || {};
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId (shop) is required' });
    }

    let date = String(body.date ?? '').trim();
    if (auth.role !== 'admin') {
      date = paymentDateDefaultYmd();
    } else if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      date = paymentDateDefaultYmd();
    }

    const { fields, products } = await parseProductBagFields(body);
    const bagSum = sumBagFields(fields, products);
    if (bagSum <= 0) {
      return res.status(400).json({ error: 'Enter at least one bag to unload (any product).' });
    }

    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(400).json({ error: 'Shop (customer) not found' });
    }

    const summary = await getLiveStockSummary();
    const keys = products.map((p) => p.key);
    const unloadsExisting = await readUnloads();
    const pending = sumPendingUnloadBagsByBrand(unloadsExisting, keys);
    const liveByBrand = {};
    for (const b of summary.brands || []) {
      const live = Math.max(0, Math.floor(Number(b.bags) || 0));
      liveByBrand[b.key] = Math.max(0, live - (pending[b.key] ?? 0));
    }
    const labels = brandLabelsMap(products);
    const stockErrors = [];
    for (const p of products) {
      const available = liveByBrand[p.key] ?? 0;
      const need = fields[p.bagsField];
      if (need <= 0) continue;
      if (available <= 0) {
        stockErrors.push(`${formatProductLabel(p) || p.label} is out of stock.`);
      } else if (need > available) {
        stockErrors.push(
          `${formatProductLabel(p) || p.label}: only ${available.toLocaleString()} bag${available === 1 ? '' : 's'} in stock (requested ${need.toLocaleString()}).`,
        );
      }
    }
    if (stockErrors.length > 0) {
      return res.status(400).json({ error: stockErrors.join(' ') });
    }

    const note = String(body.note ?? '').trim();
    const bills = await readBills();
    const row = attachLastPricesToUnload(
      {
        id: `unload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        date,
        customerId: cust.id,
        customerName: cust.name,
        ...fields,
        recordedBy: auth.username,
        driverName: auth.driverName || auth.name || auth.username,
        note,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      bills,
      products,
    );
    row.invoiceNumber = suggestNextInvoiceForUnload(bills, unloadsExisting);

    const unloads = await readUnloads();
    unloads.push(row);
    await writeUnloads(unloads);

    await sendUnloadCustomerNotifications(cust, row);

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save unload' });
  }
});

app.get('/api/users', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const users = await readUsers();
    res.json(users.map(toPublicUser));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read users' });
  }
});

app.post('/api/users', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const body = req.body || {};
    if (String(body.role || '').trim().toLowerCase() === 'dsr' && !(await isStockUpdateEnabled())) {
      return res.status(400).json({ error: 'Enable stock update in Settings to create DSR accounts.' });
    }
    const result = await createUser({
      name: body.name,
      contact: body.contact,
      nic: body.nic,
      driverLicense: body.driverLicense,
      customerId: body.customerId,
      role: body.role,
      password: String(body.password ?? '').trim(),
      access: body.access,
      createdBy: admin.username,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.status(201).json(result.user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.patch('/api/users/:id', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const body = req.body || {};
    if (String(body.role || '').trim().toLowerCase() === 'dsr' && !(await isStockUpdateEnabled())) {
      const users = await readUsers();
      const current = users.find((u) => u.id === req.params.id);
      if (!current || String(current.role || '').trim() !== 'DSR') {
        return res.status(400).json({ error: 'Enable stock update in Settings to assign the DSR role.' });
      }
    }
    const result = await updateUser(req.params.id, {
      name: body.name,
      contact: body.contact,
      nic: body.nic,
      driverLicense: body.driverLicense,
      customerId: body.customerId,
      role: body.role,
      password: body.password,
      access: body.access,
    });
    if (!result.ok) {
      return res.status(result.error === 'User not found' ? 404 : 400).json({ error: result.error });
    }
    res.json(result.user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const result = await deleteUserById(req.params.id);
    if (!result.ok) {
      return res.status(result.error === 'User not found' ? 404 : 400).json({ error: result.error });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/collectors', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    res.json(await listCollectorStaff());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load collectors' });
  }
});

app.get('/api/collection-staff', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    res.json(await listCollectionStaff());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load collection staff' });
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    const customers = await readCustomers();
    const [bills, payments, overdueDates, users, promotions, returnsRows] = await Promise.all([
      readBills(),
      readPayments(),
      readOverdueDates(),
      readUsers(),
      readPromotions(),
      readReturns(),
    ]);
    let enriched = customers.map((c) =>
      enrichCustomerWithCollector(
        enrichCustomerBalance(c, bills, payments, overdueDates, promotions, returnsRows),
        users,
      ),
    );
    const staffUser = await resolveStaffUser(auth);
    if (isCollectorStaff(staffUser)) {
      enriched = enriched.filter((c) => customerAssignedToCollector(c, staffUser.id));
    }
    const sorted = [...enriched].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      }),
    );
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read customers' });
  }
});

app.get('/api/customers/:id/transactions', async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    const id = String(req.params.id ?? '').trim();
    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === id);
    if (!cust) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const staffUser = await resolveStaffUser(auth);
    if (isCollectorStaff(staffUser) && !customerAssignedToCollector(cust, staffUser.id)) {
      return res.status(403).json({ error: 'Not assigned to this customer' });
    }
    const nameKey = normalizeCustomerName(cust.name);

    const [bills, payments, overdueDates, users, promotions, returnsRows] = await Promise.all([
      readBills(),
      readPayments(),
      readOverdueDates(),
      readUsers(),
      readPromotions(),
      readReturns(),
    ]);
    const transactions = [];

    const openingDetails = [
      'Past bill owed on account',
      cust.addedBy ? `added by ${cust.addedBy}` : null,
      cust.pastBillUpdatedAt
        ? `balance updated ${String(cust.pastBillUpdatedAt).slice(0, 10)}${
            cust.pastBillUpdatedBy ? ` by ${cust.pastBillUpdatedBy}` : ''
          }`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    transactions.push({
      kind: 'opening',
      id: `${cust.id}-opening`,
      date: cust.createdAt ? String(cust.createdAt).slice(0, 10) : cust.dueDate,
      sortAt: cust.createdAt || `${cust.dueDate}T12:00:00`,
      type: 'Credit (opening balance)',
      details: openingDetails,
      amount: Number(cust.pastBill) || 0,
      direction: 'charge',
    });

    for (const b of bills) {
      if (normalizeCustomerName(b.customerName) !== nameKey) continue;
      transactions.push({
        kind: 'bill',
        id: b.id,
        date: b.date,
        sortAt: b.createdAt || `${b.date}T12:00:00`,
        type: 'Credit sale',
        details: [b.stockId, b.enteredBy ? `by ${b.enteredBy}` : ''].filter(Boolean).join(' · '),
        amount: Number(b.totalAmount) || 0,
        direction: 'charge',
      });
    }

    for (const p of payments) {
      if (p.customerId !== cust.id) continue;
      transactions.push({
        kind: 'payment',
        id: p.id,
        date: p.date,
        sortAt: p.createdAt || `${p.date}T12:00:00`,
        type: 'Payment',
        details: [
          paymentSettlementSummary(p),
          p.billNumber ? `Bill #${p.billNumber}` : null,
          p.note,
          p.recordedBy ? `by ${p.recordedBy}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || '—',
        amount: paymentGrossCredit(p),
        direction: 'credit',
      });
      for (const c of getPaymentCheques(p)) {
        if (!c.chequeReturned) continue;
        const returnDate = String(c.chequeReturnedAt ?? '').trim().slice(0, 10) || p.date;
        transactions.push({
          kind: 'cheque_return',
          id: `${p.id}::${c.id}`,
          date: returnDate,
          sortAt: c.chequeReturnedAt || p.createdAt || `${returnDate}T12:00:00`,
          type: 'Returned cheque',
          details: [
            c.chequeNumber ? `#${c.chequeNumber}` : null,
            c.chequeDate ? `converting ${c.chequeDate}` : null,
            c.chequeReturnedBy ? `by ${c.chequeReturnedBy}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Cheque returned',
          amount: Number(c.amount) || 0,
          direction: 'charge',
        });
      }
    }

    for (const promo of promotions) {
      if (promo.customerId !== cust.id) continue;
      const credit = promotionCreditAmount(promo);
      if (credit <= 0) continue;
      const pType = promotionType(promo);
      let typeLabel = 'Promotion';
      if (pType === PROMOTION_TYPES.INVOICE_DISCOUNT) {
        typeLabel = 'Invoice discount';
      } else if (pType === PROMOTION_TYPES.TARGET_PROMOTION) {
        typeLabel = 'Target promotion';
      } else if (pType === PROMOTION_TYPES.RULE_CASHBACK) {
        typeLabel = 'Cashback';
      }
      const details = [
        (pType === PROMOTION_TYPES.INVOICE_DISCOUNT || pType === PROMOTION_TYPES.RULE_CASHBACK) &&
        promo.invoiceNumber
          ? `Invoice ${promo.invoiceNumber}`
          : null,
        promo.reason,
        promo.enteredBy ? `by ${promo.enteredBy}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || '—';
      transactions.push({
        kind: 'promotion',
        id: promo.id,
        date: promo.date,
        sortAt: promo.createdAt || `${promo.date}T12:00:00`,
        type: typeLabel,
        details,
        amount: credit,
        direction: 'credit',
      });
    }

    for (const row of returnsRows) {
      const idMatch = String(row.customerId ?? '').trim() === cust.id;
      const nameMatch = normalizeCustomerName(row.customerName) === nameKey;
      if (!idMatch && !nameMatch) continue;
      const kind = returnKind(row);
      const amount = returnAmount(row);
      if (amount <= 0 && kind !== RETURN_KINDS.DAMAGE) continue;
      if (kind === RETURN_KINDS.ITEM_RETURN) {
        const settle = settlementOf(row);
        transactions.push({
          kind: 'item_return',
          id: row.id,
          date: row.date,
          sortAt: row.createdAt || `${row.date}T12:00:00`,
          type:
            settle === SETTLEMENTS.CASH
              ? 'Item return (cash)'
              : settle === SETTLEMENTS.DAMAGE
                ? 'Damage items'
                : 'Return invoice',
          details: [
            row.invoiceNumber ? `Invoice ${row.invoiceNumber}` : null,
            row.returnInvoiceNumber ? `Return ${row.returnInvoiceNumber}` : null,
            row.damageInvoiceNumber ? `Damage ${row.damageInvoiceNumber}` : null,
            row.note,
            row.enteredBy ? `by ${row.enteredBy}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || '—',
          amount,
          direction: 'credit',
        });
      } else if (kind === RETURN_KINDS.PRICE_CHANGE) {
        const dir = priceDirection(row);
        transactions.push({
          kind: 'price_change',
          id: row.id,
          date: row.date,
          sortAt: row.createdAt || `${row.date}T12:00:00`,
          type: dir === PRICE_DIRECTIONS.UP ? 'Price increase' : 'Price drop',
          details: [row.note, row.enteredBy ? `by ${row.enteredBy}` : null].filter(Boolean).join(' · ') || '—',
          amount,
          direction: dir === PRICE_DIRECTIONS.UP ? 'charge' : 'credit',
        });
      }
    }

    transactions.sort((a, b) => {
      const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCmp !== 0) return dateCmp;
      return new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime();
    });

    res.json({
      customer: enrichCustomerWithCollector(
        enrichCustomerBalance(cust, bills, payments, overdueDates, promotions, returnsRows),
        users,
      ),
      transactions,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    const body = req.body || {};
    const addedBy = String(body.addedBy ?? '').trim();
    if (!addedBy) {
      return res.status(400).json({ error: 'addedBy (username) is required' });
    }

    const name = String(body.name ?? '').trim();
    const location = String(body.location ?? '').trim();
    const contactNumber = String(body.contactNumber ?? '').trim();
    const email = String(body.email ?? '').trim();
    if (!name || !location || !contactNumber) {
      return res.status(400).json({ error: 'name, location, and contactNumber are required' });
    }

    const pastBill = toNonNegMoney(body.pastBill);
    let dueDate = String(body.dueDate ?? '').trim();
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      dueDate = defaultDueDateYmd();
    }

    const customerId = normalizeCustomerRecordId(body.id);
    if (!customerId) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }
    const customerIdNorm = customerRecordIdKey(customerId);

    const customers = await readCustomers();
    if (customers.some((c) => customerRecordIdKey(c.id) === customerIdNorm)) {
      return res.status(400).json({ error: 'A customer with this ID already exists' });
    }

    let collectorUserId = '';
    const collectorRaw = String(body.collectorUserId ?? '').trim();
    if (!collectorRaw) {
      return res.status(400).json({ error: 'Assigned collector is required' });
    }
    const auth = await requireManagerOrAdmin(req, res);
    if (!auth) return;
    const collectorCheck = await validateCollectorUserId(body.collectorUserId);
    if (!collectorCheck.ok) {
      return res.status(400).json({ error: collectorCheck.error });
    }
    collectorUserId = collectorCheck.collectorUserId;

    const ownerName = String(body.ownerName ?? '').trim();
    const ownerBirthday = String(body.ownerBirthday ?? '').trim();
    if (ownerBirthday && !/^\d{4}-\d{2}-\d{2}$/.test(ownerBirthday)) {
      return res.status(400).json({ error: 'ownerBirthday must be YYYY-MM-DD' });
    }

    const row = {
      id: customerId,
      name,
      location,
      contactNumber,
      ...(email ? { email } : {}),
      ...(ownerName ? { ownerName } : {}),
      ...(ownerBirthday ? { ownerBirthday } : {}),
      collectorUserId,
      pastBill,
      remainingAmount: pastBill,
      dueDate,
      addedBy,
      createdAt: new Date().toISOString(),
    };

    customers.push(row);
    await writeCustomers(customers);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save customer' });
  }
});

app.patch('/api/customers/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }

    const hasName = body.name !== undefined;
    const hasLocation = body.location !== undefined;
    const hasContact = body.contactNumber !== undefined;
    const hasEmail = body.email !== undefined;
    const hasOwnerName = body.ownerName !== undefined;
    const hasOwnerBirthday = body.ownerBirthday !== undefined;
    const hasDueDate = body.dueDate !== undefined;
    const hasPastBill = body.pastBill !== undefined;
    const hasOverdueDays = body.overdueDays !== undefined;
    const hasOverdueNotifyEnabled = body.overdueNotifyEnabled !== undefined;
    const hasOverdueNotifyWeekday = body.overdueNotifyWeekday !== undefined;
    const hasOverdueNotifyTime = body.overdueNotifyTime !== undefined;
    const hasMonthlyTargetBags = body.monthlyTargetBags !== undefined;
    const hasCollectorUserId = body.collectorUserId !== undefined;
    const hasTaxInvoicesEnabled = body.taxInvoicesEnabled !== undefined;
    const hasPurchaserTin = body.purchaserTin !== undefined;
    const hasPurchaserTaxName = body.purchaserTaxName !== undefined;
    const hasPurchaserTaxAddress = body.purchaserTaxAddress !== undefined;
    const hasPurchaserTaxPhone = body.purchaserTaxPhone !== undefined;
    const hasPlaceOfSupply = body.placeOfSupply !== undefined;
    const hasTaxAdditionalInfo = body.taxAdditionalInfo !== undefined;
    if (
      !hasName &&
      !hasLocation &&
      !hasContact &&
      !hasEmail &&
      !hasOwnerName &&
      !hasOwnerBirthday &&
      !hasDueDate &&
      !hasPastBill &&
      !hasOverdueDays &&
      !hasOverdueNotifyEnabled &&
      !hasOverdueNotifyWeekday &&
      !hasOverdueNotifyTime &&
      !hasMonthlyTargetBags &&
      !hasCollectorUserId &&
      !hasTaxInvoicesEnabled &&
      !hasPurchaserTin &&
      !hasPurchaserTaxName &&
      !hasPurchaserTaxAddress &&
      !hasPurchaserTaxPhone &&
      !hasPlaceOfSupply &&
      !hasTaxAdditionalInfo
    ) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (hasMonthlyTargetBags || hasCollectorUserId || hasOverdueNotifyEnabled || hasOverdueNotifyWeekday || hasOverdueNotifyTime || hasTaxInvoicesEnabled || hasPurchaserTin || hasPurchaserTaxName || hasPurchaserTaxAddress || hasPurchaserTaxPhone || hasPlaceOfSupply || hasTaxAdditionalInfo) {
      const auth = await requireManagerOrAdmin(req, res);
      if (!auth) return;
    }

    const customers = await readCustomers();
    const idx = customers.findIndex((c) => c.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const cust = customers[idx];
    const oldNameKey = normalizeCustomerName(cust.name);
    let nameChanged = false;

    if (hasName) {
      const name = String(body.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      if (normalizeCustomerName(name) !== oldNameKey) {
        nameChanged = true;
        cust.name = name;
      }
    }
    if (hasLocation) {
      const location = String(body.location ?? '').trim();
      if (!location) return res.status(400).json({ error: 'location cannot be empty' });
      cust.location = location;
    }
    if (hasContact) {
      const contactNumber = String(body.contactNumber ?? '').trim();
      if (!contactNumber) {
        return res.status(400).json({ error: 'contactNumber cannot be empty' });
      }
      cust.contactNumber = contactNumber;
    }
    if (hasEmail) {
      const email = String(body.email ?? '').trim();
      if (email) {
        cust.email = email;
      } else {
        delete cust.email;
      }
    }
    if (hasOwnerName) {
      const ownerName = String(body.ownerName ?? '').trim();
      if (ownerName) {
        cust.ownerName = ownerName;
      } else {
        delete cust.ownerName;
      }
    }
    if (hasOwnerBirthday) {
      const ownerBirthday = String(body.ownerBirthday ?? '').trim();
      if (!ownerBirthday) {
        delete cust.ownerBirthday;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(ownerBirthday)) {
        return res.status(400).json({ error: 'ownerBirthday must be YYYY-MM-DD' });
      } else {
        cust.ownerBirthday = ownerBirthday;
      }
    }
    if (hasDueDate) {
      const dueDate = String(body.dueDate ?? '').trim();
      if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD' });
      }
      cust.dueDate = dueDate;
    }
    if (hasPastBill) {
      const nextPastBill = toNonNegMoney(body.pastBill);
      if (nextPastBill !== toNonNegMoney(cust.pastBill)) {
        cust.pastBill = nextPastBill;
        cust.pastBillUpdatedAt = new Date().toISOString();
        cust.pastBillUpdatedBy = updatedBy;
      }
    }

    let overdueDates = await readOverdueDates();
    if (hasOverdueDays) {
      const nextOverdueDays = normalizeOverdueDays(body.overdueDays);
      if (nextOverdueDays == null) {
        return res.status(400).json({
          error: `overdueDays must be an integer from 1 to 365 (default ${DEFAULT_OVERDUE_DAYS})`,
        });
      }
      overdueDates = await setCustomerOverdueDays(id, nextOverdueDays);
    }

    if (hasOverdueNotifyEnabled) {
      if (body.overdueNotifyEnabled === false) {
        cust.overdueNotifyEnabled = false;
      } else {
        delete cust.overdueNotifyEnabled;
      }
    }
    if (hasOverdueNotifyWeekday) {
      const raw = body.overdueNotifyWeekday;
      if (raw === null || raw === '' || raw === false) {
        delete cust.overdueNotifyWeekday;
      } else {
        const n = parseInt(String(raw), 10);
        if (!Number.isFinite(n) || n < 0 || n > 6) {
          return res.status(400).json({ error: 'overdueNotifyWeekday must be 0–6 (Sunday–Saturday)' });
        }
        cust.overdueNotifyWeekday = n;
      }
    }
    if (hasOverdueNotifyTime) {
      const raw = String(body.overdueNotifyTime ?? '').trim();
      if (!raw) {
        delete cust.overdueNotifyTime;
      } else {
        const t = normalizeTimeHHMM(raw);
        if (!t) {
          return res.status(400).json({ error: 'overdueNotifyTime must be HH:MM (24-hour)' });
        }
        cust.overdueNotifyTime = t;
      }
    }

    if (hasMonthlyTargetBags) {
      const nextTarget = normalizeMonthlyTargetBags(body.monthlyTargetBags);
      if (nextTarget === null) {
        return res.status(400).json({
          error: 'monthlyTargetBags must be a whole number from 0 to 999999 (0 clears the target)',
        });
      }
      if (nextTarget === 0) {
        delete cust.monthlyTargetBags;
      } else {
        cust.monthlyTargetBags = nextTarget;
      }
    }

    if (hasCollectorUserId) {
      const collectorCheck = await validateCollectorUserId(body.collectorUserId);
      if (!collectorCheck.ok) {
        return res.status(400).json({ error: collectorCheck.error });
      }
      if (collectorCheck.collectorUserId) {
        cust.collectorUserId = collectorCheck.collectorUserId;
      } else {
        delete cust.collectorUserId;
      }
    }

    if (hasTaxInvoicesEnabled) {
      if (body.taxInvoicesEnabled === true) {
        cust.taxInvoicesEnabled = true;
      } else {
        delete cust.taxInvoicesEnabled;
      }
    }
    if (hasPurchaserTin) {
      const tin = String(body.purchaserTin ?? '').trim();
      if (tin) {
        cust.purchaserTin = tin;
      } else {
        delete cust.purchaserTin;
      }
    }
    if (hasPurchaserTaxName) {
      const name = String(body.purchaserTaxName ?? '').trim();
      if (name) {
        cust.purchaserTaxName = name;
      } else {
        delete cust.purchaserTaxName;
      }
    }
    if (hasPurchaserTaxAddress) {
      const addr = String(body.purchaserTaxAddress ?? '').trim();
      if (addr) {
        cust.purchaserTaxAddress = addr;
      } else {
        delete cust.purchaserTaxAddress;
      }
    }
    if (hasPurchaserTaxPhone) {
      const phone = String(body.purchaserTaxPhone ?? '').trim();
      if (phone) {
        cust.purchaserTaxPhone = phone;
      } else {
        delete cust.purchaserTaxPhone;
      }
    }
    if (hasPlaceOfSupply) {
      const place = String(body.placeOfSupply ?? '').trim();
      if (place) {
        cust.placeOfSupply = place;
      } else {
        delete cust.placeOfSupply;
      }
    }
    if (hasTaxAdditionalInfo) {
      const info = String(body.taxAdditionalInfo ?? '').trim();
      if (info) {
        cust.taxAdditionalInfo = info;
      } else {
        delete cust.taxAdditionalInfo;
      }
    }

    cust.updatedAt = new Date().toISOString();
    cust.updatedBy = updatedBy;

    let bills = await readBills();
    let payments = await readPayments();
    let billsDirty = false;
    let paymentsDirty = false;
    let promosDirty = false;

    if (nameChanged) {
      const newName = cust.name;
      for (const b of bills) {
        if (normalizeCustomerName(b.customerName) === oldNameKey) {
          b.customerName = newName;
          billsDirty = true;
        }
      }
      for (const p of payments) {
        if (p.customerId === cust.id) {
          p.customerName = newName;
          paymentsDirty = true;
        }
      }
      const promos = await readPromotions();
      for (const pr of promos) {
        if (pr.customerId === cust.id) {
          pr.customerName = newName;
          promosDirty = true;
        }
      }
      if (promosDirty) await writePromotions(promos);
    }

    if (billsDirty) await writeBills(bills);
    if (paymentsDirty) await writePayments(payments);

    const promotions = await readPromotions();
    const returnsRows = await readReturns();
    cust.remainingAmount = computeRemainingAmount(cust, bills, payments, promotions, returnsRows);
    customers[idx] = cust;
    await writeCustomers(customers);

    const users = await readUsers();
    res.json(
      enrichCustomerWithCollector(
        enrichCustomerBalance(cust, bills, payments, overdueDates, promotions, returnsRows),
        users,
      ),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

app.get('/api/collection-day-close', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again' });
  }
  try {
    const staffUser = await resolveStaffUser(auth);
    if (!isCollectorStaff(staffUser)) {
      return res.status(403).json({ error: 'Only collectors can check collection-day close status' });
    }
    const date = normalizeCollectionCloseYmd(req.query.date) || paymentDateDefaultYmd();
    const row = await getCollectionDayClose(staffUser.id, date);
    res.json({
      date,
      closed: Boolean(row),
      closedAt: row?.closedAt || '',
      closedBy: row?.closedBy || '',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load collection-day close status' });
  }
});

app.post('/api/collection-day-close', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again' });
  }
  try {
    const staffUser = await resolveStaffUser(auth);
    if (!isCollectorStaff(staffUser)) {
      return res.status(403).json({ error: 'Only collectors can close collection for a day' });
    }
    const date = normalizeCollectionCloseYmd(req.body?.date) || paymentDateDefaultYmd();
    if (date > paymentDateDefaultYmd()) {
      return res.status(400).json({ error: 'You can only close collection for today or a past day.' });
    }
    const result = await closeCollectionDay({
      collectorUserId: staffUser.id,
      date,
      closedBy: String(staffUser.username || auth.username || '').trim(),
    });
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json({
      date,
      closed: true,
      alreadyClosed: Boolean(result.alreadyClosed),
      closedAt: result.close?.closedAt || '',
      closedBy: result.close?.closedBy || '',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to close collection for this day' });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    const [payments, bills, customers, promotions] = await Promise.all([
      readPayments(),
      readBills(),
      readCustomers(),
      readPromotions(),
    ]);
    let rows = [...payments].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
    rows = await filterRowsForCollector(rows, auth, (p) => p.customerName);
    hydratePaymentReceiptInvoices(rows, payments, bills, customers, promotions);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read payments' });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const body = req.body || {};
    const recordedBy = String(body.recordedBy ?? '').trim();
    if (!recordedBy) {
      return res.status(400).json({ error: 'recordedBy (username) is required' });
    }
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    let cashAmount = toNonNegMoney(body.cashAmount ?? 0);
    const parsedCheques = parseChequesFromBody(body);
    if (parsedCheques.error) {
      return res.status(400).json({ error: parsedCheques.error });
    }
    let chequeAmount = sumChequeAmounts(
      parsedCheques.cheques.map((c) => ({ amount: c.amount })),
    );
    const parsedOtherRaw = parseOtherPaymentMethodsFromBody(body);
    if (parsedOtherRaw.error) {
      return res.status(400).json({ error: parsedOtherRaw.error });
    }
    const shopForBanks = await readShopData();
    const parsedOther = resolveOtherMethodBankAccounts(parsedOtherRaw, shopForBanks.bankAccounts || []);
    if (parsedOther.error) {
      return res.status(400).json({ error: parsedOther.error });
    }
    if (cashAmount === 0 && chequeAmount === 0 && parsedOther.cdmAmount === 0 && parsedOther.onlineTransferAmount === 0 && body.amount != null) {
      cashAmount = toNonNegMoney(body.amount);
    }
    const amount = Math.round(
      (cashAmount + chequeAmount + parsedOther.cdmAmount + parsedOther.onlineTransferAmount) * 100,
    ) / 100;
    if (amount <= 0) {
      return res.status(400).json({
        error: 'Enter a cash, cheque, CDM deposit, and/or online transfer amount so the total is greater than 0.',
      });
    }

    const dated = await resolveRecordDate(req, body.date);
    const date = dated.date;
    const closedErr = await collectorCannotAddPaymentError(req, date);
    if (closedErr) {
      return res.status(403).json({ error: closedErr });
    }
    const note = String(body.note ?? '').trim();

    const payments = await readPayments();
    const normalizedReceipt = normalizePaymentBillNumber(body.billNumber);
    let billNumber;
    if (normalizedReceipt) {
      billNumber = normalizedReceipt;
      if (isPaymentBillNumberTaken(payments, billNumber)) {
        return res.status(400).json({ error: 'This payment receipt number is already used.' });
      }
    } else if (body.billNumber != null && String(body.billNumber).trim() !== '') {
      return res.status(400).json({
        error: 'Payment receipt # must use letters and/or numbers (up to 40 characters).',
      });
    } else {
      billNumber = allocatePaymentReceiptNumber(payments, null);
    }

    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(400).json({ error: 'Customer not found' });
    }

    const parsedApplied = parseAppliedBillIdsFromBody(body);
    if (parsedApplied.error) {
      return res.status(400).json({ error: parsedApplied.error });
    }
    const parsedBillCash = parseBillCashAllocationsFromBody(body);
    if (parsedBillCash.error) {
      return res.status(400).json({ error: parsedBillCash.error });
    }
    const billsList = await readBills();
    const appliedErr = validateAppliedBillIdsForCustomer(billsList, cust, parsedApplied.ids);
    if (appliedErr) {
      return res.status(400).json({ error: appliedErr });
    }
    const billCashErr = validateBillCashAllocationsForCustomer(
      billsList,
      cust,
      parsedBillCash.allocations,
      payments,
    );
    if (billCashErr) {
      return res.status(400).json({ error: billCashErr });
    }
    let finalCashAmount = cashAmount;
    let finalChequeAmount = chequeAmount;
    if (parsedBillCash.allocations.length > 0) {
      const allocationTotal = Math.round(
        parsedBillCash.allocations.reduce((s, a) => s + a.cashAmount, 0) * 100,
      ) / 100;
      if (Math.abs(allocationTotal - amount) > 0.009) {
        return res.status(400).json({ error: 'Total payment must equal the sum of per-bill amounts.' });
      }
    }
    const finalAmount = Math.round(
      (finalCashAmount + finalChequeAmount + parsedOther.cdmAmount + parsedOther.onlineTransferAmount) * 100,
    ) / 100;
    if (finalAmount <= 0) {
      return res.status(400).json({
        error: 'Enter a cash, cheque, CDM deposit, and/or online transfer amount so the total is greater than 0.',
      });
    }

    const storedCheques = buildChequesForStorage(parsedCheques.cheques);
    const row = {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      customerId: cust.id,
      customerName: cust.name,
      billNumber,
      amount: finalAmount,
      cashAmount: finalCashAmount,
      note,
      recordedBy,
      createdAt: new Date().toISOString(),
    };
    if (storedCheques.length > 0) {
      row.cheques = storedCheques;
    }
    applyLegacyChequeFields(row, storedCheques);
    attachOtherPaymentMethodsToRow(row, parsedOther);
    attachApprovalMetaToRow(row, parsedOther);
    if (parsedBillCash.allocations.length > 0) {
      attachBillCashAllocationsToPaymentRow(row, billsList, parsedBillCash.allocations, cust);
    } else {
      attachAppliedBillsToPaymentRow(row, billsList, parsedApplied.ids, cust);
    }

    payments.push(row);
    const promotions = await readPromotions();
    attachAffectedInvoicesToPaymentRow(row, billsList, cust, payments, promotions);
    cust.remainingAmount = computeRemainingAmount(cust, billsList, payments, promotions);
    await writeCustomers(customers);
    await writePayments(payments);
    const pendingApproval = isPaymentApprovalPending(row);
    if (!pendingApproval && cust.email) {
      notifyPaymentEmail(cust, row, cust.remainingAmount).catch((err) =>
        console.error('payment email notification', err),
      );
    }
    if (!pendingApproval && cust.contactNumber) {
      notifyPaymentWhatsApp(cust, row, cust.remainingAmount).catch((err) =>
        console.error('payment whatsapp notification', err),
      );
    }
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save payment' });
  }
});

app.patch('/api/payments/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Payment id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.recordedBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    let cashAmount = toNonNegMoney(body.cashAmount ?? 0);
    const parsedCheques = parseChequesFromBody(body);
    if (parsedCheques.error) {
      return res.status(400).json({ error: parsedCheques.error });
    }
    let chequeAmount = sumChequeAmounts(
      parsedCheques.cheques.map((c) => ({ amount: c.amount })),
    );
    const parsedOtherRaw = parseOtherPaymentMethodsFromBody(body);
    if (parsedOtherRaw.error) {
      return res.status(400).json({ error: parsedOtherRaw.error });
    }
    const shopForBanks = await readShopData();
    const parsedOther = resolveOtherMethodBankAccounts(parsedOtherRaw, shopForBanks.bankAccounts || []);
    if (parsedOther.error) {
      return res.status(400).json({ error: parsedOther.error });
    }
    if (cashAmount === 0 && chequeAmount === 0 && parsedOther.cdmAmount === 0 && parsedOther.onlineTransferAmount === 0 && body.amount != null) {
      cashAmount = toNonNegMoney(body.amount);
    }
    const amount = Math.round(
      (cashAmount + chequeAmount + parsedOther.cdmAmount + parsedOther.onlineTransferAmount) * 100,
    ) / 100;
    if (amount <= 0) {
      return res.status(400).json({
        error: 'Enter a cash, cheque, CDM deposit, and/or online transfer amount so the total is greater than 0.',
      });
    }

    let date = String(body.date ?? '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const note = String(body.note ?? '').trim();

    const billNumber = normalizePaymentBillNumber(body.billNumber);
    if (!billNumber) {
      return res.status(400).json({
        error: 'Payment receipt # is required (letters and/or numbers, up to 40 characters).',
      });
    }

    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(400).json({ error: 'Customer not found' });
    }

    const payments = await readPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    if (isPaymentBillNumberTaken(payments, billNumber, id)) {
      return res.status(400).json({ error: 'This payment receipt number is already used.' });
    }

    const parsedApplied = parseAppliedBillIdsFromBody(body);
    if (parsedApplied.error) {
      return res.status(400).json({ error: parsedApplied.error });
    }
    const parsedBillCash = parseBillCashAllocationsFromBody(body);
    if (parsedBillCash.error) {
      return res.status(400).json({ error: parsedBillCash.error });
    }
    const billsList = await readBills();
    const appliedErr = validateAppliedBillIdsForCustomer(billsList, cust, parsedApplied.ids);
    if (appliedErr) {
      return res.status(400).json({ error: appliedErr });
    }
    const billCashErr = validateBillCashAllocationsForCustomer(
      billsList,
      cust,
      parsedBillCash.allocations,
      payments.filter((p) => p.id !== id),
    );
    if (billCashErr) {
      return res.status(400).json({ error: billCashErr });
    }
    let finalCashAmount = cashAmount;
    let finalChequeAmount = chequeAmount;
    if (parsedBillCash.allocations.length > 0) {
      const allocationTotal = Math.round(
        parsedBillCash.allocations.reduce((s, a) => s + a.cashAmount, 0) * 100,
      ) / 100;
      if (Math.abs(allocationTotal - amount) > 0.009) {
        return res.status(400).json({ error: 'Total payment must equal the sum of per-bill amounts.' });
      }
    }
    const finalAmount = Math.round(
      (finalCashAmount + finalChequeAmount + parsedOther.cdmAmount + parsedOther.onlineTransferAmount) * 100,
    ) / 100;
    if (finalAmount <= 0) {
      return res.status(400).json({
        error: 'Enter a cash, cheque, CDM deposit, and/or online transfer amount so the total is greater than 0.',
      });
    }

    const existing = payments[idx];
    const auth = getAuthFromRequest(req);
    const staffUser = await resolveStaffUser(auth);
    if (staffMustUseTodayRecordDate(staffUser)) {
      date = existing.date;
    }
    const chequeUpdate = buildChequesForUpdate(parsedCheques.cheques, existing);
    if (chequeUpdate.error) {
      return res.status(400).json({ error: chequeUpdate.error });
    }
    const storedCheques = chequeUpdate.cheques;

    const row = {
      ...existing,
      date,
      customerId: cust.id,
      customerName: cust.name,
      billNumber,
      amount: finalAmount,
      cashAmount: finalCashAmount,
      note,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };
    if (storedCheques.length > 0) {
      row.cheques = storedCheques;
    } else {
      delete row.cheques;
    }
    applyLegacyChequeFields(row, storedCheques);
    attachOtherPaymentMethodsToRow(row, parsedOther);
    attachApprovalMetaToRow(row, parsedOther, existing);
    if (parsedBillCash.allocations.length > 0) {
      attachBillCashAllocationsToPaymentRow(row, billsList, parsedBillCash.allocations, cust);
    } else {
      attachAppliedBillsToPaymentRow(row, billsList, parsedApplied.ids, cust);
    }

    payments[idx] = row;
    const promotions = await readPromotions();
    attachAffectedInvoicesToPaymentRow(row, billsList, cust, payments, promotions);
    await writePayments(payments);

    await refreshCustomerBalancesForCustomerIds(
      billsList,
      payments,
      existing.customerId,
      cust.id,
    );

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

/** Cheques (by cheque date) not yet marked as deposited to the bank — default `date` is today (server local). */
app.get('/api/cheque-deposit-queue', async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    const fromDate = String(req.query.date ?? '').trim() || paymentDateDefaultYmd();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    const daysRaw = req.query.days != null ? Number(req.query.days) : 1;
    const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 31 ? Math.floor(daysRaw) : 1;
    const throughDate = addDaysToYmd(fromDate, days - 1);
    if (!throughDate) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    const payments = await readPayments();
    const items = [];
    for (const p of payments) {
      for (const cheque of getPaymentCheques(p)) {
        if (cheque.chequeDeposited || cheque.chequeReturned) continue;
        const cd = String(cheque.chequeDate ?? '').slice(0, 10);
        if (!cd || cd < fromDate || cd > throughDate) continue;
        items.push(chequeDepositQueueItem(p, cheque));
      }
    }
    const sorted = [...items].sort((a, b) => {
      const dateCmp = String(a.chequeDate || '').localeCompare(String(b.chequeDate || ''));
      if (dateCmp !== 0) return dateCmp;
      const t = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      if (t !== 0) return t;
      const idCmp = String(b.id).localeCompare(String(a.id));
      if (idCmp !== 0) return idCmp;
      return String(a.chequeId || '').localeCompare(String(b.chequeId || ''));
    });
    const filtered = await filterRowsForCollector(sorted, auth, (row) => row.customerName);
    res.json({ asOfDate: fromDate, throughDate, days, items: filtered });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load cheque deposit queue' });
  }
});

app.patch('/api/payments/:id/cheque-deposited', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Payment id is required' });
    }
    const body = req.body || {};
    const recordedBy = String(body.recordedBy ?? '').trim();
    if (!recordedBy) {
      return res.status(400).json({ error: 'recordedBy (username) is required' });
    }
    const payments = await readPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const chequeId = String(body.chequeId ?? '').trim();
    let bankAccountId = String(body.bankAccountId ?? '').trim();
    let bankAccount = null;
    if (bankAccountId) {
      const shop = await readShopData();
      const acct = (shop.bankAccounts || []).find((a) => a.id === bankAccountId);
      if (!acct) {
        return res.status(400).json({ error: 'Invalid bank account' });
      }
      bankAccount = bankAccountSnapshot(acct);
    }
    const depositedAt = new Date().toISOString();
    const note = String(body.note ?? body.description ?? '').trim();
    const result = markChequeDepositedOnPayment(payments[idx], {
      chequeId,
      recordedBy,
      depositedAt,
      bankAccountId: bankAccountId || undefined,
      bankAccount: bankAccount || undefined,
      note: note || undefined,
    });
    if (result.error) {
      const status = result.error.includes('not found') ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    payments[idx] = result.payment;
    await writePayments(payments);
    res.json(result.payment);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

app.patch('/api/payments/:id/cheque-returned', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Payment id is required' });
    }
    const body = req.body || {};
    const recordedBy = String(body.recordedBy ?? '').trim();
    if (!recordedBy) {
      return res.status(400).json({ error: 'recordedBy (username) is required' });
    }
    const payments = await readPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const chequeId = String(body.chequeId ?? '').trim();
    let returnedAt = String(body.returnedAt ?? body.date ?? '').trim();
    if (returnedAt && /^\d{4}-\d{2}-\d{2}$/.test(returnedAt)) {
      returnedAt = `${returnedAt}T12:00:00.000Z`;
    } else {
      returnedAt = new Date().toISOString();
    }
    const note = String(body.note ?? body.description ?? '').trim();
    const result = markChequeReturnedOnPayment(payments[idx], {
      chequeId,
      recordedBy,
      returnedAt,
      note: note || undefined,
    });
    if (result.error) {
      const status = result.error.includes('not found') ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    payments[idx] = result.payment;
    await writePayments(payments);

    const customers = await readCustomers();
    const bills = await readBills();
    const promotions = await readPromotions();
    const cust = customers.find((c) => c.id === result.payment.customerId);
    if (cust) {
      cust.remainingAmount = computeRemainingAmount(cust, bills, payments, promotions);
      const custIdx = customers.findIndex((c) => c.id === cust.id);
      if (custIdx >= 0) {
        customers[custIdx] = { ...customers[custIdx], remainingAmount: cust.remainingAmount };
        await writeCustomers(customers);
      }
      if (cust.contactNumber && result.cheque) {
        notifyChequeReturnWhatsApp(cust, {
          payment: result.payment,
          cheque: result.cheque,
          remainingAmount: cust.remainingAmount,
        }).catch((err) => console.error('cheque return whatsapp notification', err));
      }
    }

    res.json(result.payment);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to mark cheque as returned' });
  }
});

/** Mark multiple cheques as deposited to one shop bank account. */
app.post('/api/cheque-deposits', async (req, res) => {
  try {
    const body = req.body || {};
    const recordedBy = String(body.recordedBy ?? '').trim();
    if (!recordedBy) {
      return res.status(400).json({ error: 'recordedBy (username) is required' });
    }
    const bankAccountId = String(body.bankAccountId ?? '').trim();
    if (!bankAccountId) {
      return res.status(400).json({ error: 'bankAccountId is required' });
    }
    const shop = await readShopData();
    const acct = (shop.bankAccounts || []).find((a) => a.id === bankAccountId);
    if (!acct) {
      return res.status(400).json({ error: 'Invalid bank account' });
    }
    const bankAccount = bankAccountSnapshot(acct);
    const rawList = Array.isArray(body.cheques) ? body.cheques : [];
    if (rawList.length === 0) {
      return res.status(400).json({ error: 'Select at least one cheque to deposit' });
    }
    let date = String(body.date ?? '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = paymentDateDefaultYmd();
    const depositedAt = `${date}T12:00:00.000Z`;
    const note = String(body.description ?? body.note ?? '').trim();

    const targets = [];
    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i] || {};
      const cashBookEntryId = String(item.cashBookEntryId ?? '').trim();
      const paymentId = String(item.paymentId ?? item.id ?? '').trim();
      if (cashBookEntryId) {
        targets.push({ type: 'company', cashBookEntryId });
        continue;
      }
      if (!paymentId) {
        return res.status(400).json({ error: `Cheque ${i + 1}: payment or cash book entry id is required` });
      }
      targets.push({
        type: 'customer',
        paymentId,
        chequeId: String(item.chequeId ?? '').trim(),
      });
    }

    const payments = await readPayments();
    const cashBookEntries = await readCashBookEntries();
    const paymentById = new Map(payments.map((p, i) => [p.id, i]));
    const cashBookById = new Map(cashBookEntries.map((e, i) => [e.id, i]));
    const updatedPaymentIds = new Set();
    const updatedCashBookIds = new Set();

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (target.type === 'company') {
        const idx = cashBookById.get(target.cashBookEntryId);
        if (idx === undefined) {
          return res.status(404).json({ error: `Incoming cheque not found (${i + 1})` });
        }
        const current = cashBookEntries[idx];
        const result = markCompanyChequeDeposited(current, {
          recordedBy,
          depositedAt,
          bankAccountId,
          bankAccount,
          note: note || undefined,
        });
        if (result.error) {
          return res.status(400).json({ error: `${result.error} (cheque ${i + 1})` });
        }
        cashBookEntries[idx] = result.entry;
        updatedCashBookIds.add(target.cashBookEntryId);
        continue;
      }

      const { paymentId, chequeId } = target;
      const idx = paymentById.get(paymentId);
      if (idx === undefined) {
        return res.status(404).json({ error: `Payment not found for cheque ${i + 1}` });
      }
      const current = payments[idx];
      const result = markChequeDepositedOnPayment(current, {
        chequeId,
        recordedBy,
        depositedAt,
        bankAccountId,
        bankAccount,
        note: note || undefined,
      });
      if (result.error) {
        return res.status(400).json({ error: `${result.error} (cheque ${i + 1})` });
      }
      payments[idx] = result.payment;
      updatedPaymentIds.add(paymentId);
    }

    if (updatedPaymentIds.size > 0) {
      await writePayments(payments);
    }
    if (updatedCashBookIds.size > 0) {
      await writeCashBookEntries(cashBookEntries);
    }
    res.status(201).json({
      date,
      bankAccountId,
      bankAccount,
      count: targets.length,
      paymentIds: [...updatedPaymentIds],
      cashBookEntryIds: [...updatedCashBookIds],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to record cheque deposits' });
  }
});

/** Promotions: free bags (stock), invoice discount, or target promotion (ledger + cashier). */
function parsePromotionType(body) {
  const t = String(body?.type ?? '').trim();
  if (t === PROMOTION_TYPES.INVOICE_DISCOUNT || t === PROMOTION_TYPES.TARGET_PROMOTION) return t;
  return PROMOTION_TYPES.FREE_BAGS;
}

async function validatePromotionCustomer(body) {
  const customerId = String(body.customerId ?? '').trim();
  if (!customerId) {
    return { ok: false, error: 'customerId is required' };
  }
  let date = String(body.date ?? '').trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'date must be YYYY-MM-DD' };
  }
  const reason = String(body.reason ?? '').trim();
  if (!reason) {
    return { ok: false, error: 'reason is required' };
  }
  const customers = await readCustomers();
  const cust = customers.find((c) => c.id === customerId);
  if (!cust) {
    return { ok: false, error: 'Customer not found' };
  }
  return { ok: true, customerId, date, reason, cust };
}

async function buildFreeBagPromotionRow(body, meta = {}) {
  let billNumber = '';
  if (body.billNumber != null && String(body.billNumber).trim() !== '') {
    const norm = normalizePaymentBillNumber(body.billNumber);
    if (!norm) {
      return { ok: false, error: 'billNumber must be 1–3 digits when provided' };
    }
    billNumber = norm;
  }
  const { fields, products } = await parseProductBagFields(body);
  const bagSum = sumBagFields(fields, products);
  if (bagSum <= 0) {
    return { ok: false, error: 'Enter at least one free bag (any product).' };
  }
  const stocks = await readStocks();
  const bills = await readBills();
  const promos = await readPromotions();
  const pendingUnloads = await readUnloads();
  const check = await validateBillAgainstPooledStock(
    stocks,
    bills,
    promos,
    fields,
    pendingUnloads,
    null,
    products,
    meta.excludePromotionId || null,
    'promotion',
  );
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  return {
    ok: true,
    row: {
      type: PROMOTION_TYPES.FREE_BAGS,
      billNumber,
      ...fields,
    },
    cust: meta.cust,
  };
}

async function buildInvoiceDiscountPromotionRow(body, meta = {}) {
  const billId = String(body.billId ?? '').trim();
  if (!billId) {
    return { ok: false, error: 'Select an invoice (bill) for the discount.' };
  }
  const discountMode = String(body.discountMode ?? '').trim();
  if (discountMode !== 'per_bag' && discountMode !== 'whole_invoice') {
    return { ok: false, error: 'discountMode must be per_bag or whole_invoice' };
  }
  const discountValue = toNonNegMoney(body.discountValue);
  if (discountValue <= 0) {
    return { ok: false, error: 'Enter a discount amount greater than zero.' };
  }
  const bills = await readBills();
  const bill = bills.find((b) => b.id === billId);
  if (!bill) {
    return { ok: false, error: 'Selected invoice not found' };
  }
  if (normalizeCustomerName(bill.customerName) !== normalizeCustomerName(meta.cust.name)) {
    return { ok: false, error: 'Selected invoice does not belong to this customer.' };
  }
  const products = await getBagProducts();
  const discountAmount = computeInvoiceDiscountAmount(bill, discountMode, discountValue, products);
  if (discountAmount <= 0) {
    return { ok: false, error: 'Discount amount must be greater than zero.' };
  }
  return {
    ok: true,
    row: {
      type: PROMOTION_TYPES.INVOICE_DISCOUNT,
      billId,
      invoiceNumber: normalizeBillInvoiceNumber(bill.invoiceNumber) || '',
      discountMode,
      discountValue,
      discountAmount,
    },
  };
}

async function buildTargetPromotionRow(body) {
  const discountAmount = toNonNegMoney(body.discountAmount ?? body.amount);
  if (discountAmount <= 0) {
    return { ok: false, error: 'Enter a promotion amount greater than zero.' };
  }
  return {
    ok: true,
    row: {
      type: PROMOTION_TYPES.TARGET_PROMOTION,
      discountAmount,
    },
  };
}

async function buildPromotionPayload(body, meta = {}) {
  const base = await validatePromotionCustomer(body);
  if (!base.ok) return base;
  const type = parsePromotionType(body);
  let built;
  if (type === PROMOTION_TYPES.INVOICE_DISCOUNT) {
    built = await buildInvoiceDiscountPromotionRow(body, { ...meta, cust: base.cust });
  } else if (type === PROMOTION_TYPES.TARGET_PROMOTION) {
    built = await buildTargetPromotionRow(body);
  } else {
    built = await buildFreeBagPromotionRow(body, { ...meta, cust: base.cust });
  }
  if (!built.ok) return built;
  return {
    ok: true,
    type,
    cust: base.cust,
    row: {
      date: base.date,
      customerId: base.cust.id,
      customerName: base.cust.name,
      reason: base.reason,
      ...built.row,
    },
  };
}

app.get('/api/promotions', async (req, res) => {
  try {
    const rows = await readPromotions();
    const sorted = [...rows].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read promotions' });
  }
});

app.post('/api/promotions', async (req, res) => {
  try {
    const body = req.body || {};
    const enteredBy = String(body.enteredBy ?? '').trim();
    if (!enteredBy) {
      return res.status(400).json({ error: 'enteredBy (username) is required' });
    }

    const built = await buildPromotionPayload(body);
    if (!built.ok) {
      return res.status(400).json({ error: built.error });
    }

    const row = {
      id: `promo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...built.row,
      enteredBy,
      createdAt: new Date().toISOString(),
    };

    const promos = await readPromotions();
    promos.push(row);
    await writePromotions(promos);

    if (isFreeBagPromotion(row)) {
      try {
        await refreshLiveStockFromSources();
      } catch (err) {
        console.error('liveStock refresh after promotion', err);
      }
    }

    if (promotionCreditAmount(row) > 0) {
      const [bills, payments] = await Promise.all([readBills(), readPayments()]);
      await refreshCustomerBalancesForCustomerIds(bills, payments, row.customerId);
    }

    const cust = built.cust;
    if (isFreeBagPromotion(row)) {
      if (cust.email) {
        notifyPromotionEmail(cust, row).catch((err) =>
          console.error('promotion email notification', err),
        );
      }
      if (cust.contactNumber) {
        notifyPromotionWhatsApp(cust, row).catch((err) =>
          console.error('promotion whatsapp notification', err),
        );
      }
    }

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save promotion' });
  }
});

app.patch('/api/promotions/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Promotion id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.enteredBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }

    const promos = await readPromotions();
    const idx = promos.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    const existing = promos[idx];
    const type = parsePromotionType({ type: body.type ?? existing.type });
    body.type = type;

    const built = await buildPromotionPayload(body, { excludePromotionId: id });
    if (!built.ok) {
      return res.status(400).json({ error: built.error });
    }

    const row = {
      ...existing,
      ...built.row,
      type,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };

    promos[idx] = row;
    await writePromotions(promos);

    if (isFreeBagPromotion(row) || isFreeBagPromotion(existing)) {
      try {
        await refreshLiveStockFromSources();
      } catch (err) {
        console.error('liveStock refresh after promotion update', err);
      }
    }

    const balanceCustomerIds = new Set([existing.customerId, row.customerId].filter(Boolean));
    if (balanceCustomerIds.size > 0) {
      const [bills, payments] = await Promise.all([readBills(), readPayments()]);
      await refreshCustomerBalancesForCustomerIds(bills, payments, ...balanceCustomerIds);
    }

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update promotion' });
  }
});

app.delete('/api/promotions/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Promotion id is required' });
    }
    const promos = await readPromotions();
    const idx = promos.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Promotion not found' });
    }
    const removed = promos[idx];
    promos.splice(idx, 1);
    await writePromotions(promos);

    if (isFreeBagPromotion(removed)) {
      try {
        await refreshLiveStockFromSources();
      } catch (err) {
        console.error('liveStock refresh after promotion delete', err);
      }
    }

    if (promotionCreditAmount(removed) > 0 && removed.customerId) {
      const [bills, payments] = await Promise.all([readBills(), readPayments()]);
      await refreshCustomerBalancesForCustomerIds(bills, payments, removed.customerId);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete promotion' });
  }
});

/** Promotion rules: per-customer cashback amounts by product for a date range. */
async function resolvePromotionRuleCustomer(body) {
  const customerId = String(body.customerId ?? '').trim();
  if (!customerId) {
    return { ok: false, error: 'customerId is required' };
  }
  const customers = await readCustomers();
  const cust = customers.find((c) => c.id === customerId);
  if (!cust) {
    return { ok: false, error: 'Customer not found' };
  }
  return { ok: true, cust };
}

app.get('/api/promotion-rules', async (req, res) => {
  try {
    const rows = await readPromotionRules();
    const sorted = [...rows].sort((a, b) => {
      const sa = String(a.startDate || '');
      const sb = String(b.startDate || '');
      if (sa !== sb) return sb.localeCompare(sa);
      const ea = String(a.endDate || '');
      const eb = String(b.endDate || '');
      if (ea !== eb) return eb.localeCompare(ea);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read promotion rules' });
  }
});

app.post('/api/promotion-rules', async (req, res) => {
  try {
    const body = req.body || {};
    const enteredBy = String(body.enteredBy ?? '').trim();
    if (!enteredBy) {
      return res.status(400).json({ error: 'enteredBy (username) is required' });
    }
    const customer = await resolvePromotionRuleCustomer(body);
    if (!customer.ok) {
      return res.status(400).json({ error: customer.error });
    }
    const products = await getBagProducts();
    const built = buildPromotionRuleRow(body, { customer: customer.cust, products });
    if (!built.ok) {
      return res.status(400).json({ error: built.error });
    }
    const row = {
      id: `prule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...built.row,
      enteredBy,
      createdAt: new Date().toISOString(),
    };
    const rules = await readPromotionRules();
    rules.push(row);
    await writePromotionRules(rules);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save promotion rule' });
  }
});

app.patch('/api/promotion-rules/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Promotion rule id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.enteredBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }
    const rules = await readPromotionRules();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Promotion rule not found' });
    }
    const customer = await resolvePromotionRuleCustomer(body);
    if (!customer.ok) {
      return res.status(400).json({ error: customer.error });
    }
    const products = await getBagProducts();
    const built = buildPromotionRuleRow(body, { customer: customer.cust, products });
    if (!built.ok) {
      return res.status(400).json({ error: built.error });
    }
    const row = {
      ...rules[idx],
      ...built.row,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };
    rules[idx] = row;
    await writePromotionRules(rules);
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update promotion rule' });
  }
});

app.delete('/api/promotion-rules/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Promotion rule id is required' });
    }
    const rules = await readPromotionRules();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Promotion rule not found' });
    }
    rules.splice(idx, 1);
    await writePromotionRules(rules);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete promotion rule' });
  }
});

app.get('/api/activity', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 5));
    const [loads, bills, customers, payments] = await Promise.all([
      readStocks(),
      readBills(),
      readCustomers(),
      readPayments(),
    ]);

    const items = [];

    for (const r of loads) {
      items.push({
        kind: 'load',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: r.stockId || 'Stock load',
        subtitle: [r.vehicleNumber, r.date, r.addedBy].filter(Boolean).join(' · '),
        amount: Number(r.totalAmount) || 0,
      });
    }
    for (const r of bills) {
      items.push({
        kind: 'bill',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: `Bill · ${r.customerName || 'Customer'}`,
        subtitle: [r.stockId, r.date, r.enteredBy].filter(Boolean).join(' · '),
        amount: Number(r.totalAmount) || 0,
      });
    }
    for (const r of customers) {
      items.push({
        kind: 'customer',
        id: r.id,
        at: r.createdAt || `${r.dueDate}T12:00:00`,
        title: `Customer · ${r.name}`,
        subtitle: [r.location, r.addedBy].filter(Boolean).join(' · '),
        amount: Number(r.pastBill) || 0,
      });
    }
    for (const r of payments) {
      items.push({
        kind: 'payment',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: `Payment · ${r.customerName}`,
        subtitle: [r.billNumber ? `#${r.billNumber}` : null, r.date, r.recordedBy, r.note]
          .filter(Boolean)
          .join(' · '),
        amount: paymentCreditToCustomer(r),
      });
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(items.slice(0, limit));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

app.get('/api/bills', async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    const bills = await readBills();
    if (ensureBillInvoiceNumbers(bills)) {
      await writeBills(bills);
    }
    let sorted = [...bills].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    sorted = await filterRowsForCollector(sorted, auth, (row) => row.customerName);
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read bills' });
  }
});

app.post('/api/bills', async (req, res) => {
  try {
    const body = req.body || {};
    const enteredBy = String(body.enteredBy ?? body.addedBy ?? '').trim();
    if (!enteredBy) {
      return res.status(400).json({ error: 'enteredBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const customerName = String(body.customerName ?? '').trim();
    if (!date || !customerName) {
      return res.status(400).json({ error: 'date and customerName are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const { fields, products } = await parseBillBagFields(body);
    const parsedInvoice = parseBillInvoiceNumber(body);
    if (parsedInvoice.error) {
      return res.status(400).json({ error: parsedInvoice.error });
    }
    const stockIdFromBody = String(body.stockId ?? '').trim();
    const stocks = await readStocks();
    const bills = await readBills();
    if (billInvoiceNumberTaken(bills, parsedInvoice.invoiceNumber)) {
      return res.status(400).json({ error: 'This invoice # is already used on another bill.' });
    }
    const keys = products.map((p) => p.key);
    const stockId = stockIdFromBody || inferStockIdForBillBags(stocks, bills, fields, keys);
    const note = String(body.note ?? '').trim();

    const row = {
      id: `bill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      customerName,
      stockId,
      invoiceNumber: parsedInvoice.invoiceNumber,
      ...fields,
      note,
      enteredBy,
      createdAt: new Date().toISOString(),
    };

    const promotions = await readPromotions();
    const pendingUnloads = await readUnloads();
    const check = await validateBillAgainstPooledStock(
      stocks,
      bills,
      promotions,
      fields,
      pendingUnloads,
      null,
      products,
    );
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    bills.push(row);
    await writeBills(bills);

    await syncBillRuleCashback(row, { enteredBy, products, promotions });

    const paymentsList = await readPayments();
    await refreshCustomerBalancesForBillNames(bills, paymentsList, customerName);

    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after bill', err);
    }

    const customersForEmail = await readCustomers();
    const custForEmail = customersForEmail.find(
      (c) => normalizeCustomerName(c.name) === normalizeCustomerName(customerName),
    );
    if (custForEmail?.email) {
      notifyBillEmail(custForEmail, row, custForEmail.remainingAmount).catch((err) =>
        console.error('bill email notification', err),
      );
    }
    if (custForEmail?.contactNumber) {
      notifyBillWhatsApp(custForEmail, row, custForEmail.remainingAmount).catch((err) =>
        console.error('bill whatsapp notification', err),
      );
    }

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save bill' });
  }
});

app.patch('/api/bills/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Bill id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.enteredBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const customerName = String(body.customerName ?? '').trim();
    if (!date || !customerName) {
      return res.status(400).json({ error: 'date and customerName are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const bills = await readBills();
    const idx = bills.findIndex((b) => b.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const existing = bills[idx];
    const { fields, products } = await parseBillBagFields(body);
    const parsedInvoice = parseBillInvoiceNumber(body);
    if (parsedInvoice.error) {
      return res.status(400).json({ error: parsedInvoice.error });
    }
    if (billInvoiceNumberTaken(bills, parsedInvoice.invoiceNumber, id)) {
      return res.status(400).json({ error: 'This invoice # is already used on another bill.' });
    }
    const stocks = await readStocks();
    const promotions = await readPromotions();
    const pendingUnloads = await readUnloads();
    const otherBills = bills.filter((b) => b.id !== id);
    const check = await validateBillAgainstPooledStock(
      stocks,
      otherBills,
      promotions,
      fields,
      pendingUnloads,
      null,
      products,
    );
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    const row = {
      ...existing,
      date,
      customerName,
      invoiceNumber: parsedInvoice.invoiceNumber,
      ...fields,
      note: String(body.note ?? '').trim(),
      updatedBy,
      updatedAt: new Date().toISOString(),
    };
    bills[idx] = row;
    await writeBills(bills);

    await syncBillRuleCashback(row, { enteredBy: updatedBy, products, promotions });

    const paymentsList = await readPayments();
    await refreshCustomerBalancesForBillNames(
      bills,
      paymentsList,
      existing.customerName,
      customerName,
    );

    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after bill update', err);
    }

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update bill' });
  }
});

app.get('/api/returns', async (req, res) => {
  try {
    const rows = await readReturns();
    const sorted = [...rows].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load returns' });
  }
});

function requireAdminUser(req, res, message) {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: message || 'Sign in as admin to continue' });
    return null;
  }
  if (auth.role !== 'admin') {
    res.status(403).json({ error: message || 'Only an admin can do this' });
    return null;
  }
  return auth;
}

app.post('/api/returns', async (req, res) => {
  try {
    const body = req.body || {};
    const enteredBy = String(body.enteredBy ?? '').trim();
    if (!enteredBy) {
      return res.status(400).json({ error: 'enteredBy (username) is required' });
    }
    const date = String(body.date ?? '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const kindRaw = String(body.kind ?? '').trim();
    const kind =
      kindRaw === RETURN_KINDS.DAMAGE || kindRaw === RETURN_KINDS.PRICE_CHANGE
        ? kindRaw
        : RETURN_KINDS.ITEM_RETURN;
    if (kind === RETURN_KINDS.DAMAGE || kind === RETURN_KINDS.PRICE_CHANGE) {
      const admin = requireAdminUser(req, res, 'Only an admin can record damage items or price changes');
      if (!admin) return;
    }

    const note = String(body.note ?? '').trim();
    const customers = await readCustomers();
    const customerId = String(body.customerId ?? '').trim();
    const customer = customerId ? customers.find((c) => c.id === customerId) : null;
    const customerName = customer
      ? String(customer.name ?? '').trim()
      : String(body.customerName ?? '').trim();

    const rows = await readReturns();
    const products = await getBagProducts();
    const keys = products.map((p) => p.key);

    let row = {
      id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      date,
      note,
      enteredBy,
      createdAt: new Date().toISOString(),
    };

    if (kind === RETURN_KINDS.ITEM_RETURN) {
      if (!customer && !customerName) {
        return res.status(400).json({ error: 'Select a shop or customer' });
      }
      const bills = await readBills();
      const billId = String(body.billId ?? '').trim();
      const bill = bills.find((b) => String(b.id ?? '').trim() === billId);
      if (!bill) {
        return res.status(400).json({ error: 'Select an invoice to return' });
      }
      const bagFields = {};
      let anyBags = 0;
      let amount = 0;
      const already = sumReturnedBagsForBill(rows, bill.id, keys);
      for (const p of products) {
        const requested = Math.floor(toNonNegNumber(body[p.bagsField]));
        const sold = Math.floor(toNonNegNumber(bill[p.bagsField]));
        const remaining = Math.max(0, sold - (already[p.key] || 0));
        if (requested > remaining) {
          return res.status(400).json({
            error: `${p.label}: only ${remaining} bag${remaining === 1 ? '' : 's'} left to return on this invoice`,
          });
        }
        const unitPrice = toNonNegMoney(bill[p.unitPriceField]);
        const line = Math.round(requested * unitPrice * 100) / 100;
        bagFields[p.bagsField] = requested;
        bagFields[p.unitPriceField] = unitPrice;
        bagFields[`${p.key}Line`] = line;
        anyBags += requested;
        amount += line;
      }
      amount = Math.round(amount * 100) / 100;
      if (anyBags <= 0 || amount <= 0) {
        return res.status(400).json({ error: 'Enter bags to return from this invoice' });
      }
      const settlementRaw = String(body.settlement ?? '').trim();
      const settlement =
        settlementRaw === SETTLEMENTS.CASH
          ? SETTLEMENTS.CASH
          : settlementRaw === SETTLEMENTS.DAMAGE
            ? SETTLEMENTS.DAMAGE
            : SETTLEMENTS.CREDIT_NOTE;
      if (settlement === SETTLEMENTS.DAMAGE) {
        const admin = requireAdminUser(req, res, 'Only an admin can settle a return as damage items');
        if (!admin) return;
      }
      let returnInvoiceNumber = String(body.returnInvoiceNumber ?? '').trim();
      let damageInvoiceNumber = String(body.damageInvoiceNumber ?? '').trim();
      if (settlement === SETTLEMENTS.CREDIT_NOTE) {
        if (!returnInvoiceNumber) {
          returnInvoiceNumber = suggestNextReturnInvoiceNumber(rows);
        }
        if (invoiceNumberTaken(rows, 'returnInvoiceNumber', returnInvoiceNumber)) {
          return res.status(400).json({ error: 'This return invoice # is already used' });
        }
      } else if (settlement === SETTLEMENTS.DAMAGE) {
        if (!damageInvoiceNumber) {
          damageInvoiceNumber = suggestNextDamageInvoiceNumber(rows);
        }
        if (invoiceNumberTaken(rows, 'damageInvoiceNumber', damageInvoiceNumber)) {
          return res.status(400).json({ error: 'This damage invoice # is already used' });
        }
      }
      row = {
        ...row,
        customerId: customer?.id || '',
        customerName: customerName || String(bill.customerName ?? '').trim(),
        billId: bill.id,
        invoiceNumber: String(bill.invoiceNumber ?? '').trim(),
        settlement,
        ...(returnInvoiceNumber ? { returnInvoiceNumber } : {}),
        ...(damageInvoiceNumber ? { damageInvoiceNumber } : {}),
        ...bagFields,
        amount,
      };
    } else if (kind === RETURN_KINDS.DAMAGE) {
      const live = await getLiveStockSummary();
      const liveByKey = Object.fromEntries((live.brands || []).map((b) => [b.key, Math.max(0, Number(b.bags) || 0)]));
      const bagFields = {};
      let anyBags = 0;
      for (const p of products) {
        const requested = Math.floor(toNonNegNumber(body[p.bagsField]));
        const available = Math.floor(liveByKey[p.key] || 0);
        if (requested > available) {
          return res.status(400).json({
            error: `${p.label}: only ${available} bag${available === 1 ? '' : 's'} in sellable stock`,
          });
        }
        bagFields[p.bagsField] = requested;
        anyBags += requested;
      }
      if (anyBags <= 0) {
        return res.status(400).json({ error: 'Enter bags to move to damage items' });
      }
      let damageInvoiceNumber = String(body.damageInvoiceNumber ?? '').trim();
      if (!damageInvoiceNumber) {
        damageInvoiceNumber = suggestNextDamageInvoiceNumber(rows);
      }
      if (invoiceNumberTaken(rows, 'damageInvoiceNumber', damageInvoiceNumber)) {
        return res.status(400).json({ error: 'This damage invoice # is already used' });
      }
      row = {
        ...row,
        customerId: customer?.id || '',
        customerName,
        damageInvoiceNumber,
        ...bagFields,
        amount: 0,
      };
    } else {
      if (!customer && !customerName) {
        return res.status(400).json({ error: 'Select a shop to apply the price change' });
      }
      const amount = toNonNegMoney(body.amount);
      if (amount <= 0) {
        return res.status(400).json({ error: 'Enter a price change amount greater than zero' });
      }
      const direction =
        String(body.direction ?? '').trim() === PRICE_DIRECTIONS.UP
          ? PRICE_DIRECTIONS.UP
          : PRICE_DIRECTIONS.DOWN;
      row = {
        ...row,
        customerId: customer?.id || '',
        customerName,
        direction,
        amount,
      };
    }

    rows.push(row);
    await writeReturns(rows);

    if (kind === RETURN_KINDS.ITEM_RETURN || kind === RETURN_KINDS.PRICE_CHANGE) {
      const bills = await readBills();
      const paymentsList = await readPayments();
      if (row.customerId) {
        await refreshCustomerBalancesForCustomerIds(bills, paymentsList, row.customerId);
      } else if (row.customerName) {
        await refreshCustomerBalancesForBillNames(bills, paymentsList, row.customerName);
      }
    }

    if (kind === RETURN_KINDS.ITEM_RETURN || kind === RETURN_KINDS.DAMAGE) {
      try {
        await refreshLiveStockFromSources();
      } catch (err) {
        console.error('liveStock refresh after return', err);
      }
    }

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save return' });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const stocks = await readStocks();
    res.json(stocks);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read stocks' });
  }
});

app.get('/api/daily-stock', async (req, res) => {
  try {
    const payload = await getLiveDailyLedgerPayload();
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load daily stock' });
  }
});

app.get('/api/stocks/summary', async (req, res) => {
  try {
    const payload = await getLiveStockSummary();
    const keys = (payload.brands || []).map((b) => b.key);
    const unloads = await readUnloads();
    const pending = sumPendingUnloadBagsByBrand(unloads, keys);
    const brands = (payload.brands || []).map((b) => {
      const bags = Math.max(0, Math.floor(Number(b.bags) || 0));
      const reserved = Math.max(0, Math.floor(Number(pending[b.key]) || 0));
      return {
        ...b,
        bags,
        availableForRequest: Math.max(0, bags - reserved),
        pendingReserved: reserved,
      };
    });
    res.json({ ...payload, brands });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to summarize stock' });
  }
});

/** Latest cut-off price per brand from previous stock loads. */
app.get('/api/stocks/last-cut-off-prices', async (req, res) => {
  try {
    const stocks = await readStocks();
    const keys = await getBagProductKeys();
    res.json({ prices: lastCutOffPricesByBrand(stocks, keys) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load last cut-off prices' });
  }
});

app.post('/api/stocks', async (req, res) => {
  try {
    const body = req.body || {};
    const addedBy = String(body.addedBy ?? '').trim();
    if (!addedBy) {
      return res.status(400).json({ error: 'addedBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const stockId = String(body.stockId ?? '').trim();
    const vehicleNumber = String(body.vehicleNumber ?? '').trim();
    if (!date || !stockId || !vehicleNumber) {
      return res.status(400).json({ error: 'date, stockId, and vehicleNumber are required' });
    }

    const { row, missingRefs } = await buildLoadRowFromBody(body, {
      id: `load-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      stockId,
      vehicleNumber,
      purchaseOrderIds: normalizePurchaseOrderIds(body.purchaseOrderIds),
      addedBy,
      createdAt: new Date().toISOString(),
    });
    if (missingRefs.length > 0) {
      return res.status(400).json({
        error: `When bags are 1 or more for a product, invoice and cheque are required. Missing: ${missingRefs.join(', ')}.`,
      });
    }

    const stocks = await readStocks();
    stocks.push(row);
    await writeStocks(stocks);
    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after load', err);
    }
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save stock record' });
  }
});

app.patch('/api/stocks/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Stock id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.addedBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const stockId = String(body.stockId ?? '').trim();
    const vehicleNumber = String(body.vehicleNumber ?? '').trim();
    if (!date || !stockId || !vehicleNumber) {
      return res.status(400).json({ error: 'date, stockId, and vehicleNumber are required' });
    }

    const stocks = await readStocks();
    const idx = stocks.findIndex((s) => s.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Stock record not found' });
    }
    const existing = stocks[idx];

    const { row, missingRefs } = await buildLoadRowFromBody(body, {
      ...existing,
      date,
      stockId,
      vehicleNumber,
      purchaseOrderIds: normalizePurchaseOrderIds(
        body.purchaseOrderIds !== undefined ? body.purchaseOrderIds : existing.purchaseOrderIds,
      ),
      updatedBy,
      updatedAt: new Date().toISOString(),
    });
    if (missingRefs.length > 0) {
      return res.status(400).json({
        error: `When bags are 1 or more for a product, invoice and cheque are required. Missing: ${missingRefs.join(', ')}.`,
      });
    }

    stocks[idx] = row;
    await writeStocks(stocks);
    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after load update', err);
    }
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update stock record' });
  }
});

app.get('/api/messages/settings', async (req, res) => {
  try {
    const [emailConfig, whatsappConfig, companyData, notificationSettings] = await Promise.all([
      readEmailConfig(),
      readWhatsAppConfig(),
      readCompanyData(),
      readNotificationSettings(),
    ]);
    res.json({
      emailConfig: maskEmailConfig(emailConfig),
      whatsappConfig: {
        enabled: Boolean(whatsappConfig.enabled),
        lastConnection: whatsappConfig.lastConnection || null,
      },
      notificationSettings,
      whatsappStatus: getWhatsAppStatus(),
      companyData,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load message settings' });
  }
});

app.put('/api/messages/notification-settings', async (req, res) => {
  try {
    const body = req.body || {};
    const next = await writeNotificationSettings(normalizeNotificationSettings(body));
    res.json({ notificationSettings: next });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save notification settings' });
  }
});

app.put('/api/messages/email-config', async (req, res) => {
  try {
    const body = req.body || {};
    const current = await readEmailConfig();
    const host = body.host !== undefined ? String(body.host ?? '').trim() : current.host;
    const user = body.user !== undefined ? String(body.user ?? '').trim() : current.user;
    const from = body.from !== undefined ? String(body.from ?? '').trim() : current.from;
    const fromName = body.fromName !== undefined ? String(body.fromName ?? '').trim() : current.fromName;
    const port = body.port !== undefined ? parseInt(String(body.port), 10) : current.port;
    const secure = body.secure !== undefined ? Boolean(body.secure) : current.secure;
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : current.enabled;

    let pass = current.pass;
    if (body.pass !== undefined && String(body.pass).trim() !== '') {
      pass = String(body.pass).trim();
    }

    if (enabled && (!host || !user || !pass)) {
      return res.status(400).json({ error: 'host, user, and password are required when email is enabled' });
    }

    const next = {
      enabled,
      host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      secure,
      user,
      pass,
      from: from || user,
      fromName: fromName || SHOP_NAME,
    };
    await writeEmailConfig(next);
    res.json({ emailConfig: maskEmailConfig(next) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save email config' });
  }
});

app.put('/api/messages/company-data', async (req, res) => {
  try {
    const body = req.body || {};
    const distributor = String(body.distributor ?? '').trim();
    const company = String(body.company ?? '').trim();
    if (!distributor || !company) {
      return res.status(400).json({ error: 'distributor and company are required' });
    }
    const next = { distributor, company };
    await writeCompanyData(next);
    res.json(next);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save company data' });
  }
});

app.get('/api/messages/sent-emails', async (req, res) => {
  try {
    const emails = await readSentEmails();
    res.json(emails);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load sent emails' });
  }
});

app.get('/api/messages/whatsapp-status', async (req, res) => {
  try {
    const whatsappConfig = await readWhatsAppConfig();
    res.json({
      enabled: Boolean(whatsappConfig.enabled),
      ...getWhatsAppStatus(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load WhatsApp status' });
  }
});

app.put('/api/messages/whatsapp-config', async (req, res) => {
  try {
    const body = req.body || {};
    const current = await readWhatsAppConfig();
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : current.enabled;
    const next = { ...current, enabled };
    await writeWhatsAppConfig(next);
    const whatsappStatus = await applyWhatsAppConfigChange(enabled);
    res.json({
      whatsappConfig: { enabled: next.enabled, lastConnection: next.lastConnection || null },
      whatsappStatus,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save WhatsApp config' });
  }
});

app.post('/api/messages/whatsapp/reconnect', async (req, res) => {
  try {
    const result = await reconnectWhatsAppClient();
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ whatsappStatus: result.status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to reconnect WhatsApp' });
  }
});

app.post('/api/messages/whatsapp/reset-session', async (req, res) => {
  try {
    const result = await resetWhatsAppSession();
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ whatsappStatus: result.status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to reset WhatsApp session' });
  }
});

app.get('/api/messages/sent-whatsapp', async (req, res) => {
  try {
    const messages = await readSentWhatsapp();
    res.json(messages);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load sent WhatsApp history' });
  }
});

/** Staff drivers for PO / load assignment (no passwords). */
app.get('/api/drivers', async (req, res) => {
  try {
    const users = await readUsers();
    const drivers = users
      .filter((u) => String(u.role || '').toLowerCase() === 'driver')
      .map((u) => ({
        id: u.id,
        name: String(u.name || '').trim() || String(u.username || '').trim(),
        username: u.username,
        nic: String(u.nic || u.username || '').trim(),
        driverLicense: String(u.driverLicense || '').trim(),
      }))
      .sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
      );
    res.json(drivers);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read drivers' });
  }
});

/** Staff list for salary / assignments (no passwords). */
app.get('/api/staff', async (req, res) => {
  try {
    const users = await readUsers();
    const staff = users
      .map((u) => ({
        id: u.id,
        name: String(u.name || '').trim() || String(u.username || '').trim(),
        role: String(u.role || '').trim(),
        contact: String(u.contact || '').trim(),
        nic: String(u.nic || '').trim(),
        driverLicense: String(u.driverLicense || '').trim(),
      }))
      .filter((u) => u.id && u.name && u.role !== 'Admin')
      .sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
      );
    res.json(staff);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read staff' });
  }
});

app.get('/api/purchase-orders', async (req, res) => {
  try {
    const rows = await readPurchaseOrders();
    const sorted = [...rows].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read purchase orders' });
  }
});

app.get('/api/purchase-orders/last-prices', async (req, res) => {
  try {
    const distributorId = String(req.query.distributorId ?? '').trim();
    if (!distributorId) {
      return res.status(400).json({ error: 'distributorId is required' });
    }
    const rows = await readPurchaseOrders();
    res.json({ prices: lastPricesByProduct(rows, distributorId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load last prices' });
  }
});

app.get('/api/purchase-orders/last-price', async (req, res) => {
  try {
    const distributorId = String(req.query.distributorId ?? '').trim();
    const product = String(req.query.product ?? '').trim();
    if (!distributorId || !product) {
      return res.status(400).json({ error: 'distributorId and product are required' });
    }
    const rows = await readPurchaseOrders();
    const unitPrice = findLastUnitPrice(rows, distributorId, product);
    res.json({ unitPrice: unitPrice == null ? null : unitPrice });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load last price' });
  }
});

/**
 * Create purchase orders. Payment per product → one PO per line.
 * Whole-order payment → a single PO with all items.
 * Body: date, distributorId, vehicleNumber, driverName, driverId?, cheques[], createdBy,
 *       items: [{ product, quantity, unitPrice }]
 */
app.post('/api/purchase-orders', async (req, res) => {
  try {
    const body = req.body || {};
    const createdBy = String(body.createdBy ?? body.enteredBy ?? body.addedBy ?? '').trim();
    if (!createdBy) {
      return res.status(400).json({ error: 'createdBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const distributorId = String(body.distributorId ?? '').trim();
    if (!distributorId) {
      return res.status(400).json({ error: 'distributorId is required' });
    }

    const distributors = await readDistributors();
    const distributor = distributors.map((d) => withNormalizedLists(d)).find((d) => d.id === distributorId);
    if (!distributor) {
      return res.status(400).json({ error: 'Distributor not found' });
    }

    const distLocations = normalizeLocations(distributor);
    const distributionLocationRaw = String(
      body.distributionLocation ?? body.distributorLocation ?? '',
    ).trim();
    let distributionLocation = '';
    if (distLocations.length > 0) {
      if (!distributionLocationRaw) {
        return res.status(400).json({ error: 'distributionLocation is required' });
      }
      const match = distLocations.find(
        (l) => l.toLowerCase() === distributionLocationRaw.toLowerCase(),
      );
      if (!match) {
        return res.status(400).json({ error: 'Invalid distribution location for this distributor' });
      }
      distributionLocation = match;
    } else if (distributionLocationRaw) {
      distributionLocation = distributionLocationRaw;
    }

    const vehicleNumber = String(body.vehicleNumber ?? body.lorry ?? '').trim();
    if (!vehicleNumber) {
      return res.status(400).json({ error: 'lorry / vehicleNumber is required' });
    }

    const driverName = String(body.driverName ?? '').trim();
    if (!driverName) {
      return res.status(400).json({ error: 'driverName is required' });
    }
    const driverId = String(body.driverId ?? '').trim();

    const shop = await readShopData();
    const bankAccountById = new Map((shop.bankAccounts || []).map((a) => [a.id, a]));

    const chequePerProduct = Boolean(body.chequePerProduct);
    const doorStock = Boolean(body.doorStock);
    let sharedCheques = [];
    if (!chequePerProduct) {
      const validatedShared = validatePoCheques(body.cheques, bankAccountById, 'Payment');
      if (!validatedShared.ok) {
        return res.status(400).json({ error: validatedShared.error });
      }
      sharedCheques = validatedShared.cheques;
    }

    const allowedProducts = new Set(
      (distributor.products || []).map((p) => String(p).trim().toLowerCase()).filter(Boolean),
    );

    let rawItems = Array.isArray(body.items) ? body.items : null;
    if (!rawItems) {
      const singleProduct = String(body.product ?? '').trim();
      if (singleProduct) {
        rawItems = [
          {
            product: singleProduct,
            quantity: body.quantity,
            unitPrice: body.unitPrice,
            cheques: body.cheques,
          },
        ];
      } else {
        rawItems = [];
      }
    }

    const items = [];
    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i] || {};
      const product = String(item.product ?? '').trim();
      if (!product) {
        return res.status(400).json({ error: `Item ${i + 1}: product is required` });
      }
      if (allowedProducts.size > 0 && !allowedProducts.has(product.toLowerCase())) {
        return res.status(400).json({
          error: `Item ${i + 1}: "${product}" is not a product of ${distributor.name}`,
        });
      }
      const quantity = toNonNegNumber(item.quantity);
      if (quantity <= 0) {
        return res.status(400).json({ error: `Item ${i + 1}: quantity must be greater than 0` });
      }
      const unitPrice = toNonNegMoney(item.unitPrice);
      if (unitPrice <= 0) {
        return res.status(400).json({ error: `Item ${i + 1}: unit price must be greater than 0` });
      }

      let itemCheques = sharedCheques;
      if (chequePerProduct) {
        const validatedItem = validatePoCheques(item.cheques, bankAccountById, `Item ${i + 1} payment`);
        if (!validatedItem.ok) {
          return res.status(400).json({ error: validatedItem.error });
        }
        itemCheques = validatedItem.cheques;
      }

      items.push({
        product,
        quantity,
        unitPrice,
        lineTotal: poLineTotal(quantity, unitPrice),
        cheques: itemCheques,
      });
    }

    if (items.length === 0) {
      return res.status(400).json({ error: 'Add at least one product line' });
    }

    const existing = await readPurchaseOrders();
    let nextPo = nextSuggestedPoNumber(existing);
    const batchId = `pobatch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = new Date().toISOString();
    const chequeMode = chequePerProduct ? 'perProduct' : 'shared';
    const created = [];

    const basePo = {
      date,
      distributorId: distributor.id,
      distributorName: distributor.name,
      ...(distributionLocation ? { distributionLocation } : {}),
      chequeMode,
      vehicleNumber,
      driverName,
      ...(driverId ? { driverId } : {}),
      ...(doorStock ? { doorStock: true, notes: 'Door step' } : {}),
      createdBy,
      createdAt,
    };

    const takePoNumber = () => {
      const poNumber = nextPo;
      const m = /^PO-(\d+)$/i.exec(nextPo);
      const n = m ? parseInt(m[1], 10) + 1 : existing.length + created.length + 2;
      nextPo = `PO-${String(n).padStart(4, '0')}`;
      return poNumber;
    };

    if (chequePerProduct) {
      for (const item of items) {
        created.push({
          id: `po-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          poNumber: takePoNumber(),
          batchId,
          ...basePo,
          product: item.product,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          totalAmount: item.lineTotal,
          cheques: item.cheques,
        });
      }
    } else {
      const lineItems = items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      }));
      const totalAmount = lineItems.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0);
      const totalQty = lineItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const first = lineItems[0];
      created.push({
        id: `po-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        poNumber: takePoNumber(),
        batchId,
        ...basePo,
        items: lineItems,
        product: first.product,
        quantity: totalQty,
        unitPrice: first.unitPrice,
        lineTotal: totalAmount,
        totalAmount,
        cheques: sharedCheques,
      });
    }

    existing.push(...created);
    await writePurchaseOrders(existing);

    const cashBookLines = [];
    if (!chequePerProduct) {
      for (const p of sharedCheques) {
        if (!isPoCashPayment(p)) continue;
        const poNumbers = created.map((po) => po.poNumber).filter(Boolean);
        cashBookLines.push({
          amount: p.amount,
          poId: created[0]?.id,
          poNumber: poNumbers.length === 1 ? poNumbers[0] : poNumbers.join(', '),
        });
      }
    } else {
      for (const po of created) {
        for (const p of po.cheques || []) {
          if (!isPoCashPayment(p)) continue;
          cashBookLines.push({
            amount: p.amount,
            poId: po.id,
            poNumber: po.poNumber,
            product: (po.items || []).map((i) => i.product).filter(Boolean).join(', ') || po.product,
          });
        }
      }
    }

    if (cashBookLines.length > 0) {
      const cashBook = await readCashBookEntries();
      const bookedAt = new Date().toISOString();
      for (const line of cashBookLines) {
        const descParts = [
          line.poNumber ? `PO ${line.poNumber}` : 'Purchase order',
          distributor.name,
          line.product,
        ].filter(Boolean);
        cashBook.push(
          normalizeEntry({
            id: `cbe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            date,
            category: 'purchase_order',
            amount: line.amount,
            description: descParts.join(' · '),
            recordedBy: createdBy,
            poId: line.poId,
            poNumber: line.poNumber,
            batchId,
            createdAt: bookedAt,
          }),
        );
      }
      await writeCashBookEntries(cashBook);
    }

    res.status(201).json({ created, count: created.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create purchase orders' });
  }
});

app.patch('/api/purchase-orders/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Purchase order id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.createdBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }

    const rows = await readPurchaseOrders();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const current = rows[idx];
    if (current.cancelled) {
      return res.status(400).json({ error: 'Cancelled purchase orders cannot be edited' });
    }
    const date = body.date !== undefined ? String(body.date ?? '').trim() : current.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    let distributorId = current.distributorId;
    let distributorName = current.distributorName;
    if (body.distributorId !== undefined) {
      distributorId = String(body.distributorId ?? '').trim();
      const distributors = await readDistributors();
      const distributor = distributors.map((d) => withNormalizedLists(d)).find((d) => d.id === distributorId);
      if (!distributor) {
        return res.status(400).json({ error: 'Distributor not found' });
      }
      distributorId = distributor.id;
      distributorName = distributor.name;
    }

    const product =
      body.product !== undefined ? String(body.product ?? '').trim() : String(current.product || '').trim();
    if (!product) {
      return res.status(400).json({ error: 'product is required' });
    }

    const quantity =
      body.quantity !== undefined ? toNonNegNumber(body.quantity) : toNonNegNumber(current.quantity);
    if (quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be greater than 0' });
    }

    const unitPrice =
      body.unitPrice !== undefined ? toNonNegMoney(body.unitPrice) : toNonNegMoney(current.unitPrice);
    if (unitPrice <= 0) {
      return res.status(400).json({ error: 'unit price must be greater than 0' });
    }

    const vehicleNumber =
      body.vehicleNumber !== undefined || body.lorry !== undefined
        ? String(body.vehicleNumber ?? body.lorry ?? '').trim()
        : String(current.vehicleNumber || '').trim();
    if (!vehicleNumber) {
      return res.status(400).json({ error: 'lorry / vehicleNumber is required' });
    }

    const driverName =
      body.driverName !== undefined
        ? String(body.driverName ?? '').trim()
        : String(current.driverName || '').trim();
    if (!driverName) {
      return res.status(400).json({ error: 'driverName is required' });
    }

    const driverId =
      body.driverId !== undefined ? String(body.driverId ?? '').trim() : String(current.driverId || '').trim();

    let cheques = current.cheques || [];
    if (body.cheques !== undefined) {
      const shop = await readShopData();
      const bankAccountById = new Map((shop.bankAccounts || []).map((a) => [a.id, a]));
      const validated = validatePoCheques(body.cheques, bankAccountById, 'Payment');
      if (!validated.ok) {
        return res.status(400).json({ error: validated.error });
      }
      cheques = validated.cheques;
    }
    const total = poLineTotal(quantity, unitPrice);

    const next = {
      ...current,
      date,
      distributorId,
      distributorName,
      product,
      quantity,
      unitPrice,
      lineTotal: total,
      totalAmount: total,
      cheques,
      vehicleNumber,
      driverName,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };
    if (driverId) next.driverId = driverId;
    else delete next.driverId;

    rows[idx] = next;
    await writePurchaseOrders(rows);
    res.json(next);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update purchase order' });
  }
});

/** Manager/admin: cancel an issued PO cheque (removed from bank balance / transaction lists). */
app.post('/api/purchase-orders/:id/cancel-cheque', async (req, res) => {
  const auth = await requireManagerOrAdmin(req, res);
  if (!auth) return;
  try {
    const poId = String(req.params.id ?? '').trim();
    if (!poId) {
      return res.status(400).json({ error: 'Purchase order id is required' });
    }
    const body = req.body || {};
    const cancelledBy = String(body.cancelledBy ?? auth.username ?? '').trim();
    if (!cancelledBy) {
      return res.status(400).json({ error: 'cancelledBy (username) is required' });
    }

    const rows = await readPurchaseOrders();
    const result = cancelIssuedCheque(rows, {
      poId,
      cancelledBy,
      chequeNumber: body.chequeNumber,
      chequeDate: body.chequeDate,
      bankAccountId: body.bankAccountId,
      amount: body.amount,
    });
    if (!result.ok) {
      return res.status(result.error === 'Purchase order not found' ? 404 : 400).json({ error: result.error });
    }
    await writePurchaseOrders(rows);
    res.json({ ok: true, updated: result.updated, cancelledAt: result.cancelledAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to cancel cheque' });
  }
});

/** Admin: cancel a purchase order (and its unused payments). Blocked if already used on a load. */
app.post('/api/purchase-orders/:id/cancel', async (req, res) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sign in again as admin to cancel purchase orders' });
  }
  if (auth.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can cancel purchase orders' });
  }
  try {
    const poId = String(req.params.id ?? '').trim();
    if (!poId) {
      return res.status(400).json({ error: 'Purchase order id is required' });
    }
    const body = req.body || {};
    const cancelledBy = String(body.cancelledBy ?? auth.username ?? '').trim();
    if (!cancelledBy) {
      return res.status(400).json({ error: 'cancelledBy (username) is required' });
    }

    const stocks = await readStocks();
    const usedOn = [];
    for (const load of stocks) {
      const ids = Array.isArray(load.purchaseOrderIds) ? load.purchaseOrderIds : [];
      if (ids.some((id) => String(id).trim() === poId)) {
        usedOn.push(String(load.stockId || load.id || '').trim() || 'a load');
      }
    }
    if (usedOn.length > 0) {
      return res.status(400).json({
        error: `This purchase order is already used on load ${usedOn[0]}. Remove it from the load first.`,
      });
    }

    const rows = await readPurchaseOrders();
    const result = cancelPurchaseOrder(rows, { poId, cancelledBy });
    if (!result.ok) {
      return res.status(result.error === 'Purchase order not found' ? 404 : 400).json({ error: result.error });
    }

    if (result.shouldCancelCashBook) {
      const cashBook = await readCashBookEntries();
      let cashTouched = false;
      const nextCash = cashBook.map((entry) => {
        if (String(entry.category ?? '').trim() !== 'purchase_order') return entry;
        if (entry.cancelled) return entry;
        const matchesPo = String(entry.poId ?? '').trim() === poId;
        const matchesBatch =
          result.chequeMode === 'shared' &&
          result.batchId &&
          String(entry.batchId ?? '').trim() === result.batchId;
        if (!matchesPo && !matchesBatch) return entry;
        cashTouched = true;
        return {
          ...entry,
          cancelled: true,
          cancelledAt: result.cancelledAt,
          cancelledBy,
        };
      });
      if (cashTouched) {
        await writeCashBookEntries(nextCash);
      }
    }

    await writePurchaseOrders(rows);
    res.json({ ok: true, po: result.po, cancelledAt: result.cancelledAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to cancel purchase order' });
  }
});

/** CRA production build: same process serves API + static assets + client routes (see SPA fallback below). */
const FRONTEND_BUILD = path.resolve(
  process.env.FRONTEND_BUILD_DIR || path.join(__dirname, '..', 'frontend', 'build')
);
const FRONTEND_INDEX = path.join(FRONTEND_BUILD, 'index.html');

if (fs.existsSync(FRONTEND_INDEX)) {
  app.use(express.static(FRONTEND_BUILD, { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(FRONTEND_INDEX, (err) => {
      if (err) next(err);
    });
  });
} else {
  console.warn(
    `[server] No frontend build at ${FRONTEND_INDEX} — only API. Run: cd frontend && npm run build (or set FRONTEND_BUILD_DIR).`
  );
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

bootstrapWhatsAppOnStartup().catch((err) => {
  console.error('whatsapp bootstrap', err);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  if (fs.existsSync(FRONTEND_INDEX)) {
    console.log(`Serving SPA from ${FRONTEND_BUILD}`);
  }
  startOverdueReminderScheduler();
  startBackupScheduler();
});
