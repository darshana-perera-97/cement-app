import { getDisplayName, getUsername, isCollector } from '../auth';

/** Signed-in collector's name. Empty when the session only has the login ID / NIC. */
export function collectorPrintName() {
  if (!isCollector()) return '';
  const name = String(getDisplayName() ?? '').trim();
  const loginId = String(getUsername() ?? '').trim();
  if (!name || (loginId && name.toLowerCase() === loginId.toLowerCase())) return '';
  return name;
}

/**
 * Name to print on an invoice. Uses the collector who recorded it when the
 * server sent that name, otherwise the collector who is printing. Never an ID.
 */
export function invoiceCollectorName(record) {
  const fromRecord = String(record?.collectorName ?? '').trim();
  const loginId = String(getUsername() ?? '').trim();
  if (fromRecord && (!loginId || fromRecord.toLowerCase() !== loginId.toLowerCase())) return fromRecord;
  return collectorPrintName();
}

/** "Collected by" on a payment receipt: collector name, not their login ID. */
export function collectedByPrintLabel(payment) {
  const fromRecord = String(payment?.collectorName ?? '').trim();
  const recorded = String(payment?.recordedBy ?? '').trim();
  const loginId = String(getUsername() ?? '').trim();
  const sessionName = collectorPrintName();
  if (fromRecord && (!loginId || fromRecord.toLowerCase() !== loginId.toLowerCase())) return fromRecord;
  if (sessionName && (!recorded || recorded.toLowerCase() === loginId.toLowerCase())) return sessionName;
  if (isCollector() && recorded && loginId && recorded.toLowerCase() === loginId.toLowerCase()) return '';
  return recorded;
}
