const BRAND_LABELS = {
  tokyo: 'Tokyo',
  samudra: 'Samudra',
  atlas: 'Atlas',
  nippon: 'Nippon',
};

function formatMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 'LKR 0.00';
  return `LKR ${num.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-LK', { day: 'numeric', month: 'long', year: 'numeric' });
}

function billBagLines(record) {
  const lines = [];
  for (const key of Object.keys(BRAND_LABELS)) {
    const bags = Number(record[`${key}Bags`]) || 0;
    if (bags > 0) {
      lines.push(`• ${BRAND_LABELS[key]}: ${bags.toLocaleString()} bag${bags === 1 ? '' : 's'}`);
    }
  }
  return lines;
}

function promoBagLines(record) {
  const lines = [];
  for (const key of Object.keys(BRAND_LABELS)) {
    const bags = Number(record[`${key}Bags`]) || 0;
    if (bags > 0) {
      lines.push(`• ${BRAND_LABELS[key]}: ${bags.toLocaleString()} free bag${bags === 1 ? '' : 's'}`);
    }
  }
  return lines;
}

function messageHeader({ company, title }) {
  const distributor = String(company?.distributor ?? '').trim();
  const companyName = String(company?.company ?? '').trim();
  const lines = [];
  if (companyName) lines.push(companyName);
  if (distributor) lines.push(distributor);
  lines.push('');
  lines.push(`*${title}*`);
  lines.push('');
  return lines.join('\n');
}

function buildBillWhatsApp({ customer, bill, remainingAmount, company, hideFinancialDetails = false }) {
  const lines = [
    messageHeader({ company, title: 'Credit sale recorded' }),
    `Customer: ${customer.name}`,
    `Date: ${formatDate(bill.date)}`,
    ...billBagLines(bill),
  ];
  if (!hideFinancialDetails) {
    lines.push('', `*Balance to pay:* ${formatMoney(remainingAmount)}`);
  }
  lines.push('', 'This is an automated notification from your cement distributor account.');
  return {
    preview: `Credit sale · ${customer.name}`,
    text: lines.join('\n'),
  };
}

function paymentCashPortion(payment) {
  if (payment.cashAmount !== undefined || payment.chequeAmount !== undefined) {
    return Math.max(0, Number(payment.cashAmount) || 0);
  }
  const total = Math.max(0, Number(payment.amount) || 0);
  const cheques = Array.isArray(payment.cheques) ? payment.cheques : [];
  if (cheques.length > 0) {
    const chequeSum = cheques.reduce((s, c) => s + Math.max(0, Number(c.amount) || 0), 0);
    return Math.max(0, total - chequeSum);
  }
  return total;
}

function buildPaymentWhatsApp({ customer, payment, remainingAmount, company, hideFinancialDetails = false }) {
  const cash = paymentCashPortion(payment);
  const lines = [
    messageHeader({ company, title: 'Payment received' }),
    `Customer: ${customer.name}`,
    `Date: ${formatDate(payment.date)}`,
  ];
  if (!hideFinancialDetails) {
    lines.push(`Amount received: ${formatMoney(payment.amount)}`);
    if (cash > 0) lines.push(`Cash: ${formatMoney(cash)}`);
    if (payment.cheques?.length) {
      const chequeSummary = payment.cheques
        .map((c) => {
          let s = formatMoney(c.amount);
          if (c.chequeNumber) s += ` #${c.chequeNumber}`;
          if (c.chequeDate) s += ` · ${formatDate(c.chequeDate)}`;
          return s;
        })
        .join('; ');
      lines.push(`Cheques: ${chequeSummary}`);
    }
  } else {
    if (cash > 0) lines.push(`Cash received: ${formatMoney(cash)}`);
    else if (payment.cheques?.length) {
      const chequeSummary = payment.cheques
        .map((c) => {
          let s = c.chequeNumber ? `#${c.chequeNumber}` : 'Cheque';
          if (c.chequeDate) s += ` · ${formatDate(c.chequeDate)}`;
          return s;
        })
        .join('; ');
      lines.push(`Cheques: ${chequeSummary}`);
    }
  }
  if (payment.billNumber) lines.push(`Receipt no.: #${payment.billNumber}`);
  if (payment.note) lines.push(`Note: ${payment.note}`);
  if (payment.recordedBy) lines.push(`Recorded by: ${payment.recordedBy}`);
  if (!hideFinancialDetails) {
    lines.push('', `*Remaining balance:* ${formatMoney(remainingAmount)}`);
  }
  lines.push('', 'This is an automated notification from your cement distributor account.');
  const previewAmount = hideFinancialDetails && cash > 0 ? cash : payment.amount;
  return {
    preview: hideFinancialDetails && !(cash > 0)
      ? `Payment received · ${customer.name}`
      : `Payment received — ${formatMoney(previewAmount)} · ${customer.name}`,
    text: lines.join('\n'),
  };
}

function buildPromotionWhatsApp({ customer, promotion, company }) {
  const totalBags =
    (Number(promotion.tokyoBags) || 0) +
    (Number(promotion.samudraBags) || 0) +
    (Number(promotion.atlasBags) || 0) +
    (Number(promotion.nipponBags) || 0);

  const lines = [
    messageHeader({ company, title: 'Free bags recorded' }),
    `Customer: ${customer.name}`,
    `Date: ${formatDate(promotion.date)}`,
    `Reason: ${promotion.reason}`,
    ...promoBagLines(promotion),
  ];
  if (promotion.billNumber) lines.push(`Reference: #${promotion.billNumber}`);
  if (promotion.enteredBy) lines.push(`Recorded by: ${promotion.enteredBy}`);
  lines.push('');
  lines.push(`*Total free bags:* ${totalBags.toLocaleString()} bag${totalBags === 1 ? '' : 's'}`);
  lines.push('');
  lines.push('This is an automated notification from your cement distributor account.');
  return {
    preview: `Free bags — ${totalBags} bag${totalBags === 1 ? '' : 's'} · ${customer.name}`,
    text: lines.join('\n'),
  };
}

function buildChequeReturnWhatsApp({ customer, payment, cheque, remainingAmount, company, hideFinancialDetails = false }) {
  const returnYmd = String(cheque?.chequeReturnedAt ?? payment?.date ?? '').slice(0, 10);
  const lines = [
    messageHeader({ company, title: 'Cheque returned' }),
    `Customer: ${customer.name}`,
    `Date: ${formatDate(returnYmd)}`,
  ];
  if (cheque?.chequeNumber) lines.push(`Cheque no.: ${cheque.chequeNumber}`);
  if (cheque?.chequeDate) lines.push(`Converting date: ${formatDate(cheque.chequeDate)}`);
  if (!hideFinancialDetails && cheque?.amount != null) lines.push(`Amount: ${formatMoney(cheque.amount)}`);
  if (payment?.billNumber) lines.push(`Receipt no.: #${payment.billNumber}`);
  if (!hideFinancialDetails) {
    lines.push('', `*Updated balance to pay:* ${formatMoney(remainingAmount)}`);
  }
  lines.push('');
  lines.push('This cheque has been marked as returned. The payment credit has been reversed on your account.');
  lines.push('');
  lines.push('This is an automated notification from your cement distributor account.');
  const num = String(cheque?.chequeNumber ?? '').trim();
  return {
    preview: num ? `Cheque #${num} returned · ${customer.name}` : `Cheque returned · ${customer.name}`,
    text: lines.join('\n'),
  };
}

function unloadBagLines(record) {
  const lines = [];
  for (const key of Object.keys(BRAND_LABELS)) {
    const bags = Number(record[`${key}Bags`]) || 0;
    if (bags > 0) {
      const label = BRAND_LABELS[key];
      lines.push(`${label} ${bags.toLocaleString()} bag${bags === 1 ? '' : 's'} has been unloaded.`);
    }
  }
  return lines;
}

function formatBillLine({ billDate, dueDate, outstandingAmount, details, daysOverdue, hideFinancialDetails }) {
  const datePart = `Bill ${formatDate(billDate)}`;
  const duePart = dueDate ? ` · due ${formatDate(dueDate)}` : '';
  const overduePart = daysOverdue > 0 ? ` · ${daysOverdue}d overdue` : '';
  const detailPart = details ? ` · ${details}` : '';
  if (hideFinancialDetails) {
    return `• ${datePart}${duePart}${overduePart}${detailPart}`;
  }
  return `• ${datePart}${duePart}${overduePart} — ${formatMoney(outstandingAmount)}${detailPart}`;
}

function buildOverdueBalanceWhatsApp({
  customer,
  overdueBills = [],
  pendingBills = [],
  totalOverdueAmount = 0,
  totalPendingAmount = 0,
  shareMode = 'both',
  company,
  hideFinancialDetails = false,
}) {
  const lines = [
    messageHeader({ company, title: 'Balance reminder' }),
    `Customer: ${customer.name}`,
    `Date: ${formatDate(new Date().toISOString().slice(0, 10))}`,
  ];

  if (shareMode === 'overdue_only' || shareMode === 'both') {
    if (overdueBills.length > 0) {
      lines.push('', '*Overdue bills*');
      for (const bill of overdueBills) {
        lines.push(formatBillLine({ ...bill, hideFinancialDetails }));
      }
      if (!hideFinancialDetails && totalOverdueAmount > 0) {
        lines.push('', `*Total overdue:* ${formatMoney(totalOverdueAmount)}`);
      }
    }
  }

  if (shareMode === 'pending_only') {
    if (!hideFinancialDetails && totalPendingAmount > 0) {
      lines.push('', `*Total pending balance:* ${formatMoney(totalPendingAmount)}`);
    } else if (hideFinancialDetails) {
      lines.push('', 'You have an outstanding balance on your account.');
    }
  } else if (shareMode === 'both') {
    if (!hideFinancialDetails && totalPendingAmount > 0) {
      lines.push('', `*Total pending balance:* ${formatMoney(totalPendingAmount)}`);
    }
    if (hideFinancialDetails && pendingBills.length > 0 && overdueBills.length === 0) {
      lines.push('', 'You have unpaid bills on your account.');
    }
  }

  lines.push('', 'Please arrange payment at your earliest convenience.');
  lines.push('', 'This is an automated notification from your cement distributor account.');

  const previewAmount =
    shareMode === 'pending_only' || (shareMode === 'both' && overdueBills.length === 0)
      ? totalPendingAmount
      : totalOverdueAmount;
  return {
    preview: hideFinancialDetails
      ? `Balance reminder · ${customer.name}`
      : `Balance reminder — ${formatMoney(previewAmount)} · ${customer.name}`,
    text: lines.join('\n'),
  };
}

function buildUnloadWhatsApp({ customer, unload, company }) {
  const unloadLines = unloadBagLines(unload);
  const previewBrand = unloadLines.length === 1
    ? unloadLines[0].replace(' has been unloaded.', ' unloaded')
    : `${unloadLines.length} brands unloaded`;

  const lines = [
    messageHeader({ company, title: 'Delivery unloaded' }),
    `Shop: ${customer.name}`,
    `Date: ${formatDate(unload.date)}`,
    '',
    ...unloadLines,
  ];
  if (unload.driverName) lines.push('', `Driver: ${unload.driverName}`);
  if (unload.note) lines.push(`Note: ${unload.note}`);
  lines.push('');
  lines.push('This is an automated notification from your cement distributor account.');
  return {
    preview: `${previewBrand} · ${customer.name}`,
    text: lines.join('\n'),
  };
}

module.exports = {
  buildBillWhatsApp,
  buildPaymentWhatsApp,
  buildPromotionWhatsApp,
  buildChequeReturnWhatsApp,
  buildOverdueBalanceWhatsApp,
  buildUnloadWhatsApp,
};
