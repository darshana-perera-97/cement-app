const fs = require('fs').promises;
const path = require('path');

const CUSTOMERS_FILE = path.join(__dirname, 'data', 'customers.json');

async function readCustomers() {
  try {
    const raw = await fs.readFile(CUSTOMERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeCustomers(records) {
  await fs.mkdir(path.dirname(CUSTOMERS_FILE), { recursive: true });
  await fs.writeFile(CUSTOMERS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function toNonNegMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function todayYmdLocal() {
  const dt = new Date();
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function defaultDueDateYmd() {
  return addDaysYmd(todayYmdLocal(), 30);
}

module.exports = {
  readCustomers,
  writeCustomers,
  toNonNegMoney,
  defaultDueDateYmd,
  CUSTOMERS_FILE,
};
