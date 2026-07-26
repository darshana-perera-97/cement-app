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

function buildBillWhatsApp({ customer, bill, remainingAmount, company }) {
  const lines = [
    messageHeader({ company, title: 'Credit sale recorded' }),
    `Customer: ${customer.name}`,
    `Date: ${formatDate(bill.date)}`,
    ...billBagLines(bill),
    '',
    `*Balance to pay:* ${formatMoney(remainingAmount)}`,
    '',
    'This is an automated notification from your cement distributor account.',
  ];
  return {
    preview: `Credit sale · ${customer.name}`,
    text: lines.join('\n'),
  };
}

function buildPaymentWhatsApp({ customer, payment, remainingAmount, company }) {
  const lines = [
    messageHeader({ company, title: 'Payment received' }),
    `Customer: ${customer.name}`,
    `Date: ${formatDate(payment.date)}`,
    `Amount received: ${formatMoney(payment.amount)}`,
  ];
  const cash = Number(payment.cashAmount) || 0;
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
  if (payment.billNumber) lines.push(`Receipt no.: #${payment.billNumber}`);
  if (payment.note) lines.push(`Note: ${payment.note}`);
  if (payment.recordedBy) lines.push(`Recorded by: ${payment.recordedBy}`);
  lines.push('');
  lines.push(`*Remaining balance:* ${formatMoney(remainingAmount)}`);
  lines.push('');
  lines.push('This is an automated notification from your cement distributor account.');
  return {
    preview: `Payment received — ${formatMoney(payment.amount)} · ${customer.name}`,
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

module.exports = {
  buildBillWhatsApp,
  buildPaymentWhatsApp,
  buildPromotionWhatsApp,
};
