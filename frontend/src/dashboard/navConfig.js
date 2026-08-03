export const MANAGER_ACCESS_OPTIONS = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'requests', label: 'Requests' },
  { key: 'reports', label: 'Reports' },
  { key: 'customers', label: 'Customers' },
  { key: 'shop', label: 'Shop' },
  { key: 'loads', label: 'Loads' },
  { key: 'purchase-orders', label: 'Purchase Order' },
  { key: 'bills', label: 'Bills' },
  { key: 'payments', label: 'Payments' },
  { key: 'bank', label: 'Cash Book' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'messages', label: 'Messages' },
  { key: 'incentive', label: 'Incentive' },
  { key: 'stock', label: 'Stock' },
];

export const ALL_MANAGER_ACCESS_KEYS = MANAGER_ACCESS_OPTIONS.map((o) => o.key);

export const COLLECTOR_ACCESS_KEYS = ['customers', 'stock', 'pending-cheques', 'overdue-bills', 'payments'];

/** Route segment (under /dashboard) → access key */
export const DASHBOARD_ROUTE_ACCESS = {
  analytics: 'analytics',
  requests: 'requests',
  reports: 'reports',
  customers: 'customers',
  shop: 'shop',
  stock: 'stock',
  loads: 'loads',
  'purchase-orders': 'purchase-orders',
  bills: 'bills',
  payments: 'payments',
  bank: 'bank',
  promotions: 'promotions',
  messages: 'messages',
  incentive: 'incentive',
  'overdue-bills': 'overdue-bills',
  'pending-cheques': 'pending-cheques',
};

export const DASHBOARD_NAV = [
  {
    to: '/dashboard/analytics',
    label: 'Analytics',
    icon: 'chart',
    accessKey: 'analytics',
  },
  {
    to: '/dashboard/requests',
    label: 'Requests',
    icon: 'requests',
    accessKey: 'requests',
  },
  {
    to: '/dashboard/reports',
    label: 'Reports',
    icon: 'report',
    accessKey: 'reports',
  },
  {
    to: '/dashboard/customers',
    label: 'Customers',
    icon: 'users',
    accessKey: 'customers',
  },
  {
    to: '/dashboard/overdue-bills',
    label: 'Overdue bills',
    icon: 'overdue',
    accessKey: 'overdue-bills',
  },
  {
    to: '/dashboard/pending-cheques',
    label: 'Pending cheques',
    icon: 'cheque',
    accessKey: 'pending-cheques',
  },
  {
    to: '/dashboard/shop',
    label: 'Shop',
    icon: 'shop',
    accessKey: 'shop',
  },
  {
    to: '/dashboard/loads',
    label: 'Loads',
    icon: 'truck',
    accessKey: 'loads',
  },
  {
    to: '/dashboard/purchase-orders',
    label: 'Purchase Order',
    icon: 'purchase-order',
    accessKey: 'purchase-orders',
  },
  {
    to: '/dashboard/bills',
    label: 'Bills',
    icon: 'receipt',
    accessKey: 'bills',
  },
  {
    to: '/dashboard/payments',
    label: 'Payments',
    icon: 'wallet',
    accessKey: 'payments',
  },
  {
    to: '/dashboard/bank',
    label: 'Cash Book',
    icon: 'bank',
    accessKey: 'bank',
  },
  {
    to: '/dashboard/promotions',
    label: 'Promotions',
    icon: 'gift',
    accessKey: 'promotions',
  },
  {
    to: '/dashboard/messages',
    label: 'Messages',
    icon: 'messages',
    accessKey: 'messages',
  },
  {
    to: '/dashboard/users',
    label: 'Users',
    icon: 'user',
  },
  {
    to: '/dashboard/incentive',
    label: 'Incentive',
    icon: 'incentive',
    accessKey: 'incentive',
  },
  {
    to: '/dashboard/stock',
    label: 'Stock',
    icon: 'box',
    accessKey: 'stock',
  },
];
