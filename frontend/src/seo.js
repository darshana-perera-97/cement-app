import { useEffect, useState } from 'react';
import { DEFAULT_SHOP_NAME, fetchShopName } from './shopConfig';

function titleForPath(pathname, brand) {
  const normalized = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const rules = [
    { test: (p) => p === '/login', title: `Sign in — ${brand}` },
    { test: (p) => p === '/unloads', title: `Driver unloads — ${brand}` },
    {
      test: (p) => p === '/dashboard' || p === '/dashboard/',
      title: `Dashboard — ${brand}`,
    },
    { test: (p) => p === '/dashboard/analytics', title: `Analytics — ${brand}` },
    { test: (p) => p === '/dashboard/requests', title: `Requests — ${brand}` },
    { test: (p) => p === '/dashboard/reports', title: `Reports — ${brand}` },
    { test: (p) => p === '/dashboard/customers', title: `Customers — ${brand}` },
    {
      test: (p) => p.startsWith('/dashboard/customers/'),
      title: `Customer account — ${brand}`,
    },
    { test: (p) => p === '/dashboard/shop', title: `Shop — ${brand}` },
    { test: (p) => p === '/dashboard/stock', title: `Stock — ${brand}` },
    { test: (p) => p === '/dashboard/loads', title: `Loads — ${brand}` },
    { test: (p) => p === '/dashboard/purchase-orders', title: `Purchase Order — ${brand}` },
    { test: (p) => p === '/dashboard/bills', title: `Bills — ${brand}` },
    { test: (p) => p === '/dashboard/payments', title: `Payments — ${brand}` },
    { test: (p) => p === '/dashboard/bank', title: `Bank — ${brand}` },
    { test: (p) => p === '/dashboard/promotions', title: `Promotions — ${brand}` },
    { test: (p) => p === '/dashboard/messages', title: `Messages — ${brand}` },
    { test: (p) => p === '/dashboard/users', title: `Users — ${brand}` },
    { test: (p) => p === '/dashboard/incentive', title: `Incentive — ${brand}` },
  ];
  const rule = rules.find((r) => r.test(normalized));
  return rule ? rule.title : `Cement supply dashboard — ${brand}`;
}

/** Default browser tab title; index.html should stay aligned for first paint. */
export const DEFAULT_DOCUMENT_TITLE = `Cement supply dashboard — ${DEFAULT_SHOP_NAME}`;

export function useDocumentTitle(pathname) {
  const [brand, setBrand] = useState(DEFAULT_SHOP_NAME);

  useEffect(() => {
    let cancelled = false;
    fetchShopName().then((name) => {
      if (!cancelled) setBrand(name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = titleForPath(pathname, brand);
  }, [pathname, brand]);
}
