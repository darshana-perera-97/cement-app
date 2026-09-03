import { useCallback, useEffect, useState } from 'react';
import { canEditDetails } from '../auth';
import { notifyShopCollectorSettingsChanged } from './useShopCollectorSettings';
import { getApiBase } from '../apiBase';
import { clearShopNameCache } from '../shopConfig';
import { LoadingSpinner, modalPanelClass, modalPanelClassMd, scrollTableWrap, stickyThead } from './tableToolbar';
import RowDetailModal from './RowDetailModal';
import CollectorCommissionSection from './CollectorCommissionSection';
import { useBagProducts } from './BagProductsContext';

const apiBase = getApiBase();

const emptyShop = () => ({
  shopName: '',
  addressLine1: '',
  addressLine2: '',
  contactNumber: '',
  email: '',
  ownerName: '',
  registrationNo: '',
  dealerCode: '',
  dealerTagline: '',
  deliveryNote: '',
  supplierTin: '',
  collectorSeparateBillSettlement: false,
});

let listLineSeq = 0;
function newListLine(name = '', prefix = 'line') {
  listLineSeq += 1;
  return { key: `${prefix}-${Date.now()}-${listLineSeq}`, name };
}

function distributorLocations(d) {
  if (Array.isArray(d?.locations) && d.locations.length > 0) {
    return d.locations.map((l) => String(l ?? '').trim()).filter(Boolean);
  }
  const single = String(d?.location ?? '').trim();
  return single ? [single] : [];
}

const emptyDistributorForm = () => ({
  name: '',
  email: '',
  contact: '',
  locations: [newListLine('', 'loc')],
  selectedProducts: [],
});

const emptyLorryForm = () => ({
  number: '',
  note: '',
});

const BANK_ACCOUNT_TYPES = ['Savings', 'Current', 'Fixed deposit', 'Other'];

const emptyBankAccountForm = () => ({
  nickName: '',
  bank: '',
  accountNumber: '',
  accountType: 'Savings',
});

function formFromBankAccount(a) {
  return {
    nickName: a.nickName ?? '',
    bank: a.bank ?? '',
    accountNumber: a.accountNumber ?? '',
    accountType: BANK_ACCOUNT_TYPES.includes(a.accountType) ? a.accountType : 'Savings',
  };
}

function formFromDistributor(d) {
  const locations = distributorLocations(d);
  const selectedProducts = Array.isArray(d.products) ? d.products.filter((p) => String(p ?? '').trim()) : [];
  return {
    name: d.name ?? '',
    email: d.email ?? '',
    contact: d.contact ?? '',
    locations: locations.length > 0 ? locations.map((l) => newListLine(String(l), 'loc')) : [newListLine('', 'loc')],
    selectedProducts: selectedProducts.map((p) => String(p).trim()),
  };
}

const emptyProductForm = () => ({
  name: '',
  code: '',
});

function normalizeProductCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function suggestNextProductCode(products, excludeId = '') {
  const skip = String(excludeId ?? '').trim();
  let max = 0;
  let prefix = 'P-';
  let width = 4;
  for (const p of Array.isArray(products) ? products : []) {
    if (skip && String(p.id) === skip) continue;
    const raw = normalizeProductCode(p.code);
    if (!raw) continue;
    const m = /^(.*?)(\d+)$/.exec(raw);
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n) || n < max) continue;
    max = n;
    prefix = m[1] || 'P-';
    width = Math.max(m[2].length, 1);
  }
  const taken = new Set(
    (Array.isArray(products) ? products : [])
      .filter((p) => !skip || String(p.id) !== skip)
      .map((p) => normalizeProductCode(p.code).toLowerCase())
      .filter(Boolean),
  );
  let nextNum = max + 1;
  let next = `${prefix}${String(nextNum).padStart(width, '0')}`;
  while (taken.has(next.toLowerCase())) {
    nextNum += 1;
    next = `${prefix}${String(nextNum).padStart(width, '0')}`;
  }
  return next;
}

const inputClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';

function displayValue(value) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function listPayload(lines) {
  return (lines || []).map((l) => String(l.name ?? '').trim()).filter(Boolean);
}

export default function ShopPage() {
  const { refresh: refreshBagProducts } = useBagProducts();
  const [shop, setShop] = useState(emptyShop);
  const [shopProducts, setShopProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyShop);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [distributors, setDistributors] = useState([]);
  const [distLoading, setDistLoading] = useState(true);
  const [distError, setDistError] = useState(null);
  const [distModalOpen, setDistModalOpen] = useState(false);
  const [distModalMode, setDistModalMode] = useState('add');
  const [editingDistId, setEditingDistId] = useState(null);
  const [distForm, setDistForm] = useState(emptyDistributorForm);
  const [distSaving, setDistSaving] = useState(false);
  const [distSaveError, setDistSaveError] = useState(null);
  const [detailDistributor, setDetailDistributor] = useState(null);

  const [lorries, setLorries] = useState([]);
  const [lorryLoading, setLorryLoading] = useState(true);
  const [lorryError, setLorryError] = useState(null);
  const [lorryModalOpen, setLorryModalOpen] = useState(false);
  const [lorryModalMode, setLorryModalMode] = useState('add');
  const [editingLorryId, setEditingLorryId] = useState(null);
  const [lorryForm, setLorryForm] = useState(emptyLorryForm);
  const [lorrySaving, setLorrySaving] = useState(false);
  const [lorrySaveError, setLorrySaveError] = useState(null);
  const [detailLorry, setDetailLorry] = useState(null);

  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [bankModalMode, setBankModalMode] = useState('add');
  const [editingBankAccountId, setEditingBankAccountId] = useState(null);
  const [bankForm, setBankForm] = useState(emptyBankAccountForm);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankSaveError, setBankSaveError] = useState(null);
  const [detailBankAccount, setDetailBankAccount] = useState(null);
  const [collectorSeparateBillSettlementDraft, setCollectorSeparateBillSettlementDraft] = useState(false);
  const [supplierTinDraft, setSupplierTinDraft] = useState('');
  const [taxSaving, setTaxSaving] = useState(false);
  const [taxSaveError, setTaxSaveError] = useState(null);
  const [collectorSettingsSaving, setCollectorSettingsSaving] = useState(false);
  const [collectorSettingsError, setCollectorSettingsError] = useState(null);

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productModalMode, setProductModalMode] = useState('add');
  const [editingProductId, setEditingProductId] = useState(null);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [productSaving, setProductSaving] = useState(false);
  const [productSaveError, setProductSaveError] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/shop`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to load shop details');
        setShop(emptyShop());
        setBankAccounts([]);
        setShopProducts([]);
        return;
      }
      const collectorSeparateBillSettlement = Boolean(data.collectorSeparateBillSettlement);
      setShop({
        shopName: data.shopName ?? '',
        addressLine1: data.addressLine1 ?? '',
        addressLine2: data.addressLine2 ?? '',
        contactNumber: data.contactNumber ?? '',
        email: data.email ?? '',
        ownerName: data.ownerName ?? '',
        registrationNo: data.registrationNo ?? '',
        dealerCode: data.dealerCode ?? '',
        dealerTagline: data.dealerTagline ?? '',
        deliveryNote: data.deliveryNote ?? '',
        supplierTin: data.supplierTin ?? '',
        collectorSeparateBillSettlement,
        collectorCommissionRates: data.collectorCommissionRates ?? {},
      });
      setCollectorSeparateBillSettlementDraft(collectorSeparateBillSettlement);
      setSupplierTinDraft(data.supplierTin ?? '');
      setBankAccounts(Array.isArray(data.bankAccounts) ? data.bankAccounts : []);
      setShopProducts(Array.isArray(data.products) ? data.products : []);
    } catch {
      setError('Could not reach the server');
      setShop(emptyShop());
      setBankAccounts([]);
      setShopProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDistributors = useCallback(async () => {
    setDistLoading(true);
    setDistError(null);
    try {
      const res = await fetch(`${apiBase}/api/distributors`);
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setDistError((data && data.error) || 'Failed to load suppliers');
        setDistributors([]);
        return;
      }
      setDistributors(Array.isArray(data) ? data : []);
    } catch {
      setDistError('Could not reach the server');
      setDistributors([]);
    } finally {
      setDistLoading(false);
    }
  }, []);

  const loadLorries = useCallback(async () => {
    setLorryLoading(true);
    setLorryError(null);
    try {
      const res = await fetch(`${apiBase}/api/lorries`);
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setLorryError((data && data.error) || 'Failed to load lorries');
        setLorries([]);
        return;
      }
      setLorries(Array.isArray(data) ? data : []);
    } catch {
      setLorryError('Could not reach the server');
      setLorries([]);
    } finally {
      setLorryLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadDistributors();
    loadLorries();
  }, [load, loadDistributors, loadLorries]);

  const openEdit = () => {
    setForm({ ...shop });
    setSaveError(null);
    setModalOpen(true);
  };

  const closeEdit = () => {
    if (saving) return;
    setModalOpen(false);
    setSaveError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/shop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopName: form.shopName.trim(),
          addressLine1: form.addressLine1.trim(),
          addressLine2: form.addressLine2.trim(),
          contactNumber: form.contactNumber.trim(),
          email: form.email.trim(),
          ownerName: form.ownerName.trim(),
          registrationNo: form.registrationNo.trim(),
          dealerCode: form.dealerCode.trim(),
          dealerTagline: form.dealerTagline.trim(),
          deliveryNote: form.deliveryNote.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      const collectorSeparateBillSettlement = Boolean(data.collectorSeparateBillSettlement);
      setShop({
        shopName: data.shopName ?? '',
        addressLine1: data.addressLine1 ?? '',
        addressLine2: data.addressLine2 ?? '',
        contactNumber: data.contactNumber ?? '',
        email: data.email ?? '',
        ownerName: data.ownerName ?? '',
        registrationNo: data.registrationNo ?? '',
        dealerCode: data.dealerCode ?? '',
        dealerTagline: data.dealerTagline ?? '',
        deliveryNote: data.deliveryNote ?? '',
        supplierTin: data.supplierTin ?? '',
        collectorSeparateBillSettlement,
        collectorCommissionRates: data.collectorCommissionRates ?? {},
      });
      setCollectorSeparateBillSettlementDraft(collectorSeparateBillSettlement);
      clearShopNameCache();
      setModalOpen(false);
    } catch {
      setSaveError('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  const openDistModal = () => {
    setDistModalMode('add');
    setEditingDistId(null);
    setDistForm(emptyDistributorForm());
    setDistSaveError(null);
    setDistModalOpen(true);
  };

  const openEditDistModal = (d) => {
    setDistModalMode('edit');
    setEditingDistId(d.id);
    setDistForm(formFromDistributor(d));
    setDistSaveError(null);
    setDistModalOpen(true);
  };

  const closeDistModal = () => {
    if (distSaving) return;
    setDistModalOpen(false);
    setDistSaveError(null);
    setEditingDistId(null);
  };

  const handleListChange = (field, key, value) => {
    setDistForm((f) => ({
      ...f,
      [field]: f[field].map((p) => (p.key === key ? { ...p, name: value } : p)),
    }));
  };

  const addListLine = (field, prefix) => {
    setDistForm((f) => ({ ...f, [field]: [...f[field], newListLine('', prefix)] }));
  };

  const removeListLine = (field, key, prefix) => {
    setDistForm((f) => {
      const next = f[field].filter((p) => p.key !== key);
      return { ...f, [field]: next.length > 0 ? next : [newListLine('', prefix)] };
    });
  };

  // Keep stable names for location row actions (avoids stale HMR breakage).
  const addLocationLine = () => addListLine('locations', 'loc');
  const removeLocationLine = (key) => removeListLine('locations', key, 'loc');
  const handleLocationChange = (key, value) => handleListChange('locations', key, value);

  const toggleDistProduct = (productName) => {
    const name = String(productName ?? '').trim();
    if (!name) return;
    setDistForm((f) => {
      const selected = f.selectedProducts || [];
      const key = name.toLowerCase();
      const has = selected.some((p) => p.toLowerCase() === key);
      return {
        ...f,
        selectedProducts: has
          ? selected.filter((p) => p.toLowerCase() !== key)
          : [...selected, name],
      };
    });
  };

  const handleDistSubmit = async (e) => {
    e.preventDefault();
    setDistSaving(true);
    setDistSaveError(null);
    const locations = listPayload(distForm.locations);
    if (locations.length === 0) {
      setDistSaveError('Add at least one location.');
      setDistSaving(false);
      return;
    }
    const payload = {
      name: distForm.name.trim(),
      locations,
      email: distForm.email.trim(),
      contact: distForm.contact.trim(),
      products: (distForm.selectedProducts || []).map((p) => String(p).trim()).filter(Boolean),
    };
    try {
      const isEdit = distModalMode === 'edit' && editingDistId;
      const res = await fetch(
        isEdit ? `${apiBase}/api/distributors/${encodeURIComponent(editingDistId)}` : `${apiBase}/api/distributors`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDistSaveError(data.error || 'Save failed');
        return;
      }
      await loadDistributors();
      await refreshBagProducts();
      setDistModalOpen(false);
      setEditingDistId(null);
    } catch {
      setDistSaveError('Could not reach the server');
    } finally {
      setDistSaving(false);
    }
  };

  const openLorryModal = () => {
    setLorryModalMode('add');
    setEditingLorryId(null);
    setLorryForm(emptyLorryForm());
    setLorrySaveError(null);
    setLorryModalOpen(true);
  };

  const openEditLorryModal = (lorry) => {
    setLorryModalMode('edit');
    setEditingLorryId(lorry.id);
    setLorryForm({
      number: lorry.number ?? '',
      note: lorry.note ?? '',
    });
    setLorrySaveError(null);
    setLorryModalOpen(true);
  };

  const closeLorryModal = () => {
    if (lorrySaving) return;
    setLorryModalOpen(false);
    setLorrySaveError(null);
    setEditingLorryId(null);
  };

  const handleLorrySubmit = async (e) => {
    e.preventDefault();
    setLorrySaving(true);
    setLorrySaveError(null);
    const payload = {
      number: lorryForm.number.trim(),
      note: lorryForm.note.trim(),
    };
    if (!payload.number) {
      setLorrySaveError('Enter a lorry number.');
      setLorrySaving(false);
      return;
    }
    try {
      const isEdit = lorryModalMode === 'edit' && editingLorryId;
      const res = await fetch(
        isEdit ? `${apiBase}/api/lorries/${encodeURIComponent(editingLorryId)}` : `${apiBase}/api/lorries`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLorrySaveError(data.error || 'Save failed');
        return;
      }
      await loadLorries();
      setLorryModalOpen(false);
      setEditingLorryId(null);
    } catch {
      setLorrySaveError('Could not reach the server');
    } finally {
      setLorrySaving(false);
    }
  };

  const openBankAccountModal = () => {
    setBankModalMode('add');
    setEditingBankAccountId(null);
    setBankForm(emptyBankAccountForm());
    setBankSaveError(null);
    setBankModalOpen(true);
  };

  const openEditBankAccountModal = (account) => {
    setBankModalMode('edit');
    setEditingBankAccountId(account.id);
    setBankForm(formFromBankAccount(account));
    setBankSaveError(null);
    setBankModalOpen(true);
  };

  const closeBankAccountModal = () => {
    if (bankSaving) return;
    setBankModalOpen(false);
    setBankSaveError(null);
    setEditingBankAccountId(null);
  };

  const handleBankAccountSubmit = async (e) => {
    e.preventDefault();
    setBankSaving(true);
    setBankSaveError(null);
    const payload = {
      nickName: bankForm.nickName.trim(),
      bank: bankForm.bank.trim(),
      accountNumber: bankForm.accountNumber.trim(),
      accountType: bankForm.accountType,
    };
    try {
      const isEdit = bankModalMode === 'edit' && editingBankAccountId;
      const res = await fetch(
        isEdit
          ? `${apiBase}/api/shop/bank-accounts/${encodeURIComponent(editingBankAccountId)}`
          : `${apiBase}/api/shop/bank-accounts`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBankSaveError(data.error || 'Save failed');
        return;
      }
      await load();
      setBankModalOpen(false);
      setEditingBankAccountId(null);
    } catch {
      setBankSaveError('Could not reach the server');
    } finally {
      setBankSaving(false);
    }
  };

  const handleDeleteBankAccount = async (account) => {
    if (!account?.id) return;
    if (!window.confirm(`Remove bank account "${account.nickName || account.bank}"?`)) return;
    try {
      const res = await fetch(`${apiBase}/api/shop/bank-accounts/${encodeURIComponent(account.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || 'Could not remove account');
        return;
      }
      await load();
    } catch {
      window.alert('Could not reach the server');
    }
  };

  const openProductModal = () => {
    setProductModalMode('add');
    setEditingProductId(null);
    setProductForm({ name: '', code: suggestNextProductCode(shopProducts) });
    setProductSaveError(null);
    setProductModalOpen(true);
  };

  const openEditProductModal = (product) => {
    setProductModalMode('edit');
    setEditingProductId(product.id);
    setProductForm({
      name: product.name ?? '',
      code: normalizeProductCode(product.code) || suggestNextProductCode(shopProducts, product.id),
    });
    setProductSaveError(null);
    setProductModalOpen(true);
  };

  const closeProductModal = () => {
    if (productSaving) return;
    setProductModalOpen(false);
    setProductSaveError(null);
    setEditingProductId(null);
  };

  const handleProductSubmit = async (e) => {
    e.preventDefault();
    setProductSaving(true);
    setProductSaveError(null);
    const payload = {
      name: productForm.name.trim(),
      code: normalizeProductCode(productForm.code),
    };
    if (!payload.name) {
      setProductSaveError('Enter a product name.');
      setProductSaving(false);
      return;
    }
    if (!payload.code) {
      setProductSaveError('Enter a product code.');
      setProductSaving(false);
      return;
    }
    const excludeId = productModalMode === 'edit' ? editingProductId : null;
    const nameTaken = shopProducts.some(
      (p) => p.name.toLowerCase() === payload.name.toLowerCase() && (!excludeId || p.id !== excludeId),
    );
    if (nameTaken) {
      setProductSaveError('A product with this name already exists.');
      setProductSaving(false);
      return;
    }
    const codeTaken = shopProducts.some(
      (p) =>
        normalizeProductCode(p.code).toLowerCase() === payload.code.toLowerCase() &&
        (!excludeId || p.id !== excludeId),
    );
    if (codeTaken) {
      setProductSaveError('A product with this code already exists.');
      setProductSaving(false);
      return;
    }
    try {
      const isEdit = productModalMode === 'edit' && editingProductId;
      const res = await fetch(
        isEdit
          ? `${apiBase}/api/shop/products/${encodeURIComponent(editingProductId)}`
          : `${apiBase}/api/shop/products`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProductSaveError(data.error || 'Save failed');
        return;
      }
      await load();
      await refreshBagProducts();
      setProductModalOpen(false);
      setEditingProductId(null);
    } catch {
      setProductSaveError('Could not reach the server');
    } finally {
      setProductSaving(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!product?.id) return;
    if (!window.confirm(`Remove product "${product.name}"? Suppliers using it will keep the name until you edit them.`)) return;
    try {
      const res = await fetch(`${apiBase}/api/shop/products/${encodeURIComponent(product.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || 'Could not remove product');
        return;
      }
      await load();
      await refreshBagProducts();
    } catch {
      window.alert('Could not reach the server');
    }
  };

  const collectorSettingsDirty =
    collectorSeparateBillSettlementDraft !== Boolean(shop.collectorSeparateBillSettlement);

  const handleSaveCollectorSettings = async () => {
    setCollectorSettingsSaving(true);
    setCollectorSettingsError(null);
    try {
      const res = await fetch(`${apiBase}/api/shop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...shop,
          collectorSeparateBillSettlement: collectorSeparateBillSettlementDraft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCollectorSettingsError(data.error || 'Could not save collector settings');
        return;
      }
      const saved = Boolean(data.collectorSeparateBillSettlement);
      setShop((s) => ({
        ...s,
        collectorSeparateBillSettlement: saved,
      }));
      setCollectorSeparateBillSettlementDraft(saved);
      notifyShopCollectorSettingsChanged();
    } catch {
      setCollectorSettingsError('Could not reach the server');
    } finally {
      setCollectorSettingsSaving(false);
    }
  };

  const taxSettingsDirty = supplierTinDraft.trim() !== String(shop.supplierTin ?? '').trim();

  const handleSaveTaxSettings = async () => {
    setTaxSaving(true);
    setTaxSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/shop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...shop,
          supplierTin: supplierTinDraft.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTaxSaveError(data.error || 'Could not save tax settings');
        return;
      }
      const savedTin = String(data.supplierTin ?? '').trim();
      setShop((s) => ({ ...s, supplierTin: savedTin }));
      setSupplierTinDraft(savedTin);
    } catch {
      setTaxSaveError('Could not reach the server');
    } finally {
      setTaxSaving(false);
    }
  };

  const addressLines = [shop.addressLine1, shop.addressLine2]
    .map((line) => String(line ?? '').trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-slate-500">
          {canEditDetails() ? 'View your shop details. Use Edit to update and save.' : 'View your shop details.'}
        </p>
        {canEditDetails() ? (
          <button
            type="button"
            onClick={openEdit}
            disabled={loading}
            className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:bg-indigo-700 disabled:opacity-60 sm:w-auto"
          >
            Edit details
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
          <h2 className="text-sm font-bold text-slate-900">Shop details</h2>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Shop name</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{displayValue(shop.shopName)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Address</dt>
              <dd className="mt-1 text-sm text-slate-800">
                {addressLines.length > 0 ? (
                  addressLines.map((line, i) => (
                    <p key={i} className="leading-relaxed">
                      {line}
                    </p>
                  ))
                ) : (
                  <p>—</p>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Contact number</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(shop.contactNumber)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Email</dt>
              <dd className="mt-1 break-all text-sm text-slate-800">{displayValue(shop.email)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Owner name</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(shop.ownerName)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Registration no.</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(shop.registrationNo)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Dealer code</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(shop.dealerCode)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">PO letterhead tagline</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(shop.dealerTagline)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">PO delivery note</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(shop.deliveryNote || 'Door Step')}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
        <h2 className="text-sm font-bold text-slate-900">Tax invoice (supplier)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Supplier details printed on customer tax invoices. Name, address, and telephone come from
          shop details above.
        </p>
        {taxSaveError ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {taxSaveError}
          </p>
        ) : null}
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Supplier name</dt>
            <dd className="mt-1 text-sm text-slate-800">{displayValue(shop.shopName)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Telephone</dt>
            <dd className="mt-1 text-sm text-slate-800">{displayValue(shop.contactNumber)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Address</dt>
            <dd className="mt-1 text-sm text-slate-800">
              {addressLines.length > 0 ? addressLines.join(', ') : '—'}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="supplier-tin">
              Supplier&apos;s TIN
            </label>
            <input
              id="supplier-tin"
              className={inputClass}
              value={supplierTinDraft}
              onChange={(e) => setSupplierTinDraft(e.target.value)}
              disabled={loading || taxSaving}
              placeholder="Tax identification number"
            />
          </div>
        </dl>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSaveTaxSettings}
            disabled={loading || taxSaving || !taxSettingsDirty}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
          >
            {taxSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
        <h2 className="text-sm font-bold text-slate-900">Collector settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Control how collectors record customer payments in the field.
        </p>
        {collectorSettingsError ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {collectorSettingsError}
          </p>
        ) : null}
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50/90 p-4 ring-1 ring-slate-100">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
            checked={collectorSeparateBillSettlementDraft}
            disabled={loading || collectorSettingsSaving}
            onChange={(e) => setCollectorSeparateBillSettlementDraft(e.target.checked)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">Separate bill settlement</span>
            <span className="mt-1 block text-sm leading-relaxed text-slate-600">
              When enabled, collectors record cash or cheque payments in two steps: payment details first,
              then allocate the total across pending invoices (partial amounts allowed). Collectors may settle
              any selected invoices — oldest bills do not need to be paid first.
            </span>
          </span>
        </label>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSaveCollectorSettings}
            disabled={loading || collectorSettingsSaving || !collectorSettingsDirty}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
          >
            {collectorSettingsSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Bank accounts</h2>
            <p className="mt-1 text-sm text-slate-500">
              Shop bank accounts for deposits and payments. Add as many as you need.
            </p>
          </div>
          <button
            type="button"
            onClick={openBankAccountModal}
            disabled={loading}
            className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] disabled:opacity-60 sm:w-auto"
          >
            Add bank account
          </button>
        </div>

        <div className={scrollTableWrap}>
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Nick name</th>
                <th className="px-4 py-3">Bank</th>
                <th className="px-4 py-3 font-mono">Account number</th>
                <th className="px-4 py-3">Account type</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : bankAccounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    No bank accounts yet. Use &quot;Add bank account&quot; to create one.
                  </td>
                </tr>
              ) : (
                bankAccounts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-semibold text-slate-900">{displayValue(a.nickName)}</td>
                    <td className="px-4 py-3">{displayValue(a.bank)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums">
                      {displayValue(a.accountNumber)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{displayValue(a.accountType)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailBankAccount(a)}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                        >
                          View
                        </button>
                        {canEditDetails() ? (
                          <button
                            type="button"
                            onClick={() => openEditBankAccountModal(a)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleDeleteBankAccount(a)}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Products</h2>
            <p className="mt-1 text-sm text-slate-500">
              Bag products your shop sells or buys. Suppliers pick from this list when you add or edit them.
            </p>
          </div>
          <button
            type="button"
            onClick={openProductModal}
            disabled={loading}
            className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] disabled:opacity-60 sm:w-auto"
          >
            Add product
          </button>
        </div>

        <div className={scrollTableWrap}>
          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Product name</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : shopProducts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    No products yet. Use &quot;Add product&quot; to create your catalog.
                  </td>
                </tr>
              ) : (
                shopProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold tabular-nums text-indigo-800">
                      {displayValue(p.code)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{displayValue(p.name)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailProduct(p)}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                        >
                          View
                        </button>
                        {canEditDetails() ? (
                          <button
                            type="button"
                            onClick={() => openEditProductModal(p)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleDeleteProduct(p)}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Suppliers</h2>
            <p className="mt-1 text-sm text-slate-500">Suppliers you buy from. Use Edit to manage locations and assign products from the catalog above.</p>
          </div>
          <button
            type="button"
            onClick={openDistModal}
            className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
          >
            Add supplier
          </button>
        </div>

        {distError ? (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {distError}
          </p>
        ) : null}

        <div className={scrollTableWrap}>
          <table className="w-full min-w-[420px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact number</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {distLoading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : distributors.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    No suppliers yet. Use &quot;Add supplier&quot; to create a record.
                  </td>
                </tr>
              ) : (
                distributors.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-semibold text-slate-900">{displayValue(d.name)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{displayValue(d.contact)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <div className="inline-flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailDistributor(d)}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                        >
                          View
                        </button>
                        {canEditDetails() ? (
                          <button
                            type="button"
                            onClick={() => openEditDistModal(d)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Lorries</h2>
            <p className="mt-1 text-sm text-slate-500">
              Fleet vehicles used on Loads and Purchase Orders. Add plate numbers here.
            </p>
          </div>
          <button
            type="button"
            onClick={openLorryModal}
            className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
          >
            Add lorry
          </button>
        </div>

        {lorryError ? (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {lorryError}
          </p>
        ) : null}

        <div className={scrollTableWrap}>
          <table className="w-full min-w-[420px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Lorry number</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {lorryLoading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : lorries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    No lorries yet. Use &quot;Add lorry&quot; to create a record.
                  </td>
                </tr>
              ) : (
                lorries.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-semibold tabular-nums text-slate-900">
                      {displayValue(l.number)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{displayValue(l.note)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <div className="inline-flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailLorry(l)}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                        >
                          View
                        </button>
                        {canEditDetails() ? (
                          <button
                            type="button"
                            onClick={() => openEditLorryModal(l)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-edit-modal-title"
          onClick={closeEdit}
        >
          <div className={modalPanelClassMd} onClick={(e) => e.stopPropagation()}>
            <h2 id="shop-edit-modal-title" className="text-lg font-bold text-slate-900">
              Edit shop details
            </h2>
            <p className="mt-1 text-xs text-slate-500">Changes are saved to shopData.json on the server.</p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-name">
                  Shop name
                </label>
                <input
                  id="shop-name"
                  className={inputClass}
                  value={form.shopName}
                  onChange={(e) => setForm((f) => ({ ...f, shopName: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-address-1">
                  Address line 1
                </label>
                <input
                  id="shop-address-1"
                  className={inputClass}
                  value={form.addressLine1}
                  onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-address-2">
                  Address line 2
                </label>
                <input
                  id="shop-address-2"
                  className={inputClass}
                  value={form.addressLine2}
                  onChange={(e) => setForm((f) => ({ ...f, addressLine2: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-contact">
                  Contact number
                </label>
                <input
                  id="shop-contact"
                  type="tel"
                  className={inputClass}
                  value={form.contactNumber}
                  onChange={(e) => setForm((f) => ({ ...f, contactNumber: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-email">
                  Email
                </label>
                <input
                  id="shop-email"
                  type="email"
                  className={inputClass}
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-owner">
                  Owner name
                </label>
                <input
                  id="shop-owner"
                  className={inputClass}
                  value={form.ownerName}
                  onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-reg">
                  Registration no.
                </label>
                <input
                  id="shop-reg"
                  className={inputClass}
                  value={form.registrationNo}
                  onChange={(e) => setForm((f) => ({ ...f, registrationNo: e.target.value }))}
                  disabled={saving}
                  placeholder="e.g. 28001570"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-dealer-code">
                  Dealer code
                </label>
                <input
                  id="shop-dealer-code"
                  className={inputClass}
                  value={form.dealerCode}
                  onChange={(e) => setForm((f) => ({ ...f, dealerCode: e.target.value }))}
                  disabled={saving}
                  placeholder="e.g. 80440"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-tagline">
                  PO letterhead tagline
                </label>
                <input
                  id="shop-tagline"
                  className={inputClass}
                  value={form.dealerTagline}
                  onChange={(e) => setForm((f) => ({ ...f, dealerTagline: e.target.value }))}
                  disabled={saving}
                  placeholder="Authorized dealer for the products of Tokyo Cement Company Lanka PLC"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="shop-delivery-note">
                  PO delivery note
                </label>
                <input
                  id="shop-delivery-note"
                  className={inputClass}
                  value={form.deliveryNote}
                  onChange={(e) => setForm((f) => ({ ...f, deliveryNote: e.target.value }))}
                  disabled={saving}
                  placeholder="Door Step"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {distModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="distributor-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeDistModal}
          />
          <div className={modalPanelClass}>
            <h2 id="distributor-modal-title" className="text-lg font-bold text-slate-900">
              {distModalMode === 'edit' ? 'Edit supplier' : 'Add supplier'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Name, contact, and at least one location are required. Assign products from your catalog below.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleDistSubmit}>
              {distSaveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {distSaveError}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                  Name
                  <input
                    type="text"
                    required
                    value={distForm.name}
                    onChange={(e) => setDistForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputClass}
                    placeholder="e.g. Tokyo Super Cement"
                    autoComplete="organization"
                    disabled={distSaving}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Contact
                  <input
                    type="tel"
                    required
                    value={distForm.contact}
                    onChange={(e) => setDistForm((f) => ({ ...f, contact: e.target.value }))}
                    className={inputClass}
                    placeholder="e.g. 077 123 4567"
                    autoComplete="tel"
                    disabled={distSaving}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Email
                  <input
                    type="email"
                    value={distForm.email}
                    onChange={(e) => setDistForm((f) => ({ ...f, email: e.target.value }))}
                    className={inputClass}
                    placeholder="optional@example.com"
                    autoComplete="email"
                    disabled={distSaving}
                  />
                </label>
              </div>

              <div className="space-y-3 rounded-xl bg-slate-50/90 p-4 ring-1 ring-slate-100">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">Locations</p>
                  <button
                    type="button"
                    onClick={addLocationLine}
                    disabled={distSaving}
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:opacity-60"
                  >
                    + Add location
                  </button>
                </div>
                <div className="space-y-2">
                  {distForm.locations.map((line, index) => (
                    <div key={line.key} className="flex items-start gap-2">
                      <label className="block min-w-0 flex-1 text-sm font-medium text-slate-600">
                        <span className="sr-only">Location {index + 1}</span>
                        <input
                          type="text"
                          value={line.name}
                          onChange={(e) => handleLocationChange(line.key, e.target.value)}
                          className={inputClass}
                          placeholder={`Location ${index + 1} (e.g. Colombo depot)`}
                          disabled={distSaving}
                        />
                      </label>
                      {distForm.locations.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeLocationLine(line.key)}
                          disabled={distSaving}
                          className="mt-1 shrink-0 rounded-lg px-2 py-2 text-xs font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500">At least one location is required.</p>
              </div>

              <div className="space-y-3 rounded-xl bg-slate-50/90 p-4 ring-1 ring-slate-100">
                <p className="text-sm font-semibold text-slate-800">Products</p>
                {shopProducts.length === 0 ? (
                  <p className="text-sm text-amber-800">
                    Add products in the Products section above before assigning them to this supplier.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {shopProducts.map((p) => {
                      const name = String(p.name ?? '').trim();
                      const checked = (distForm.selectedProducts || []).some(
                        (sel) => sel.toLowerCase() === name.toLowerCase(),
                      );
                      return (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200 transition hover:ring-indigo-200"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
                            checked={checked}
                            disabled={distSaving}
                            onChange={() => toggleDistProduct(name)}
                          />
                          <span className="min-w-0 text-sm font-medium text-slate-800">
                            {p.code ? (
                              <span className="mr-1.5 font-mono text-xs font-semibold text-indigo-700">{p.code}</span>
                            ) : null}
                            {name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-slate-500">Select which catalog products this supplier provides. Optional — you can assign later.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeDistModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  disabled={distSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={distSaving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:brightness-[1.03] disabled:opacity-60"
                >
                  {distSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {productModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeProductModal}
          />
          <div className={modalPanelClassMd}>
            <h2 id="product-modal-title" className="text-lg font-bold text-slate-900">
              {productModalMode === 'edit' ? 'Edit product' : 'Add product'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Products appear in Loads, Bills, Stock, and supplier assignments across the app.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleProductSubmit}>
              {productSaveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {productSaveError}
                </p>
              ) : null}
              <label className="block text-sm font-medium text-slate-600">
                Product code
                <input
                  type="text"
                  required
                  value={productForm.code}
                  onChange={(e) =>
                    setProductForm((f) => ({ ...f, code: normalizeProductCode(e.target.value) }))
                  }
                  className={`${inputClass} font-mono uppercase`}
                  placeholder="P-0001"
                  disabled={productSaving}
                  autoComplete="off"
                  maxLength={24}
                />
                <span className="mt-1 block text-xs font-normal text-slate-400">
                  {productModalMode === 'edit'
                    ? 'Must be unique. You can keep or change the current code.'
                    : 'Suggested from the last product code (+1). Must be unique — you can edit it.'}
                </span>
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Product name
                <input
                  type="text"
                  required
                  value={productForm.name}
                  onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputClass}
                  placeholder="e.g. Tokyo 50kg"
                  disabled={productSaving}
                  autoComplete="off"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeProductModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  disabled={productSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={productSaving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:brightness-[1.03] disabled:opacity-60"
                >
                  {productSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {bankModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bank-account-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeBankAccountModal}
          />
          <div className={modalPanelClassMd}>
            <h2 id="bank-account-modal-title" className="text-lg font-bold text-slate-900">
              {bankModalMode === 'edit' ? 'Edit bank account' : 'Add bank account'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">Saved with your shop details on the server.</p>
            <form className="mt-5 space-y-4" onSubmit={handleBankAccountSubmit}>
              {bankSaveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {bankSaveError}
                </p>
              ) : null}
              <label className="block text-sm font-medium text-slate-600">
                Nick name
                <input
                  type="text"
                  required
                  value={bankForm.nickName}
                  onChange={(e) => setBankForm((f) => ({ ...f, nickName: e.target.value }))}
                  className={inputClass}
                  placeholder="e.g. Main counter"
                  disabled={bankSaving}
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Bank
                <input
                  type="text"
                  required
                  value={bankForm.bank}
                  onChange={(e) => setBankForm((f) => ({ ...f, bank: e.target.value }))}
                  className={inputClass}
                  placeholder="e.g. Commercial Bank"
                  disabled={bankSaving}
                  autoComplete="organization"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Account number
                <input
                  type="text"
                  required
                  value={bankForm.accountNumber}
                  onChange={(e) => setBankForm((f) => ({ ...f, accountNumber: e.target.value }))}
                  className={`${inputClass} font-mono`}
                  placeholder="Account number"
                  disabled={bankSaving}
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Account type
                <select
                  required
                  value={bankForm.accountType}
                  onChange={(e) => setBankForm((f) => ({ ...f, accountType: e.target.value }))}
                  className={inputClass}
                  disabled={bankSaving}
                >
                  {BANK_ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeBankAccountModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  disabled={bankSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bankSaving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:brightness-[1.03] disabled:opacity-60"
                >
                  {bankSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {lorryModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lorry-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeLorryModal}
          />
          <div className={modalPanelClassMd}>
            <h2 id="lorry-modal-title" className="text-lg font-bold text-slate-900">
              {lorryModalMode === 'edit' ? 'Edit lorry' : 'Add lorry'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Lorry numbers appear in Loads and Purchase Order vehicle lists.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleLorrySubmit}>
              {lorrySaveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {lorrySaveError}
                </p>
              ) : null}
              <label className="block text-sm font-medium text-slate-600">
                Lorry number
                <input
                  type="text"
                  required
                  value={lorryForm.number}
                  onChange={(e) => setLorryForm((f) => ({ ...f, number: e.target.value }))}
                  className={inputClass}
                  placeholder="e.g. ABC 1234"
                  disabled={lorrySaving}
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Note <span className="font-normal text-slate-400">(optional)</span>
                <input
                  type="text"
                  value={lorryForm.note}
                  onChange={(e) => setLorryForm((f) => ({ ...f, note: e.target.value }))}
                  className={inputClass}
                  placeholder="e.g. Main haulage"
                  disabled={lorrySaving}
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeLorryModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  disabled={lorrySaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={lorrySaving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:brightness-[1.03] disabled:opacity-60"
                >
                  {lorrySaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RowDetailModal
        open={!!detailProduct}
        row={
          detailProduct
            ? { code: detailProduct.code || '—', name: detailProduct.name }
            : null
        }
        title="Product details"
        subtitle={detailProduct?.code || null}
        onClose={() => setDetailProduct(null)}
      />
      <RowDetailModal
        open={!!detailDistributor}
        row={detailDistributor}
        variant="distributor"
        onClose={() => setDetailDistributor(null)}
      />
      <RowDetailModal
        open={!!detailLorry}
        row={detailLorry}
        variant="lorry"
        onClose={() => setDetailLorry(null)}
      />
      <RowDetailModal
        open={!!detailBankAccount}
        row={detailBankAccount}
        onClose={() => setDetailBankAccount(null)}
      />

      <CollectorCommissionSection
        shop={shop}
        onShopUpdate={(data) => setShop((s) => ({ ...s, ...data }))}
      />
    </div>
  );
}
