/** Shared helpers for customer tax invoice settings. */

export function purchaserTaxName(customer) {
  return String(customer?.purchaserTaxName ?? customer?.name ?? '').trim();
}

export function purchaserTaxAddress(customer) {
  return String(customer?.purchaserTaxAddress ?? customer?.location ?? '').trim();
}

export function purchaserTaxPhone(customer) {
  return String(customer?.purchaserTaxPhone ?? customer?.contactNumber ?? '').trim();
}

export function supplierTaxAddress(shop) {
  const lines = [shop?.addressLine1, shop?.addressLine2].map((s) => String(s ?? '').trim()).filter(Boolean);
  return lines.join(', ');
}

export function isTaxInvoiceReady(customer, shop) {
  if (!customer?.taxInvoicesEnabled) return false;
  if (!String(customer?.purchaserTin ?? '').trim()) return false;
  if (!String(shop?.supplierTin ?? '').trim()) return false;
  if (!String(shop?.shopName ?? '').trim()) return false;
  return true;
}

export function taxInvoiceMissingReason(customer, shop) {
  if (!customer?.taxInvoicesEnabled) return 'Tax invoices are not enabled for this customer.';
  if (!String(customer?.purchaserTin ?? '').trim()) return 'Purchaser TIN is missing.';
  if (!String(shop?.supplierTin ?? '').trim()) return 'Supplier TIN is missing — set it on the Shop page.';
  if (!String(shop?.shopName ?? '').trim()) return 'Shop name is missing — set it on the Shop page.';
  return null;
}

export const emptyCustomerTaxForm = () => ({
  taxInvoicesEnabled: false,
  purchaserTin: '',
  purchaserTaxName: '',
  purchaserTaxAddress: '',
  purchaserTaxPhone: '',
  placeOfSupply: '',
  taxAdditionalInfo: '',
});

export function customerToTaxForm(customer) {
  if (!customer) return emptyCustomerTaxForm();
  return {
    taxInvoicesEnabled: Boolean(customer.taxInvoicesEnabled),
    purchaserTin: customer.purchaserTin ?? '',
    purchaserTaxName: customer.purchaserTaxName ?? customer.name ?? '',
    purchaserTaxAddress: customer.purchaserTaxAddress ?? customer.location ?? '',
    purchaserTaxPhone: customer.purchaserTaxPhone ?? customer.contactNumber ?? '',
    placeOfSupply: customer.placeOfSupply ?? '',
    taxAdditionalInfo: customer.taxAdditionalInfo ?? '',
  };
}
