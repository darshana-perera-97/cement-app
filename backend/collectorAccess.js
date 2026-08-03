/** Fixed dashboard sections collectors may access. */
const COLLECTOR_ACCESS_KEYS = ['customers', 'stock', 'pending-cheques', 'overdue-bills', 'payments'];

function getEffectiveCollectorAccess() {
  return [...COLLECTOR_ACCESS_KEYS];
}

module.exports = {
  COLLECTOR_ACCESS_KEYS,
  getEffectiveCollectorAccess,
};
