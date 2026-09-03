/** Visual theme palettes — cycled for distributor-configured products. */
export const THEME_PALETTES = [
  {
    accent: 'from-violet-500 to-indigo-600',
    ring: 'ring-violet-100',
    iconBg: 'bg-violet-50 text-violet-700',
    ledger: {
      head: 'border-l-2 border-violet-300/70 bg-violet-50 text-violet-900',
      sub: 'border-l border-violet-200/80 bg-violet-50/80 text-violet-800',
      cellLead: 'border-l-2 border-violet-200/80 bg-violet-50/50',
      cell: 'border-l border-violet-100/70 bg-violet-50/40',
    },
  },
  {
    accent: 'from-sky-500 to-blue-600',
    ring: 'ring-sky-100',
    iconBg: 'bg-sky-50 text-sky-700',
    ledger: {
      head: 'border-l-2 border-sky-300/70 bg-sky-50 text-sky-950',
      sub: 'border-l border-sky-200/80 bg-sky-50/80 text-sky-900',
      cellLead: 'border-l-2 border-sky-200/80 bg-sky-50/50',
      cell: 'border-l border-sky-100/70 bg-sky-50/40',
    },
  },
  {
    accent: 'from-amber-500 to-orange-600',
    ring: 'ring-amber-100',
    iconBg: 'bg-amber-50 text-amber-800',
    ledger: {
      head: 'border-l-2 border-amber-300/70 bg-amber-50 text-amber-950',
      sub: 'border-l border-amber-200/80 bg-amber-50/80 text-amber-900',
      cellLead: 'border-l-2 border-amber-200/80 bg-amber-50/50',
      cell: 'border-l border-amber-100/70 bg-amber-50/40',
    },
  },
  {
    accent: 'from-rose-500 to-pink-600',
    ring: 'ring-rose-100',
    iconBg: 'bg-rose-50 text-rose-700',
    ledger: {
      head: 'border-l-2 border-rose-300/70 bg-rose-50 text-rose-950',
      sub: 'border-l border-rose-200/80 bg-rose-50/80 text-rose-900',
      cellLead: 'border-l-2 border-rose-200/80 bg-rose-50/50',
      cell: 'border-l border-rose-100/70 bg-rose-50/40',
    },
  },
  {
    accent: 'from-emerald-500 to-teal-600',
    ring: 'ring-emerald-100',
    iconBg: 'bg-emerald-50 text-emerald-800',
    ledger: {
      head: 'border-l-2 border-emerald-300/70 bg-emerald-50 text-emerald-950',
      sub: 'border-l border-emerald-200/80 bg-emerald-50/80 text-emerald-900',
      cellLead: 'border-l-2 border-emerald-200/80 bg-emerald-50/50',
      cell: 'border-l border-emerald-100/70 bg-emerald-50/40',
    },
  },
  {
    accent: 'from-fuchsia-500 to-purple-600',
    ring: 'ring-fuchsia-100',
    iconBg: 'bg-fuchsia-50 text-fuchsia-800',
    ledger: {
      head: 'border-l-2 border-fuchsia-300/70 bg-fuchsia-50 text-fuchsia-950',
      sub: 'border-l border-fuchsia-200/80 bg-fuchsia-50/80 text-fuchsia-900',
      cellLead: 'border-l-2 border-fuchsia-200/80 bg-fuchsia-50/50',
      cell: 'border-l border-fuchsia-100/70 bg-fuchsia-50/40',
    },
  },
];

/** Distinct hex fills for charts — one per catalog product, cycled by index. */
export const BRAND_BAR_PALETTE = [
  '#7c3aed',
  '#0284c7',
  '#d97706',
  '#e11d48',
  '#059669',
  '#c026d3',
  '#2563eb',
  '#ea580c',
  '#4f46e5',
  '#0d9488',
  '#db2777',
  '#65a30d',
  '#9333ea',
  '#0891b2',
  '#b45309',
  '#be123c',
  '#047857',
  '#1d4ed8',
  '#c2410c',
  '#6d28d9',
  '#15803d',
  '#0369a1',
];

export function brandBarColor(keyOrIndex, index = 0) {
  const i = typeof keyOrIndex === 'number' ? keyOrIndex : index;
  return BRAND_BAR_PALETTE[Math.abs(i) % BRAND_BAR_PALETTE.length];
}

function slugifyProductName(name) {
  return (
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
  );
}

/**
 * Map a purchase-order product name to the matching bag-product key.
 * Uses exact label / key / slug only — substring matches like "tokyo" inside
 * "Tokyo Superbond …" would otherwise load stock onto the wrong product.
 */
export function productToBrandKey(product, brands) {
  const raw = String(product || '').trim();
  if (!raw || !Array.isArray(brands) || brands.length === 0) return null;
  const p = raw.toLowerCase();
  const slug = slugifyProductName(raw);

  for (const b of brands) {
    if (String(b.label || '').trim().toLowerCase() === p) return b.key;
  }
  for (const b of brands) {
    const k = String(b.key || '').toLowerCase();
    if (k && (k === p || (slug && k === slug))) return b.key;
  }
  return null;
}

export function formatBrandLabel(brand) {
  const label = String(brand?.label ?? '').trim();
  const code = String(brand?.code ?? '').trim();
  if (code && label) return `${code} · ${label}`;
  return code || label || '';
}

/** Resolve a stored product name (e.g. on a PO) to `CODE · name` when the catalog has a code. */
export function formatProductNameWithCode(productName, brands = getCachedBrands()) {
  const raw = String(productName ?? '').trim();
  if (!raw) return '';
  const key = productToBrandKey(raw, brands);
  if (!key) return raw;
  const brand = brands.find((b) => b.key === key);
  return brand ? formatBrandLabel(brand) || raw : raw;
}

/** Build themed brand rows from `/api/bag-products` payload. */
export function buildBrands(products) {
  const list = Array.isArray(products) ? products : [];
  return list.map((p, i) => {
    const theme = THEME_PALETTES[i % THEME_PALETTES.length];
    return {
      key: p.key,
      label: p.label,
      code: String(p.code ?? '').trim(),
      bagsField: p.bagsField || `${p.key}Bags`,
      costField: p.costField || `${p.key}Cost`,
      cutOffPriceField: p.cutOffPriceField || `${p.key}CutOffPrice`,
      unitPriceField: p.unitPriceField || `${p.key}UnitPrice`,
      invoiceField: p.invoiceField || `${p.key}Invoice`,
      chequeField: p.chequeField || `${p.key}Cheque`,
      convertingDateField: p.convertingDateField || `${p.key}ConvertingDate`,
      ...theme,
    };
  });
}

/** @deprecated Use `useBagProducts()` — kept for modules that read synchronously before context loads. */
let _cachedBrands = [];

export function setCachedBrands(brands) {
  _cachedBrands = Array.isArray(brands) ? brands : [];
}

export function getCachedBrands() {
  return _cachedBrands;
}

/** @deprecated Use `useBagProducts().brands` instead. */
export const BRANDS = new Proxy([], {
  get(target, prop) {
    const brands = _cachedBrands;
    if (prop === 'length') return brands.length;
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return brands[Number(prop)];
    const value = brands[prop];
    if (value !== undefined) return value;
    return Reflect.get(target, prop);
  },
});
