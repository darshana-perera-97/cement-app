import { BRANDS } from './brandTheme';
import { chequePortion, getPaymentCheques } from './paymentCheques';
import { inDateRange } from './tableToolbar';

function cashPortion(p) {
  if (p.cashAmount !== undefined || p.chequeAmount !== undefined) {
    return Math.max(0, Number(p.cashAmount) || 0);
  }
  const total = Number(p.amount) || 0;
  if (total > 0) return Math.max(0, total - chequePortion(p));
  return 0;
}

function formatChequeDetailLine(cheques) {
  return cheques
    .map((c) => {
      const num = c.chequeNumber || '—';
      const date = c.chequeDate || '—';
      const amt = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'LKR',
        maximumFractionDigits: 2,
      }).format(Number(c.amount) || 0);
      return `${num} · ${date} · ${amt}`;
    })
    .join('  ·  ');
}

/**
 * One row per brand line on loads in range (bags > 0).
 * Columns: date, vehicle, cheque #, invoice #, bag type, bags, total cost.
 */
export function buildFinancialLoadPurchaseRows(loads, from, to) {
  const rows = [];
  for (const load of loads) {
    const date = String(load.date ?? '').slice(0, 10);
    if (!inDateRange(date, from, to)) continue;
    const vehicle = String(load.vehicleNumber ?? '').trim() || '—';

    for (const brand of BRANDS) {
      const bags = Number(load[`${brand.key}Bags`]) || 0;
      if (bags <= 0) continue;
      rows.push({
        rowKey: `${load.id || load.stockId || date}-${brand.key}`,
        date,
        vehicle,
        chequeNumber: String(load[`${brand.key}Cheque`] ?? '').trim() || '—',
        invoiceNumber: String(load[`${brand.key}Invoice`] ?? '').trim() || '—',
        bagType: brand.label,
        bags,
        totalCost: Number(load[`${brand.key}Cost`]) || 0,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byVehicle = a.vehicle.localeCompare(b.vehicle);
    if (byVehicle !== 0) return byVehicle;
    return a.bagType.localeCompare(b.bagType);
  });
  return rows;
}

/**
 * One row per shop payment in range: cash + cheques together.
 * Cheque details (number + date + amount) shown as a small secondary line.
 */
export function buildFinancialCashInRows(payments, from, to) {
  const rows = [];
  for (const p of payments) {
    const date = String(p.date ?? '').slice(0, 10);
    if (!inDateRange(date, from, to)) continue;

    const cashAmount = cashPortion(p);
    const chequeAmount = chequePortion(p);
    if (cashAmount <= 0 && chequeAmount <= 0) continue;

    const cheques = getPaymentCheques(p);
    rows.push({
      rowKey: p.id || `${date}-${p.billNumber || ''}`,
      date,
      shop: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null && String(p.billNumber).trim() ? String(p.billNumber) : '—',
      cashAmount,
      chequeAmount,
      total: cashAmount + chequeAmount,
      chequeDetails: cheques.length > 0 ? formatChequeDetailLine(cheques) : '',
      sortAt: p.createdAt || `${date}T12:00:00`,
    });
  }

  rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return String(a.sortAt).localeCompare(String(b.sortAt));
  });
  return rows;
}

/**
 * Shop payment cheques whose cheque (issue) date falls in the selected period.
 * date = payment date; issue date = cheque date; customer = shop.
 */
export function buildFinancialConvertingChequeRows(payments, from, to) {
  const rows = [];
  for (const p of payments) {
    const paymentDate = String(p.date ?? '').slice(0, 10);
    const cheques = getPaymentCheques(p);
    for (const c of cheques) {
      const issueDate = String(c.chequeDate ?? '').slice(0, 10);
      if (!inDateRange(issueDate, from, to)) continue;
      rows.push({
        rowKey: cheques.length > 1 ? `${p.id}::${c.id}` : p.id || `${paymentDate}-${c.chequeNumber}`,
        date: paymentDate || '—',
        chequeNumber: c.chequeNumber || '—',
        issueDate: issueDate || '—',
        billNumber: p.billNumber != null && String(p.billNumber).trim() ? String(p.billNumber) : '—',
        customer: String(p.customerName ?? '').trim() || '—',
        amount: Number(c.amount) || 0,
        sortAt: p.createdAt || `${paymentDate}T12:00:00`,
      });
    }
  }

  rows.sort((a, b) => {
    const byIssue = a.issueDate.localeCompare(b.issueDate);
    if (byIssue !== 0) return byIssue;
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return String(a.sortAt).localeCompare(String(b.sortAt));
  });
  return rows;
}
