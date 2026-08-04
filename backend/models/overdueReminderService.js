const { readCustomers, writeCustomers, toNonNegMoney } = require('./customersStore');
const { readBills } = require('./billsStore');
const { readPayments } = require('./paymentsStore');
const { readOverdueDates, getOverdueDaysForCustomer, DEFAULT_OVERDUE_DAYS } = require('./overdueDatesStore');
const {
  readNotificationSettings,
  normalizeTimeHHMM,
  normalizeWeekday,
} = require('./notificationSettingsStore');
const { computeRemainingAmount, computeBillPaymentAllocation } = require('./customerBalance');
const { notifyOverdueBalanceEmail } = require('./emailService');
const { notifyOverdueBalanceWhatsApp } = require('./whatsappService');

function todayYmdLocal() {
  const dt = new Date();
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function addDaysToYmd(ymd, days) {
  if (!ymd || String(ymd).length < 10) return '';
  const d = new Date(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(5, 7), 10) - 1,
    parseInt(ymd.slice(8, 10), 10),
  );
  d.setDate(d.getDate() + (Number(days) || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const stockId = String(bill.stockId ?? '').trim();
  if (stockId) parts.push(`Stock ${stockId}`);
  const labels = [
    ['tokyo', 'Tokyo'],
    ['samudra', 'Samudra'],
    ['atlas', 'Atlas'],
    ['nippon', 'Nippon'],
  ];
  const bagParts = [];
  for (const [key, label] of labels) {
    const n = Number(bill[`${key}Bags`]) || 0;
    if (n > 0) bagParts.push(`${label} ${n} bags`);
  }
  if (bagParts.length) parts.push(bagParts.join(', '));
  const line = parts.join(' · ');
  if (line) return line;
  const amt = toNonNegMoney(bill.totalAmount);
  return amt > 0 ? `Total LKR ${amt}` : 'Credit bill';
}

function getCustomerUnpaidBillRows(customer, bills, payments, overdueDates) {
  const todayYmd = todayYmdLocal();
  const settlementDays = getOverdueDaysForCustomer(overdueDates, customer.id) ?? DEFAULT_OVERDUE_DAYS;
  const { paidByBillId, custBills } = computeBillPaymentAllocation(customer, bills, payments);

  const rows = [];
  for (const bill of custBills) {
    const total = toNonNegMoney(bill.totalAmount);
    const id = String(bill.id ?? '').trim();
    const paidTowardBill = id ? paidByBillId.get(id) || 0 : 0;
    const outstanding = Math.round((total - paidTowardBill) * 100) / 100;
    if (outstanding <= 0) continue;
    const dueDate = addDaysToYmd(bill.date, settlementDays);
    const isOverdue = Boolean(dueDate && todayYmd > dueDate);
    rows.push({
      id: bill.id,
      billDate: bill.date,
      dueDate,
      outstandingAmount: outstanding,
      billTotal: total,
      details: billDetailsLine(bill),
      daysOverdue: isOverdue ? daysFromDueToToday(dueDate, todayYmd) : 0,
      isOverdue,
    });
  }
  return rows;
}

function buildReminderPayload(customer, bills, payments, overdueDates, shareMode) {
  const unpaidRows = getCustomerUnpaidBillRows(customer, bills, payments, overdueDates);
  const overdueBills = unpaidRows.filter((r) => r.isOverdue);
  const totalPendingAmount = computeRemainingAmount(customer, bills, payments);
  const totalOverdueAmount = overdueBills.reduce((s, r) => s + r.outstandingAmount, 0);

  const includePending = shareMode === 'pending_only' || shareMode === 'both';

  let shouldSend = false;
  if (shareMode === 'overdue_only') {
    shouldSend = overdueBills.length > 0;
  } else if (shareMode === 'pending_only') {
    shouldSend = totalPendingAmount > 0;
  } else {
    shouldSend = totalPendingAmount > 0;
  }

  return {
    shouldSend,
    shareMode,
    overdueBills,
    pendingBills: includePending ? unpaidRows : [],
    totalOverdueAmount: Math.round(totalOverdueAmount * 100) / 100,
    totalPendingAmount: Math.round(totalPendingAmount * 100) / 100,
  };
}

function effectiveScheduleForCustomer(customer, settings) {
  const weekday =
    customer.overdueNotifyWeekday != null
      ? normalizeWeekday(customer.overdueNotifyWeekday, settings.overdueReminderWeekday)
      : settings.overdueReminderWeekday;
  const time =
    normalizeTimeHHMM(customer.overdueNotifyTime) || settings.overdueReminderTime;
  return { weekday, time };
}

function reminderSlotKey(todayYmd, weekday, time) {
  return `${todayYmd}:${weekday}:${time}`;
}

function matchesScheduleNow(now, weekday, time) {
  if (now.getDay() !== weekday) return false;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}` === time;
}

let tickInProgress = false;

async function runOverdueReminderTick() {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    const settings = await readNotificationSettings();
    if (!settings.notifyOverdueBalance) return;

    const now = new Date();
    const todayYmd = todayYmdLocal();
    const shareMode = settings.overdueBalanceShareMode;

    const [customers, bills, payments, overdueDates] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
      readOverdueDates(),
    ]);

    let customersDirty = false;

    for (const customer of customers) {
      if (customer.overdueNotifyEnabled === false) continue;

      const { weekday, time } = effectiveScheduleForCustomer(customer, settings);
      if (!matchesScheduleNow(now, weekday, time)) continue;

      const slotKey = reminderSlotKey(todayYmd, weekday, time);
      if (customer.overdueReminderLastSentKey === slotKey) continue;

      const payload = buildReminderPayload(customer, bills, payments, overdueDates, shareMode);
      if (!payload.shouldSend) continue;

      const hasContact = Boolean(String(customer.contactNumber ?? '').trim());
      const hasEmail = Boolean(String(customer.email ?? '').trim());
      if (!hasContact && !hasEmail) continue;

      const referenceId = `overdue-reminder-${customer.id}-${todayYmd}`;

      await Promise.all([
        hasEmail
          ? notifyOverdueBalanceEmail(customer, payload, referenceId).catch((err) =>
              console.error('overdue reminder email', customer.id, err),
            )
          : null,
        hasContact
          ? notifyOverdueBalanceWhatsApp(customer, payload, referenceId).catch((err) =>
              console.error('overdue reminder whatsapp', customer.id, err),
            )
          : null,
      ]);

      customer.overdueReminderLastSentKey = slotKey;
      customersDirty = true;
    }

    if (customersDirty) {
      await writeCustomers(customers);
    }
  } catch (err) {
    console.error('overdue reminder tick', err);
  } finally {
    tickInProgress = false;
  }
}

function startOverdueReminderScheduler() {
  runOverdueReminderTick().catch((err) => console.error('overdue reminder initial tick', err));
  setInterval(() => {
    runOverdueReminderTick().catch((err) => console.error('overdue reminder tick', err));
  }, 60 * 1000);
}

module.exports = {
  getCustomerUnpaidBillRows,
  buildReminderPayload,
  effectiveScheduleForCustomer,
  runOverdueReminderTick,
  startOverdueReminderScheduler,
};
