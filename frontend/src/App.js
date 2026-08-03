import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Footer from './Footer';
import Login from './Login';
import { getFirstAllowedDashboardPath, isAuthed } from './auth';
import { useDocumentTitle } from './seo';
import DashboardLayout from './dashboard/DashboardLayout';
import DashboardAccessRoute from './dashboard/DashboardAccessRoute';
import AnalyticsPage from './dashboard/AnalyticsPage';
import BillsPage from './dashboard/BillsPage';
import CustomerTransactionsPage from './dashboard/CustomerTransactionsPage';
import CustomersPage from './dashboard/CustomersPage';
import LoadsPage from './dashboard/LoadsPage';
import PurchaseOrdersPage from './dashboard/PurchaseOrdersPage';
import PaymentsPage from './dashboard/PaymentsPage';
import BankPage from './dashboard/BankPage';
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

function ProtectedRoute({ children }) {
  if (!isAuthed()) {
    return <Navigate to="/login" replace />;
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
      <Route path="/unloads" element={<UnloadsPage />} />
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
        element={<Navigate to={isAuthed() ? getFirstAllowedDashboardPath() : '/login'} replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppRoutes />
      </div>
      <Footer />
    </div>
  );
}
