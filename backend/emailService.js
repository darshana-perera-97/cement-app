const nodemailer = require('nodemailer');
const { readEmailConfig } = require('./emailConfigsStore');
const { readCompanyData } = require('./companyDataStore');
const { appendSentEmail } = require('./sentEmailsStore');
const { buildBillEmail, buildPaymentEmail, buildPromotionEmail } = require('./emailTemplates');

async function createTransporter(config) {
  if (!config.host || !config.user || !config.pass) return null;
  return nodemailer.createTransport({
    host: config.host,
    port: Number(config.port) || 587,
    secure: Boolean(config.secure),
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

async function sendCustomerEmail({ type, customer, record, remainingAmount }) {
  const email = String(customer?.email ?? '').trim();
  if (!email) return null;

  const [config, company] = await Promise.all([readEmailConfig(), readCompanyData()]);
  if (!config.enabled) return null;

  const transporter = await createTransporter(config);
  if (!transporter) {
    await appendSentEmail({
      type,
      to: email,
      customerName: customer.name,
      subject: `${type} notification`,
      status: 'failed',
      error: 'SMTP is not fully configured',
      referenceId: record.id,
    });
    return null;
  }

  let built;
  switch (type) {
    case 'bill':
      built = buildBillEmail({ customer, bill: record, remainingAmount, company });
      break;
    case 'payment':
      built = buildPaymentEmail({ customer, payment: record, remainingAmount, company });
      break;
    case 'promotion':
      built = buildPromotionEmail({ customer, promotion: record, company });
      break;
    default:
      return null;
  }

  const fromName = String(config.fromName ?? company.distributor ?? '').trim() || String(process.env.SHOP_NAME || 'CS Store').trim() || 'CS Store';
  const fromAddress = String(config.from ?? config.user ?? '').trim();

  try {
    await transporter.sendMail({
      from: fromAddress ? `"${fromName}" <${fromAddress}>` : undefined,
      to: email,
      subject: built.subject,
      html: built.html,
    });
    await appendSentEmail({
      type,
      to: email,
      customerName: customer.name,
      subject: built.subject,
      status: 'sent',
      error: null,
      referenceId: record.id,
    });
    return { ok: true };
  } catch (err) {
    console.error(`email notification (${type})`, err);
    await appendSentEmail({
      type,
      to: email,
      customerName: customer.name,
      subject: built.subject,
      status: 'failed',
      error: err.message || 'Send failed',
      referenceId: record.id,
    });
    return { ok: false, error: err.message };
  }
}

function notifyBillEmail(customer, bill, remainingAmount) {
  return sendCustomerEmail({ type: 'bill', customer, record: bill, remainingAmount });
}

function notifyPaymentEmail(customer, payment, remainingAmount) {
  return sendCustomerEmail({ type: 'payment', customer, record: payment, remainingAmount });
}

function notifyPromotionEmail(customer, promotion) {
  return sendCustomerEmail({ type: 'promotion', customer, record: promotion });
}

module.exports = {
  notifyBillEmail,
  notifyPaymentEmail,
  notifyPromotionEmail,
  sendCustomerEmail,
};
