import { useEffect, useState } from 'react';
import { authFetch } from './auth';
import { getApiBase } from './apiBase';

export const PAYMENT_RECEIPT_SETTINGS_CHANGED = 'payment-receipt-settings-changed';

const STORAGE_KEY = 'cs-store-print-customer-outstanding';

let cachedEnabled = null;
let inflight = null;

function readStoredEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function hasStoredEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw === '1' || raw === '0';
  } catch {
    return false;
  }
}

export function getPrintCustomerOutstandingEnabled() {
  if (cachedEnabled != null) return cachedEnabled;
  return readStoredEnabled();
}

export function setPrintCustomerOutstandingEnabledCache(enabled) {
  cachedEnabled = Boolean(enabled);
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, cachedEnabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function notifyPaymentReceiptSettingsChanged(enabled) {
  if (enabled != null) {
    setPrintCustomerOutstandingEnabledCache(enabled);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PAYMENT_RECEIPT_SETTINGS_CHANGED));
  }
}

export async function fetchPrintCustomerOutstandingEnabled() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/payment-receipt-settings`);
      if (res.ok) {
        const data = await res.json();
        setPrintCustomerOutstandingEnabledCache(Boolean(data.printCustomerOutstanding));
        return Boolean(data.printCustomerOutstanding);
      }
    } catch {
      /* keep cache */
    } finally {
      inflight = null;
    }
    return getPrintCustomerOutstandingEnabled();
  })();
  return inflight;
}

export function usePrintCustomerOutstandingEnabled() {
  const [enabled, setEnabled] = useState(() => getPrintCustomerOutstandingEnabled());
  const [ready, setReady] = useState(() => cachedEnabled != null || hasStoredEnabled());

  useEffect(() => {
    const sync = () => {
      setEnabled(getPrintCustomerOutstandingEnabled());
      setReady(true);
    };
    window.addEventListener(PAYMENT_RECEIPT_SETTINGS_CHANGED, sync);
    return () => window.removeEventListener(PAYMENT_RECEIPT_SETTINGS_CHANGED, sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPrintCustomerOutstandingEnabled().then((value) => {
      if (cancelled) return;
      setEnabled(value);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { enabled, ready };
}

function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.max(0, v) * 100) / 100;
}

function customerMatchesPayment(customer, payment) {
  const customerId = String(payment?.customerId ?? '').trim();
  const customerName = String(payment?.customerName ?? '').trim().toLowerCase();
  if (customerId && String(customer?.id ?? '').trim() === customerId) return true;
  if (!customerId && customerName && String(customer?.name ?? '').trim().toLowerCase() === customerName) {
    return true;
  }
  return false;
}

/**
 * Current total still owed by the customer, or null when the receipt should omit it.
 * Null also covers a failed lookup so a receipt is never printed with a guessed balance.
 */
export async function customerOutstandingForPaymentReceipt(payment) {
  const enabled = await fetchPrintCustomerOutstandingEnabled();
  if (!enabled || !payment) return null;
  try {
    const res = await authFetch(`${getApiBase()}/api/customers`);
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    const match = (Array.isArray(rows) ? rows : []).find((row) => customerMatchesPayment(row, payment));
    if (!match) return null;
    return roundMoney(match.remainingAmount);
  } catch {
    return null;
  }
}
