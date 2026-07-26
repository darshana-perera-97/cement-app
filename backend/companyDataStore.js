const fs = require('fs').promises;
const path = require('path');

const COMPANY_DATA_FILE = path.join(__dirname, 'data', 'companyData.json');

const DEFAULT_COMPANY_DATA = {
  distributor: 'Chaminda Stores - Dummalasuriya',
  company: 'Yokyo Super Cement Distributor',
};

async function readCompanyData() {
  try {
    const raw = await fs.readFile(COMPANY_DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return { ...DEFAULT_COMPANY_DATA, ...data };
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_COMPANY_DATA };
    throw e;
  }
}

async function writeCompanyData(data) {
  await fs.mkdir(path.dirname(COMPANY_DATA_FILE), { recursive: true });
  await fs.writeFile(COMPANY_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  readCompanyData,
  writeCompanyData,
  DEFAULT_COMPANY_DATA,
  COMPANY_DATA_FILE,
};
