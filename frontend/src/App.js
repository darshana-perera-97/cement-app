import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Footer from './Footer';
import Login from './Login';
import { getFirstAllowedDashboardPath, getPostLoginPath, isAuthed, isDriverAuthed } from './auth';
import { useDocumentTitle } from './seo';
import DashboardLayout from './dashboard/DashboardLayout';
import DashboardAccessRoute from './dashboard/DashboardAccessRoute';
import AnalyticsPage from './dashboard/AnalyticsPage';
import BillsPage from './dashboard/BillsPage';
import ReturnsPage from './dashboard/ReturnsPage';
import CustomerTransactionsPage from './dashboard/CustomerTransactionsPage';
import CustomersPage from './dashboard/CustomersPage';
import LoadsPage from './dashboard/LoadsPage';
import PurchaseOrdersPage from './dashboard/PurchaseOrdersPage';
import PaymentsPage from './dashboard/PaymentsPage';
import BankPage from './dashboard/BankPage';
import ProfilesPage from './dashboard/ProfilesPage';
import PromotionsPage from './dashboard/PromotionsPage';
import UsersPage from './dashboard/UsersPage';
import IncentivePage from './dashboard/IncentivePage';
import MessagesPage from './dashboard/MessagesPage';
import StockPage from './dashboard/StockPage';
import ReportsPage from './dashboard/ReportsPage';
import RequestsPage from './dashboard/RequestsPage';
import ShopPage from './dashboard/ShopPage';
import OverdueBillsPage from './dashboard/OverdueBillsPage';
import PendingChequesPage from './dashboard/PendingChequesPage';
import UnloadsPage from './UnloadsPage';
import SettingsPage from './dashboard/SettingsPage';
import MapPage from './dashboard/MapPage';
import CollectorUnloadsPage from './dashboard/CollectorUnloadsPage';
import { BagProductsProvider } from './dashboard/BagProductsContext';
import { PrinterProvider } from './printer/PrinterProvider';

function RoutePage({ component: Page }) {
  if (typeof Page !== 'function') {
    return (
      <div className="rounded-2xl bg-red-50 px-4 py-8 text-center text-sm text-red-800 ring-1 ring-red-100" role="alert">
        This page failed to load. Refresh the browser.
      </div>
    );
  }
  return <Page />;
}

function ProtectedRoute({ children }) {
  if (!isAuthed()) {
    return <Navigate to="/login" replace />;
  }
  if (isDriverAuthed()) {
    return <Navigate to="/unloads" replace />;
  }
  return children;
}

function DashboardHomeRedirect() {
  return <Navigate to={getFirstAllowedDashboardPath()} replace />;
}

function NoAccessPage() {
  return (
    <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-slate-100">
      <h2 className="text-lg font-semibold text-slate-900">No dashboard access</h2>
      <p className="mt-2 text-sm text-slate-500">
        Your account has no dashboard sections assigned. Ask an administrator for access.
      </p>
    </div>
  );
}

function AppRoutes() {
  const { pathname } = useLocation();
  useDocumentTitle(pathname);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/unloads" element={<BagProductsProvider><UnloadsPage /></BagProductsProvider>} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardHomeRedirect />} />
        <Route path="no-access" element={<NoAccessPage />} />
        <Route
          path="analytics"
          element={
            <DashboardAccessRoute accessKey="analytics">
              <AnalyticsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="requests"
          element={
            <DashboardAccessRoute accessKey="requests">
              <RequestsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="reports"
          element={
            <DashboardAccessRoute accessKey="reports">
              <ReportsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="customers/:customerId"
          element={
            <DashboardAccessRoute accessKey="customers">
              <CustomerTransactionsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="customers"
          element={
            <DashboardAccessRoute accessKey="customers">
              <CustomersPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="unloads"
          element={
            <DashboardAccessRoute accessKey="unloads">
              <CollectorUnloadsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="shop"
          element={
            <DashboardAccessRoute accessKey="shop">
              <ShopPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="stock"
          element={
            <DashboardAccessRoute accessKey="stock">
              <StockPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="loads"
          element={
            <DashboardAccessRoute accessKey="loads">
              <LoadsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="purchase-orders"
          element={
            <DashboardAccessRoute accessKey="purchase-orders">
              <PurchaseOrdersPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="bills"
          element={
            <DashboardAccessRoute accessKey="bills">
              <BillsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="returns"
          element={
            <DashboardAccessRoute accessKey="returns">
              <ReturnsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="payments"
          element={
            <DashboardAccessRoute accessKey="payments">
              <PaymentsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="bank"
          element={
            <DashboardAccessRoute accessKey="bank">
              <BankPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="profiles/:staffId"
          element={
            <DashboardAccessRoute accessKey="profiles">
              <RoutePage component={ProfilesPage} />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="profiles"
          element={
            <DashboardAccessRoute accessKey="profiles">
              <RoutePage component={ProfilesPage} />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="promotions"
          element={
            <DashboardAccessRoute accessKey="promotions">
              <PromotionsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="messages"
          element={
            <DashboardAccessRoute accessKey="messages">
              <MessagesPage />
            </DashboardAccessRoute>
          }
        />
        <Route path="users" element={<UsersPage />} />
        <Route path="map" element={<RoutePage component={MapPage} />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="overdue-bills"
          element={
            <DashboardAccessRoute accessKey="overdue-bills">
              <OverdueBillsPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="pending-cheques"
          element={
            <DashboardAccessRoute accessKey="pending-cheques">
              <PendingChequesPage />
            </DashboardAccessRoute>
          }
        />
        <Route
          path="incentive"
          element={
            <DashboardAccessRoute accessKey="incentive">
              <IncentivePage />
            </DashboardAccessRoute>
          }
        />
      </Route>
      <Route
        path="/"
        element={<Navigate to={isAuthed() ? getPostLoginPath() : '/login'} replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <PrinterProvider>
      <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AppRoutes />
        </div>
        <Footer />
      </div>
    </PrinterProvider>
  );
}
