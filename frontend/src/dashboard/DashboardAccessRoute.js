import { Navigate, useLocation } from 'react-router-dom';
import { getFirstAllowedDashboardPath, hasDashboardAccess } from '../auth';
import { DASHBOARD_ROUTE_ACCESS } from './navConfig';

function accessKeyForPath(pathname) {
  const rest = pathname.replace(/^\/dashboard\/?/, '').split('/')[0] || 'analytics';
  return DASHBOARD_ROUTE_ACCESS[rest] || null;
}

export default function DashboardAccessRoute({ accessKey, children }) {
  const { pathname } = useLocation();
  const key = accessKey || accessKeyForPath(pathname);
  if (key && !hasDashboardAccess(key)) {
    return <Navigate to={getFirstAllowedDashboardPath()} replace />;
  }
  return children;
}
