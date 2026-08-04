/** Dashboard sections a manager may access (matches frontend nav accessKey values). */
const MANAGER_ACCESS_KEYS = [
  'analytics',
  'requests',
  'reports',
  'customers',
  'shop',
  'stock',
  'loads',
  'purchase-orders',
  'bills',
  'payments',
  'bank',
  'promotions',
  'messages',
  'incentive',
];

const KEY_SET = new Set(MANAGER_ACCESS_KEYS);

function normalizeManagerAccessInput(access) {
  if (!Array.isArray(access)) return [];
  return [...new Set(access.map((k) => String(k).trim()).filter((k) => KEY_SET.has(k)))];
}

/** Legacy managers without stored access get full access. */
function getEffectiveManagerAccess(storedAccess) {
  if (storedAccess === undefined || storedAccess === null) {
    return [...MANAGER_ACCESS_KEYS];
  }
  return normalizeManagerAccessInput(storedAccess);
}

module.exports = {
  MANAGER_ACCESS_KEYS,
  normalizeManagerAccessInput,
  getEffectiveManagerAccess,
};
