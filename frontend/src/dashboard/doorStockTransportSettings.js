export const EMPTY_BRAND_DOOR_STOCK_SETTINGS = {
  companyName: '',
  companyAddress: '',
  companyTel: '',
  nextInvoiceNumber: '',
  clientName: '',
  clientAddress: '',
  from: '',
  to: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankName: '',
  bankBranch: '',
};

export const EMPTY_DOOR_STOCK_TRANSPORT_SETTINGS = {
  companyName: '',
  companyAddress: '',
  companyTel: '',
  clientName: '',
  clientAddress: '',
  destination: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankName: '',
  bankBranch: '',
  nextInvoiceNumber: '',
  brandSettings: {},
  brandLocations: {},
};

function trim(value) {
  return String(value ?? '').trim();
}

function globalFallbackFrom(source = {}) {
  return {
    companyName: trim(source.companyName),
    companyAddress: trim(source.companyAddress),
    companyTel: trim(source.companyTel),
    clientName: trim(source.clientName),
    clientAddress: trim(source.clientAddress),
    destination: trim(source.destination),
    bankAccountName: trim(source.bankAccountName),
    bankAccountNumber: trim(source.bankAccountNumber),
    bankName: trim(source.bankName),
    bankBranch: trim(source.bankBranch),
    nextInvoiceNumber: trim(source.nextInvoiceNumber),
  };
}

function normalizeBrandEntry(val = {}, global = {}) {
  const from = trim(val.from);
  const to = trim(val.to) || trim(global.destination);
  return {
    companyName: trim(val.companyName) || trim(global.companyName),
    companyAddress: trim(val.companyAddress) || trim(global.companyAddress),
    companyTel: trim(val.companyTel) || trim(global.companyTel),
    nextInvoiceNumber: trim(val.nextInvoiceNumber) || trim(global.nextInvoiceNumber),
    clientName: trim(val.clientName) || trim(global.clientName),
    clientAddress: trim(val.clientAddress) || trim(global.clientAddress),
    from,
    to,
    bankAccountName: trim(val.bankAccountName) || trim(global.bankAccountName),
    bankAccountNumber: trim(val.bankAccountNumber) || trim(global.bankAccountNumber),
    bankName: trim(val.bankName) || trim(global.bankName),
    bankBranch: trim(val.bankBranch) || trim(global.bankBranch),
  };
}

/** Normalize saved settings and ensure each bag type has a full settings object. */
export function normalizeDoorStockTransportSettings(source, brands = []) {
  const global = globalFallbackFrom(source || {});
  const brandSettings = {};

  const rawSettings =
    source?.brandSettings && typeof source.brandSettings === 'object' ? source.brandSettings : {};
  for (const [key, val] of Object.entries(rawSettings)) {
    const k = trim(key);
    if (!k) continue;
    brandSettings[k] = normalizeBrandEntry(val, global);
  }

  const rawLocations =
    source?.brandLocations && typeof source.brandLocations === 'object' ? source.brandLocations : {};
  for (const [key, val] of Object.entries(rawLocations)) {
    const k = trim(key);
    if (!k) continue;
    brandSettings[k] = normalizeBrandEntry(
      {
        ...(brandSettings[k] || {}),
        from: brandSettings[k]?.from || val?.from,
        to: brandSettings[k]?.to || val?.to,
      },
      global,
    );
  }

  for (const b of brands) {
    if (!brandSettings[b.key]) {
      brandSettings[b.key] = normalizeBrandEntry({}, global);
    }
  }

  const brandLocations = {};
  for (const [key, val] of Object.entries(brandSettings)) {
    brandLocations[key] = { from: val.from, to: val.to };
  }

  return {
    ...global,
    brandSettings,
    brandLocations,
  };
}

/** Resolved letterhead, client, destinations, and bank details for one bag type. */
export function resolveBrandDoorStockSettings(settings, brandKey) {
  const global = globalFallbackFrom(settings || {});
  const brand = settings?.brandSettings?.[brandKey];
  if (brand) return normalizeBrandEntry(brand, global);
  const loc = settings?.brandLocations?.[brandKey] || {};
  return normalizeBrandEntry({ from: loc.from, to: loc.to }, global);
}

/** Pick export settings from filter, rows, or global fallback. */
export function resolveDoorStockExportSettings(settings, { brandKey = '', rows = [] } = {}) {
  const key =
    trim(brandKey) ||
    trim(rows[0]?.brandKey) ||
    '';
  if (key) return resolveBrandDoorStockSettings(settings, key);
  return globalFallbackFrom(settings || {});
}
