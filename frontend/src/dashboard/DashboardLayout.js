import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearAuth, getToken, getUsername, hasDashboardAccess, isAdmin, isAuthed, isCollector, isManagerOrAdmin, refreshSessionFromServer, getStaffRole, authFetch } from '../auth';
import { getApiBase } from '../apiBase';
import { shopNameInitials, useShopName } from '../shopConfig';
import { DASHBOARD_NAV } from './navConfig';
import { NavIcon } from './NavIcon';
import { LoadingSpinner } from './tableToolbar';
import { BagProductsProvider } from './BagProductsContext';

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function formatLkr2(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

const KIND_BADGE = {
  load: 'bg-violet-100 text-violet-800',
  bill: 'bg-sky-100 text-sky-900',
  customer: 'bg-emerald-100 text-emerald-900',
  payment: 'bg-amber-100 text-amber-900',
};
const KIND_SHORT = {
  load: 'LD',
  bill: 'BI',
  customer: 'CU',
  payment: 'PY',
};

/** Light tints: green → yellow → orange → red by oldest overdue bill (days past 14-day due). */
const OVERDUE_PRIORITY_CARD = {
  none: 'from-emerald-50 via-green-50 to-teal-50 ring-emerald-200/60 shadow-emerald-500/10',
  low: 'from-lime-50 via-emerald-50 to-green-50 ring-lime-200/60 shadow-lime-500/10',
  moderate: 'from-amber-50 via-yellow-50 to-amber-50/90 ring-amber-200/60 shadow-amber-500/10',
  high: 'from-orange-50 via-amber-50 to-orange-50/90 ring-orange-200/60 shadow-orange-500/10',
  critical: 'from-rose-50 via-red-50/80 to-rose-50 ring-rose-200/60 shadow-rose-500/10',
};

const OVERDUE_PRIORITY_LABEL = {
  none: 'text-emerald-800/90',
  low: 'text-emerald-900/85',
  moderate: 'text-amber-900/80',
  high: 'text-orange-900/85',
  critical: 'text-rose-900/85',
};

const OVERDUE_PRIORITY_AMOUNT = {
  none: 'text-emerald-950',
  low: 'text-emerald-950',
  moderate: 'text-amber-950',
  high: 'text-orange-950',
  critical: 'text-rose-950',
};

const OVERDUE_PRIORITY_SUB = {
  none: 'text-emerald-800/75',
  low: 'text-emerald-900/75',
  moderate: 'text-amber-900/70',
  high: 'text-orange-900/72',
  critical: 'text-rose-900/72',
};

function overduePriorityCopy(od) {
  const n = Number(od?.billCount) || 0;
  const d = Number(od?.maxDaysOverdue) || 0;
  const p = od?.priority || 'none';
  if (n === 0) return 'No overdue bills · within payment terms';
  if (p === 'low') return `${n} bill${n === 1 ? '' : 's'} · up to ${d} day${d === 1 ? '' : 's'} late`;
  if (p === 'moderate') return `${n} bill${n === 1 ? '' : 's'} · ${d} days late (review)`;
  if (p === 'high') return `${n} bill${n === 1 ? '' : 's'} · ${d} days late (urgent)`;
  return `${n} bill${n === 1 ? '' : 's'} · ${d} days late (critical)`;
}

function getSectionTitle(pathname) {
  const sorted = [...DASHBOARD_NAV].sort((a, b) => b.to.length - a.to.length);
  const found = sorted.find((n) => pathname.startsWith(n.to));
  return found ? found.label : 'Dashboard';
}

const WHATSAPP_STATE_LABELS = {
  idle: 'Not started',
  initializing: 'Starting…',
  qr: 'Scan QR',
  authenticated: 'Connecting…',
  ready: 'Connected',
  disconnected: 'Disconnected',
  auth_failure: 'Auth failed',
};

function WhatsAppNavStatus({ enabled, state, connected }) {
  const label = !enabled
    ? 'Off'
    : connected
      ? 'Connected'
      : WHATSAPP_STATE_LABELS[state] || state || 'Unknown';

  const tone = !enabled
    ? 'bg-slate-100 text-slate-600 ring-slate-200'
    : connected
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : state === 'qr' || state === 'initializing' || state === 'authenticated'
        ? 'bg-amber-50 text-amber-800 ring-amber-200'
        : 'bg-rose-50 text-rose-800 ring-rose-200';

  const dotTone = !enabled
    ? 'bg-slate-400'
    : connected
      ? 'bg-emerald-500'
      : state === 'qr' || state === 'initializing' || state === 'authenticated'
        ? 'bg-amber-500'
        : 'bg-rose-500';

  const title = !enabled
    ? 'WhatsApp notifications are disabled. Open Messages to enable.'
    : connected
      ? 'WhatsApp is connected and ready to send notifications.'
      : `WhatsApp: ${label}. Open Messages to finish setup.`;

  return (
    <NavLink
      to="/dashboard/messages"
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold ring-1 transition hover:opacity-90 sm:gap-2 sm:px-3 sm:py-2 ${tone}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {connected ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotTone}`} />
      </span>
      <span className="hidden sm:inline">WhatsApp</span>
      <span className="max-w-[4.5rem] truncate tabular-nums sm:max-w-none">{label}</span>
    </NavLink>
  );
}

export default function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [permissionsTick, setPermissionsTick] = useState(0);
  const [sidebarCashSummary, setSidebarCashSummary] = useState(null);
  const [sidebarStockSummary, setSidebarStockSummary] = useState(null);
  const [sidebarStockLoading, setSidebarStockLoading] = useState(true);
  const [whatsappStatus, setWhatsappStatus] = useState({
    enabled: false,
    state: 'idle',
    connected: false,
  });
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const shopName = useShopName();
  const section = getSectionTitle(location.pathname);
  const headerTitle = section === 'Analytics' ? 'Main Dashboard' : section;
  const hideRightPanel = location.pathname.startsWith('/dashboard/bank');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const normalizedOverdue =
    sidebarCashSummary == null
      ? null
      : {
          totalOutstanding: Number(sidebarCashSummary.overdue?.totalOutstanding) || 0,
          billCount: Number(sidebarCashSummary.overdue?.billCount) || 0,
          maxDaysOverdue: Number(sidebarCashSummary.overdue?.maxDaysOverdue) || 0,
          priority: ['none', 'low', 'moderate', 'high', 'critical'].includes(
            sidebarCashSummary.overdue?.priority,
          )
            ? sidebarCashSummary.overdue.priority
            : 'none',
        };

  const overduePriority = normalizedOverdue?.priority || 'none';
  const overdueCardTint = OVERDUE_PRIORITY_CARD[overduePriority] || OVERDUE_PRIORITY_CARD.none;

  useEffect(() => {
    const apiRoot = getApiBase() || '';
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${apiRoot}/api/cash-summary`);
        if (!cancelled && res.ok) setSidebarCashSummary(await res.json());
        else if (!cancelled) setSidebarCashSummary(null);
      } catch {
        if (!cancelled) setSidebarCashSummary(null);
      }
    }
    load();
    const id = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const apiRoot = getApiBase() || '';
    let cancelled = false;
    async function loadStock() {
      try {
        const res = await fetch(`${apiRoot}/api/stocks/summary`);
        if (!cancelled && res.ok) {
          const sum = await res.json();
          setSidebarStockSummary({
            brands: Array.isArray(sum.brands) ? sum.brands : [],
          });
        } else if (!cancelled) {
          setSidebarStockSummary(null);
        }
      } catch {
        if (!cancelled) setSidebarStockSummary(null);
      } finally {
        if (!cancelled) setSidebarStockLoading(false);
      }
    }
    loadStock();
    const id = window.setInterval(loadStock, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const apiRoot = getApiBase() || '';
    let cancelled = false;
    async function pollWhatsApp() {
      try {
        const res = await fetch(`${apiRoot}/api/messages/whatsapp-status`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setWhatsappStatus({
            enabled: Boolean(data.enabled),
            state: data.state ?? 'idle',
            connected: Boolean(data.connected),
          });
        }
      } catch {
        if (!cancelled) {
          setWhatsappStatus({ enabled: false, state: 'idle', connected: false });
        }
      }
    }
    pollWhatsApp();
    const id = window.setInterval(pollWhatsApp, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const canSeeRequests =
    isManagerOrAdmin() && (isAdmin() || hasDashboardAccess('requests'));

  useEffect(() => {
    if (!canSeeRequests) {
      setPendingRequestCount(0);
      return undefined;
    }
    const apiRoot = getApiBase() || '';
    let cancelled = false;
    async function loadPendingCount() {
      try {
        const res = await authFetch(`${apiRoot}/api/requests/pending-count`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setPendingRequestCount(Math.max(0, Number(data.total) || 0));
        } else if (!cancelled) {
          setPendingRequestCount(0);
        }
      } catch {
        if (!cancelled) setPendingRequestCount(0);
      }
    }
    loadPendingCount();
    const id = window.setInterval(loadPendingCount, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [canSeeRequests, permissionsTick]);

  const signOut = () => {
    clearAuth();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    if (isAuthed() && !getToken()) {
      clearAuth();
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (!isAuthed() || !getToken()) return;
    refreshSessionFromServer(getApiBase()).then(() => setPermissionsTick((t) => t + 1));
  }, []);

  const navItems = DASHBOARD_NAV.filter((item) => {
    if (item.to === '/dashboard/users') return isAdmin();
    if (isAdmin()) return true;
    if (getStaffRole() === 'Manager') {
      return item.accessKey ? hasDashboardAccess(item.accessKey) : false;
    }
    if (isCollector()) {
      return item.accessKey ? hasDashboardAccess(item.accessKey) : false;
    }
    if (item.to === '/dashboard/requests') return isManagerOrAdmin();
    return true;
  });
  const signedInName = getUsername().trim() || 'Signed in';
  const userInitial = signedInName.charAt(0).toUpperCase() || '?';
  const roleLabel = isAdmin()
    ? 'Administrator'
    : isCollector()
      ? 'Collector'
      : getStaffRole() === 'Manager'
        ? 'Manager'
        : 'Staff';

  const renderSidebarFooter = () => (
    <>
      {!isCollector() ? (
      <div
        className={`rounded-2xl bg-gradient-to-br p-3 shadow-lg ring-1 ${overdueCardTint}`}
        aria-live="polite"
      >
        <p
          className={`text-[10px] font-medium uppercase tracking-wider ${OVERDUE_PRIORITY_LABEL[overduePriority]}`}
        >
          Overdue bills
        </p>
        <p
          className={`mt-0.5 text-lg font-bold tabular-nums tracking-tight ${OVERDUE_PRIORITY_AMOUNT[overduePriority]}`}
        >
          {normalizedOverdue == null ? '—' : formatLkr2(normalizedOverdue.totalOutstanding)}
        </p>
        <p className={`text-[11px] leading-snug ${OVERDUE_PRIORITY_SUB[overduePriority]}`}>
          {normalizedOverdue == null ? <LoadingSpinner size="sm" className="text-[11px]" /> : overduePriorityCopy(normalizedOverdue)}
        </p>
      </div>
      ) : null}
      <div className="flex items-center gap-3 rounded-2xl bg-slate-50/90 px-3 py-2.5 ring-1 ring-slate-100">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-200 to-violet-200 text-sm font-semibold text-indigo-900"
          aria-hidden
        >
          {userInitial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900" title={signedInName}>
            {signedInName}
          </p>
          <p className="truncate text-xs text-slate-500">{roleLabel}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
      >
        Sign out
      </button>
    </>
  );

  return (
    <BagProductsProvider>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#F4F7FE] text-slate-900">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Sidebar fixed to viewport; main column offset on md+ so content is not underneath. */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-[260px] flex-col border-r border-white/60 bg-white/80 px-4 py-4 shadow-xl shadow-slate-200/40 backdrop-blur-xl transition-transform md:translate-x-0 md:py-5 md:shadow-lg ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-xs font-bold text-white shadow-md shadow-indigo-500/25">
              {shopNameInitials(shopName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-slate-900" title={shopName}>
                {shopName}
              </p>
              <p className="mt-0.5 truncate text-xs font-medium text-slate-500" title={signedInName}>
                {signedInName}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="scrollbar-hide mt-8 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <nav className="flex flex-col gap-0.5 px-1" aria-label="Main">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to !== '/dashboard/customers'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <span
                        className="absolute right-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-l-full bg-indigo-600"
                        aria-hidden
                      />
                    ) : null}
                    <NavIcon name={item.icon} active={isActive} />
                    <span className="relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate">{item.label}</span>
                      {item.to === '/dashboard/requests' && pendingRequestCount > 0 ? (
                        <span
                          className="inline-flex min-h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold tabular-nums leading-none text-white ring-2 ring-white"
                          aria-label={`${pendingRequestCount} pending request${pendingRequestCount === 1 ? '' : 's'}`}
                        >
                          {pendingRequestCount > 99 ? '99+' : pendingRequestCount}
                        </span>
                      ) : null}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Mobile-only: bag stock + footer sections scroll with nav */}
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 md:hidden">
            <div className="rounded-2xl bg-white p-3 shadow-md ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Bag stock (live)
                </p>
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Live
                </span>
              </div>
              {sidebarStockLoading ? (
                <div className="mt-2 flex justify-center py-1"><LoadingSpinner size="sm" className="text-xs text-slate-400" /></div>
              ) : !sidebarStockSummary?.brands?.length ? (
                <p className="mt-2 text-xs text-slate-500">No stock data.</p>
              ) : (
                <div
                  className={`mt-2 grid gap-1.5 ${
                    sidebarStockSummary.brands.length <= 2
                      ? 'grid-cols-2'
                      : sidebarStockSummary.brands.length === 3
                        ? 'grid-cols-3'
                        : 'grid-cols-4'
                  }`}
                >
                  {sidebarStockSummary.brands.map((b) => (
                    <div
                      key={b.key}
                      className="min-w-0 rounded-xl bg-slate-50 px-1.5 py-2 text-center ring-1 ring-slate-100"
                    >
                      <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                        {b.label}
                      </p>
                      <p className="mt-0.5 font-mono text-sm font-bold tabular-nums leading-none text-indigo-700">
                        {Number(b.bags).toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-[8px] font-medium text-slate-400">bags</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {renderSidebarFooter()}
          </div>
        </div>

        {/* Desktop: overdue, profile, sign out stay pinned at bottom */}
        <div className="mt-4 hidden shrink-0 space-y-3 border-t border-slate-100 pt-4 md:block">
          {renderSidebarFooter()}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col pt-[3.75rem] sm:pt-[4.75rem] md:pl-[260px]">
        <header className="fixed inset-x-0 top-0 z-30 shrink-0 border-b border-white/50 bg-[#F4F7FE]/95 px-3 py-2 backdrop-blur-md sm:px-6 sm:py-3 md:left-[260px] lg:px-8">
          <div className="flex h-11 items-center justify-between gap-2 sm:h-auto sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-600 shadow-sm shadow-slate-200/50 md:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <p className="hidden truncate text-xs font-medium leading-tight text-slate-400 sm:block">
                  Dashboards / <span className="text-slate-600">Default</span>
                </p>
                <h1 className="truncate text-base font-bold leading-tight tracking-tight text-slate-900 sm:mt-0 sm:text-xl">
                  {headerTitle}
                </h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              <WhatsAppNavStatus
                enabled={whatsappStatus.enabled}
                state={whatsappStatus.state}
                connected={whatsappStatus.connected}
              />
              <div className="relative hidden min-w-0 sm:block sm:max-w-[14rem] md:max-w-[16rem] lg:max-w-[18rem]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </span>
                <input
                  type="search"
                  placeholder="Search…"
                  className="w-full rounded-full border-0 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 shadow-md shadow-slate-200/50 ring-1 ring-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
              <div className="flex items-center gap-0.5 rounded-full border border-slate-100 bg-white p-0.5 shadow-md shadow-slate-200/50 sm:gap-1 sm:p-1">
                <button
                  type="button"
                  className="hidden h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 sm:flex"
                  aria-label="Notifications"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="hidden h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 sm:flex"
                  aria-label="Info"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                </button>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[10px] font-bold text-white sm:ml-0.5 sm:h-9 sm:w-9 sm:text-xs">
                  A
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-x-hidden px-4 pb-8 pt-3 sm:px-6 sm:pt-4 lg:px-8 lg:pb-10">
          <main
            className={`min-w-0 shrink-0 overflow-x-hidden pr-0 ${
              hideRightPanel ? '' : 'lg:pr-[calc(300px+1.5rem)] xl:pr-[calc(320px+1.5rem)]'
            }`}
          >
            <Outlet />
          </main>
          {hideRightPanel ? null : <RightPanel />}
        </div>
      </div>
    </div>
    </BagProductsProvider>
  );
}

function RightPanel() {
  const apiRoot = getApiBase() || '';
  const [stockSummary, setStockSummary] = useState(null);
  const [cashSummary, setCashSummary] = useState(null);
  const [recentActivities, setRecentActivities] = useState([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState(null);
  const [activityError, setActivityError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPanel() {
      try {
        const [stockRes, cashRes] = await Promise.all([
          fetch(`${apiRoot}/api/stocks/summary`),
          fetch(`${apiRoot}/api/cash-summary`),
        ]);

        if (!cancelled) {
          if (cashRes.ok) {
            const cashJson = await cashRes.json();
            setCashSummary(cashJson);
          } else {
            setCashSummary(null);
          }
        }

        if (!stockRes.ok) {
          throw new Error(`HTTP ${stockRes.status}`);
        }
        const sum = await stockRes.json();
        const brands = Array.isArray(sum.brands) ? sum.brands : [];

        if (!cancelled) {
          setStockSummary({ brands, liveAt: sum.liveAt || new Date().toISOString() });
          setStockError(null);
        }

        const actRes = await fetch(`${apiRoot}/api/activity?limit=5`);
        if (!cancelled) {
          if (actRes.ok) {
            const act = await actRes.json();
            setRecentActivities(Array.isArray(act) ? act : []);
            setActivityError(null);
          } else {
            setRecentActivities([]);
            setActivityError('Could not load activity.');
          }
        }
      } catch {
        if (!cancelled) {
          setStockError('Could not load stock.');
          setRecentActivities([]);
          setActivityError(null);
        }
      } finally {
        if (!cancelled) {
          setStockLoading(false);
        }
      }
    }

    loadPanel();
    const id = window.setInterval(loadPanel, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apiRoot]);

  return (
    <aside
      className="hidden w-full min-h-0 flex-col gap-5 overflow-y-auto overscroll-y-contain pb-2 lg:fixed lg:bottom-0 lg:right-0 lg:top-[4.75rem] lg:z-20 lg:flex lg:w-[300px] lg:max-w-none lg:border-l lg:border-slate-200/70 lg:bg-[#F4F7FE]/95 lg:px-4 lg:py-4 lg:pb-6 lg:backdrop-blur-md lg:scrollbar-hide xl:w-[320px]"
      aria-label="Account and activity"
    >
      <div className="flex shrink-0 flex-col overflow-hidden rounded-[20px] bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 p-5 text-white shadow-xl shadow-fuchsia-500/20 ring-1 ring-white/20">
        <ul className="space-y-3.5 text-sm">
          <li className="border-b border-white/20 pb-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/75">
              Pending cash from customers
            </p>
            <p className="mt-1 text-base font-bold tabular-nums leading-tight sm:text-lg">
              {cashSummary == null ? '—' : formatLkr2(cashSummary.pendingFromCustomers)}
            </p>
            <p className="mt-0.5 text-[10px] text-white/65">Total amount still to collect</p>
          </li>
          <li>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/75">
              Cash received from customers
            </p>
            <p className="mt-1 text-base font-bold tabular-nums leading-tight text-emerald-100 sm:text-lg">
              {cashSummary == null ? '—' : formatLkr2(cashSummary.cashReceivedFromCustomers)}
            </p>
            <p className="mt-0.5 text-[10px] text-white/65">All recorded payments</p>
          </li>
        </ul>
      </div>
      <div className="shrink-0 rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-slate-900">Bag stock (live)</h2>
          <span className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wide text-emerald-600">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        </div>
        <p className="mt-0.5 text-[11px] font-normal text-slate-500">Total bags on hand across all loads</p>
        {stockLoading ? (
          <div className="mt-4 flex justify-center"><LoadingSpinner label="Loading stock…" size="sm" className="text-slate-400" /></div>
        ) : stockError ? (
          <p className="mt-4 text-xs font-normal text-rose-600">{stockError}</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {(stockSummary?.brands || []).map((b) => (
              <li
                key={b.key}
                className="group relative flex items-center justify-between gap-2 rounded-lg bg-slate-50/90 px-2.5 py-1.5 ring-1 ring-slate-100"
              >
                <span className="min-w-0 truncate text-[11px] font-normal leading-snug text-slate-700">
                  {b.label}
                </span>
                <span
                  role="tooltip"
                  className="pointer-events-none invisible absolute left-1.5 right-1.5 top-full z-30 mt-0.5 rounded-md bg-slate-800 px-2 py-1.5 text-[10px] font-normal leading-snug text-white opacity-0 shadow-lg ring-1 ring-black/10 group-hover:visible group-hover:opacity-100"
                >
                  {b.label}
                </span>
                <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-indigo-700">
                  {Number(b.bags).toLocaleString()}{' '}
                  <span className="text-[9px] font-normal text-slate-500">bags</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
        <h2 className="text-sm font-bold text-slate-900">Recent activity</h2>
        <p className="mt-0.5 text-xs text-slate-500">Loads, bills, customers, payments (last 5)</p>
        {activityError ? (
          <p className="mt-2 text-xs text-amber-700">{activityError}</p>
        ) : null}
        {stockLoading ? (
          <div className="mt-4 flex justify-center"><LoadingSpinner size="sm" className="text-slate-400" /></div>
        ) : recentActivities.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            {activityError ? (
              'Try again in a moment.'
            ) : stockError ? (
              <span className="text-rose-600">{stockError}</span>
            ) : (
              'No activity yet.'
            )}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {recentActivities.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold leading-tight ${
                    KIND_BADGE[item.kind] || 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {KIND_SHORT[item.kind] || '·'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
                </div>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">
                  {formatLkr(item.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
