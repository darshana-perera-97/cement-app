import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Footer from './Footer';
import Login from './Login';
import { isAuthed } from './auth';
import { useDocumentTitle } from './seo';
import DashboardLayout from './dashboard/DashboardLayout';
import AnalyticsPage from './dashboard/AnalyticsPage';
import BillsPage from './dashboard/BillsPage';
import CustomerTransactionsPage from './dashboard/CustomerTransactionsPage';
import CustomersPage from './dashboard/CustomersPage';
import LoadsPage from './dashboard/LoadsPage';
import PaymentsPage from './dashboard/PaymentsPage';
import BankPage from './dashboard/BankPage';
import PromotionsPage from './dashboard/PromotionsPage';
import UsersPage from './dashboard/UsersPage';
import CashOutPage from './dashboard/CashOutPage';
import IncentivePage from './dashboard/IncentivePage';
import MessagesPage from './dashboard/MessagesPage';
import StockPage from './dashboard/StockPage';
import ReportsPage from './dashboard/ReportsPage';

function ProtectedRoute({ children }) {
  if (!isAuthed()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AppRoutes() {
  const { pathname } = useLocation();
  useDocumentTitle(pathname);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="analytics" replace />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="customers/:customerId" element={<CustomerTransactionsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="loads" element={<LoadsPage />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="bank" element={<BankPage />} />
        <Route path="promotions" element={<PromotionsPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="cash-out" element={<CashOutPage />} />
        <Route path="incentive" element={<IncentivePage />} />
      </Route>
      <Route
        path="/"
        element={<Navigate to={isAuthed() ? '/dashboard/analytics' : '/login'} replace />}
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
