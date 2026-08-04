const BRAND_LABELS = {
  tokyo: 'Tokyo',
  samudra: 'Samudra',
  atlas: 'Atlas',
  nippon: 'Nippon',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function bagLines(record) {
  const lines = [];
  for (const key of Object.keys(BRAND_LABELS)) {
    const bags = Number(record[`${key}Bags`]) || 0;
    if (bags > 0) {
      const unitPrice = Number(record[`${key}UnitPrice`]);
      const lineTotal = Number(record[`${key}Line`]);
      let detail = `${bags.toLocaleString()} bag${bags === 1 ? '' : 's'}`;
      if (Number.isFinite(unitPrice) && unitPrice > 0) {
        detail += ` @ ${formatMoney(unitPrice)}`;
      }
      if (Number.isFinite(lineTotal) && lineTotal > 0) {
        detail += ` · ${formatMoney(lineTotal)}`;
      }
      lines.push({ label: BRAND_LABELS[key], value: detail });
    }
  }
  return lines;
}

/** Bill emails: bag type and count only (no unit price or line totals). */
function billBagLines(record) {
  const lines = [];
  for (const key of Object.keys(BRAND_LABELS)) {
    const bags = Number(record[`${key}Bags`]) || 0;
    if (bags > 0) {
      lines.push(
        { label: 'Bag type', value: BRAND_LABELS[key] },
        {
          label: 'Bag amount',
          value: `${bags.toLocaleString()} bag${bags === 1 ? '' : 's'}`,
        },
      );
    }
  }
  return lines;
}

function promoBagLines(record) {
  const lines = [];
  for (const key of Object.keys(BRAND_LABELS)) {
    const bags = Number(record[`${key}Bags`]) || 0;
    if (bags > 0) {
      lines.push({
        label: BRAND_LABELS[key],
        value: `${bags.toLocaleString()} free bag${bags === 1 ? '' : 's'}`,
      });
    }
  }
  return lines;
}

function emailLayout({ preheader, accent, accentLight, title, subtitle, rows, highlight, footer, company }) {
  const rowHtml = (rows || [])
    .map(
      (r) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;width:38%;vertical-align:top;">${escapeHtml(r.label)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14px;font-weight:600;text-align:right;vertical-align:top;">${r.html ?? escapeHtml(r.value)}</td>
        </tr>`,
    )
    .join('');

  const highlightHtml = highlight
    ? `
      <div style="margin:24px 0 0;padding:20px 22px;border-radius:14px;background:${accentLight};border:1px solid ${accent}22;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${accent};">${escapeHtml(highlight.label)}</p>
        <p style="margin:0;font-size:28px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">${escapeHtml(highlight.value)}</p>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 0 18px;text-align:center;">
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;">${escapeHtml(company.company)}</p>
              <p style="margin:6px 0 0;font-size:13px;color:#64748b;">${escapeHtml(company.distributor)}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,0.06);border:1px solid #e2e8f0;">
              <div style="height:4px;background:linear-gradient(90deg,${accent},${accent}88);"></div>
              <div style="padding:32px 28px 10px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${accent};">${escapeHtml(subtitle)}</p>
                <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">${escapeHtml(title)}</h1>
              </div>
              <div style="padding:8px 28px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rowHtml}</table>
                ${highlightHtml}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 8px 0;text-align:center;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">${escapeHtml(footer)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildBillEmail({ customer, bill, remainingAmount, company, hideFinancialDetails = false }) {
  const rows = [
    { label: 'Customer', value: customer.name },
    { label: 'Date', value: formatDate(bill.date) },
    ...(hideFinancialDetails ? billBagLines(bill) : bagLines(bill)),
  ];
  if (!hideFinancialDetails) {
    const billTotal = Number(bill.totalAmount);
    if (Number.isFinite(billTotal) && billTotal > 0) {
      rows.push({ label: 'Bill total', value: formatMoney(billTotal) });
    }
  }

  return {
    subject: `Credit sale · ${customer.name}`,
    html: emailLayout({
      preheader: `A new credit sale has been recorded for ${customer.name}.`,
      accent: '#4f46e5',
      accentLight: '#eef2ff',
      title: 'Credit sale recorded',
      subtitle: 'New bill',
      rows,
      highlight: hideFinancialDetails
        ? null
        : {
            label: 'Balance to pay',
            value: formatMoney(remainingAmount),
          },
      footer: 'This is an automated notification from your cement distributor account.',
      company,
    }),
  };
}

function buildPaymentEmail({ customer, payment, remainingAmount, company, hideFinancialDetails = false }) {
  const rows = [
    { label: 'Customer', value: customer.name },
    { label: 'Date', value: formatDate(payment.date) },
  ];
  if (!hideFinancialDetails) {
    rows.push({ label: 'Amount received', value: formatMoney(payment.amount) });
    const cash = Number(payment.cashAmount) || 0;
    if (cash > 0) rows.push({ label: 'Cash', value: formatMoney(cash) });
    if (payment.cheques?.length) {
      const chequeSummary = payment.cheques
        .map((c) => {
          let s = formatMoney(c.amount);
          if (c.chequeNumber) s += ` #${c.chequeNumber}`;
          if (c.chequeDate) s += ` · ${formatDate(c.chequeDate)}`;
          return s;
        })
        .join('; ');
      rows.push({ label: 'Cheques', value: chequeSummary });
    }
  } else if (payment.cheques?.length) {
    const chequeSummary = payment.cheques
      .map((c) => {
        let s = c.chequeNumber ? `#${c.chequeNumber}` : 'Cheque';
        if (c.chequeDate) s += ` · ${formatDate(c.chequeDate)}`;
        return s;
      })
      .join('; ');
    rows.push({ label: 'Cheques', value: chequeSummary });
  }
  if (payment.billNumber) rows.push({ label: 'Receipt no.', value: `#${payment.billNumber}` });
  if (payment.note) rows.push({ label: 'Note', value: payment.note });
  if (payment.recordedBy) rows.push({ label: 'Recorded by', value: payment.recordedBy });

  return {
    subject: hideFinancialDetails
      ? `Payment received · ${customer.name}`
      : `Payment received — ${formatMoney(payment.amount)} · ${customer.name}`,
    html: emailLayout({
      preheader: hideFinancialDetails
        ? `We received your payment. Thank you, ${customer.name}.`
        : `We received your payment of ${formatMoney(payment.amount)}. Thank you, ${customer.name}.`,
      accent: '#059669',
      accentLight: '#ecfdf5',
      title: 'Payment received',
      subtitle: 'Thank you',
      rows,
      highlight: hideFinancialDetails
        ? null
        : {
            label: 'Remaining balance',
            value: formatMoney(remainingAmount),
          },
      footer: 'This is an automated notification from your cement distributor account.',
      company,
    }),
  };
}

function unloadBagLines(record) {
  const lines = [];
  for (const key of Object.keys(BRAND_LABELS)) {
    const bags = Number(record[`${key}Bags`]) || 0;
    if (bags > 0) {
      lines.push({
        label: BRAND_LABELS[key],
        value: `${bags.toLocaleString()} bag${bags === 1 ? '' : 's'}`,
      });
    }
  }
  return lines;
}

function buildUnloadEmail({ customer, unload, company }) {
  const rows = [
    { label: 'Shop', value: customer.name },
    { label: 'Date', value: formatDate(unload.date) },
    ...unloadBagLines(unload),
  ];
  const totalBags = Object.keys(BRAND_LABELS).reduce(
    (sum, key) => sum + (Number(unload[`${key}Bags`]) || 0),
    0,
  );

  return {
    subject: `Delivery unloaded · ${customer.name}`,
    html: emailLayout({
      preheader: `Cement delivery unloaded for ${customer.name}.`,
      accent: '#0284c7',
      accentLight: '#e0f2fe',
      title: 'Delivery unloaded',
      subtitle: 'Delivery confirmation',
      rows,
      highlight:
        totalBags > 0
          ? {
              label: 'Total bags',
              value: `${totalBags.toLocaleString()} bag${totalBags === 1 ? '' : 's'}`,
            }
          : null,
      footer: 'This is an automated notification from your cement distributor account.',
      company,
    }),
  };
}

function buildPromotionEmail({ customer, promotion, company }) {
  const rows = [
    { label: 'Customer', value: customer.name },
    { label: 'Date', value: formatDate(promotion.date) },
    { label: 'Reason', value: promotion.reason },
    ...promoBagLines(promotion),
  ];
  if (promotion.billNumber) rows.push({ label: 'Reference', value: `#${promotion.billNumber}` });
  if (promotion.enteredBy) rows.push({ label: 'Recorded by', value: promotion.enteredBy });

  const totalBags =
    (Number(promotion.tokyoBags) || 0) +
    (Number(promotion.samudraBags) || 0) +
    (Number(promotion.atlasBags) || 0) +
    (Number(promotion.nipponBags) || 0);

  return {
    subject: `Free bags — ${totalBags} bag${totalBags === 1 ? '' : 's'} · ${customer.name}`,
    html: emailLayout({
      preheader: `${totalBags} free cement bag${totalBags === 1 ? '' : 's'} recorded for ${customer.name}.`,
      accent: '#7c3aed',
      accentLight: '#f5f3ff',
      title: 'Free bags recorded',
      subtitle: 'Promotion',
      rows,
      highlight: {
        label: 'Total free bags',
        value: `${totalBags.toLocaleString()} bag${totalBags === 1 ? '' : 's'}`,
      },
      footer: 'This is an automated notification from your cement distributor account.',
      company,
    }),
  };
}

function buildOverdueBalanceEmail({
  customer,
  overdueBills = [],
  totalOverdueAmount = 0,
  totalPendingAmount = 0,
  shareMode = 'both',
  company,
  hideFinancialDetails = false,
}) {
  const rows = [{ label: 'Customer', value: customer.name }];
  const todayYmd = new Date().toISOString().slice(0, 10);
  rows.push({ label: 'Date', value: formatDate(todayYmd) });

  if (overdueBills.length > 0) {
    for (const bill of overdueBills) {
      const label = bill.daysOverdue > 0 ? `Overdue bill (${bill.daysOverdue}d)` : 'Overdue bill';
      const value = `${formatDate(bill.billDate)} · ${formatMoney(bill.outstandingAmount)}${bill.details ? ` · ${bill.details}` : ''}`;
      rows.push({ label, value });
    }
    if (totalOverdueAmount > 0) {
      rows.push({ label: 'Total overdue', value: formatMoney(totalOverdueAmount) });
    }
  }

  let highlight = null;
  if (shareMode === 'pending_only' && totalPendingAmount > 0) {
    highlight = { label: 'Total pending balance', value: formatMoney(totalPendingAmount) };
  } else if (shareMode === 'both' && totalPendingAmount > 0) {
    highlight = { label: 'Total pending balance', value: formatMoney(totalPendingAmount) };
  }

  return {
    subject: `Balance reminder · ${customer.name}`,
    html: emailLayout({
      preheader: `Outstanding balance reminder for ${customer.name}.`,
      accent: '#e11d48',
      accentLight: '#fff1f2',
      title: 'Balance reminder',
      subtitle: 'Outstanding amount',
      rows,
      highlight,
      footer: 'Please arrange payment at your earliest convenience. This is an automated notification from your cement distributor account.',
      company,
    }),
  };
}

module.exports = {
  buildBillEmail,
  buildPaymentEmail,
  buildPromotionEmail,
  buildUnloadEmail,
  buildOverdueBalanceEmail,
};
