import { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, canEditDetails, getUsername } from '../auth';
import { LoadingSpinner, modalPanelClass } from './tableToolbar';
import { customerToTaxForm, emptyCustomerTaxForm, isTaxInvoiceReady, taxInvoiceMissingReason } from './customerTaxUtils';

const apiBase = getApiBase();

const inputClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

export default function CustomerTaxModal({ open, customer, customerId, onClose, onSaved }) {
  const [form, setForm] = useState(emptyCustomerTaxForm);
  const [shop, setShop] = useState(null);
  const [loadingShop, setLoadingShop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!open || !customer) return;
    setForm(customerToTaxForm(customer));
    setSaveError(null);
  }, [open, customer]);

  const loadShop = useCallback(async () => {
    setLoadingShop(true);
    try {
      const res = await fetch(`${apiBase}/api/shop`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setShop(data);
      else setShop(null);
    } catch {
      setShop(null);
    } finally {
      setLoadingShop(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadShop();
  }, [open, loadShop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    if (!canEditDetails()) {
      setSaveError('Only admins can update tax settings.');
      return;
    }
    if (!customerId) return;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await authFetch(`${apiBase}/api/customers/${encodeURIComponent(customerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updatedBy: username,
          taxInvoicesEnabled: Boolean(form.taxInvoicesEnabled),
          purchaserTin: form.purchaserTin.trim(),
          purchaserTaxName: form.purchaserTaxName.trim(),
          purchaserTaxAddress: form.purchaserTaxAddress.trim(),
          purchaserTaxPhone: form.purchaserTaxPhone.trim(),
          placeOfSupply: form.placeOfSupply.trim(),
          taxAdditionalInfo: form.taxAdditionalInfo.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      onSaved?.();
      onClose();
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const previewCustomer = {
    ...customer,
    taxInvoicesEnabled: form.taxInvoicesEnabled,
    purchaserTin: form.purchaserTin.trim(),
    purchaserTaxName: form.purchaserTaxName.trim(),
    purchaserTaxAddress: form.purchaserTaxAddress.trim(),
    purchaserTaxPhone: form.purchaserTaxPhone.trim(),
    placeOfSupply: form.placeOfSupply.trim(),
    taxAdditionalInfo: form.taxAdditionalInfo.trim(),
  };
  const ready = isTaxInvoiceReady(previewCustomer, shop);
  const missingReason = taxInvoiceMissingReason(previewCustomer, shop);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-tax-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full flex-col overflow-hidden !p-0 sm:max-w-lg`}>
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div
            className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden"
            aria-hidden
          />
          <h2 id="customer-tax-title" className="text-lg font-bold text-slate-900 sm:text-xl">
            Tax — {customer?.name || 'Customer'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Enable tax invoices and enter purchaser details for VAT documents.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50/90 p-4 ring-1 ring-slate-100">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
                checked={form.taxInvoicesEnabled}
                disabled={saving || !canEditDetails()}
                onChange={(e) => handleChange('taxInvoicesEnabled', e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">Enable tax invoices</span>
                <span className="mt-1 block text-sm leading-relaxed text-slate-600">
                  When enabled and details are complete, each invoice in the Invoices popup can be
                  downloaded as a tax invoice PDF.
                </span>
              </span>
            </label>

            {form.taxInvoicesEnabled ? (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600" htmlFor="purchaser-tin">
                    Purchaser&apos;s TIN <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="purchaser-tin"
                    className={inputClass}
                    value={form.purchaserTin}
                    onChange={(e) => handleChange('purchaserTin', e.target.value)}
                    disabled={saving || !canEditDetails()}
                    placeholder="Tax identification number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600" htmlFor="purchaser-name">
                    Purchaser&apos;s name
                  </label>
                  <input
                    id="purchaser-name"
                    className={inputClass}
                    value={form.purchaserTaxName}
                    onChange={(e) => handleChange('purchaserTaxName', e.target.value)}
                    disabled={saving || !canEditDetails()}
                    placeholder={customer?.name || 'Legal / registered name'}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600" htmlFor="purchaser-address">
                    Address
                  </label>
                  <textarea
                    id="purchaser-address"
                    rows={2}
                    className={inputClass}
                    value={form.purchaserTaxAddress}
                    onChange={(e) => handleChange('purchaserTaxAddress', e.target.value)}
                    disabled={saving || !canEditDetails()}
                    placeholder={customer?.location || 'Billing address'}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600" htmlFor="purchaser-phone">
                    Telephone no.
                  </label>
                  <input
                    id="purchaser-phone"
                    className={inputClass}
                    value={form.purchaserTaxPhone}
                    onChange={(e) => handleChange('purchaserTaxPhone', e.target.value)}
                    disabled={saving || !canEditDetails()}
                    placeholder={customer?.contactNumber || ''}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600" htmlFor="place-of-supply">
                    Place of supply (default)
                  </label>
                  <input
                    id="place-of-supply"
                    className={inputClass}
                    value={form.placeOfSupply}
                    onChange={(e) => handleChange('placeOfSupply', e.target.value)}
                    disabled={saving || !canEditDetails()}
                    placeholder={customer?.location || 'Delivery / supply location'}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600" htmlFor="tax-additional-info">
                    Additional information (default)
                  </label>
                  <textarea
                    id="tax-additional-info"
                    rows={2}
                    className={inputClass}
                    value={form.taxAdditionalInfo}
                    onChange={(e) => handleChange('taxAdditionalInfo', e.target.value)}
                    disabled={saving || !canEditDetails()}
                    placeholder="Optional note on tax invoices"
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-5 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supplier (from Shop page)</p>
              {loadingShop ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                  <LoadingSpinner /> Loading shop details…
                </p>
              ) : (
                <dl className="mt-2 space-y-1 text-sm text-slate-700">
                  <div>
                    <dt className="inline font-medium">TIN : </dt>
                    <dd className="inline">{shop?.supplierTin?.trim() || '— (set on Shop page)'}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Name : </dt>
                    <dd className="inline">{shop?.shopName?.trim() || '—'}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Address : </dt>
                    <dd className="inline">
                      {[shop?.addressLine1, shop?.addressLine2].filter((s) => String(s ?? '').trim()).join(', ') ||
                        '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Tel : </dt>
                    <dd className="inline">{shop?.contactNumber?.trim() || '—'}</dd>
                  </div>
                </dl>
              )}
            </div>

            {form.taxInvoicesEnabled ? (
              <p
                className={`mt-3 rounded-xl px-3 py-2 text-sm ring-1 ${
                  ready
                    ? 'bg-emerald-50 text-emerald-800 ring-emerald-100'
                    : 'bg-amber-50 text-amber-900 ring-amber-100'
                }`}
              >
                {ready
                  ? 'Tax invoice download is ready for this customer.'
                  : missingReason || 'Complete the required details to enable tax invoice downloads.'}
              </p>
            ) : null}

            {saveError ? (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto sm:py-2.5"
              >
                Cancel
              </button>
              {canEditDetails() ? (
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md disabled:opacity-60 sm:w-auto sm:py-2.5"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
