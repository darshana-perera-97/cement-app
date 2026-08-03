import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_DEV_API_URL, getApiBase } from './apiBase';
import { isAuthed, setAuth, getFirstAllowedDashboardPath } from './auth';
import { shopNameInitials, useShopName } from './shopConfig';

const apiBase = getApiBase();

function Login() {
  const navigate = useNavigate();
  const shopName = useShopName();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isAuthed()) {
      navigate(getFirstAllowedDashboardPath(), { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const url = `${apiBase}/api/login`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON (e.g. HTML from dev server when proxy/backend is wrong) */
      }
      if (!res.ok) {
        const msg =
          data.error ||
          data.message ||
          (res.status === 404
            ? `Login API not found at ${url}. Start the backend at ${DEFAULT_DEV_API_URL}, or set REACT_APP_API_URL in the frontend.`
            : `Request failed (${res.status}). Check that the backend is running (${DEFAULT_DEV_API_URL}).`);
        setError(msg);
        return;
      }
      if (!data || data.ok !== true) {
        setError(
          'Unexpected response from server. For a production build, set REACT_APP_API_URL to your API origin and rebuild.'
        );
        return;
      }
      const resolvedUser = data.username != null && String(data.username).trim() ? data.username : username;
      const role = data.role === 'admin' ? 'admin' : 'staff';
      const token = data.token != null ? String(data.token) : '';
      if (!token) {
        setError('Server did not return an auth token. Update the backend and sign in again.');
        return;
      }
      setAuth(resolvedUser, role, token, data.staffRole, data.managerAccess);
      navigate(getFirstAllowedDashboardPath(), { replace: true });
    } catch {
      setError(
        `Could not reach the server. Is the backend running at ${DEFAULT_DEV_API_URL}?`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-8 sm:px-5 sm:py-12">
      <main className="w-full max-w-[420px]">
        <div className="max-h-[min(90vh,calc(100dvh-3rem))] overflow-y-auto overscroll-contain rounded-3xl bg-white px-5 py-8 shadow-xl shadow-slate-200/60 ring-1 ring-slate-100 sm:px-10 sm:py-10">
          <div className="mb-8 flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-bold tracking-tight text-white shadow-lg shadow-indigo-500/30"
              aria-hidden
            >
              {shopNameInitials(shopName)}
            </div>
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-slate-900">
                {shopName}
              </p>
              <p className="text-xs font-medium text-slate-500">
                Cement supply
              </p>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Sign in
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Admin or staff — use credentials from your administrator.
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
              {error ? (
                <p
                  className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <div>
                <label
                  className="block text-sm font-medium text-slate-600"
                  htmlFor="login-username"
                >
                  Username or NIC
                </label>
                <input
                  id="login-username"
                  className="mt-2 w-full rounded-2xl border-0 bg-slate-100 px-4 py-3.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none ring-1 ring-slate-200/90 transition focus:bg-white focus:ring-2 focus:ring-indigo-500/35"
                  type="text"
                  name="username"
                  autoComplete="username"
                  placeholder="admin or NIC"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div>
                <label
                  className="block text-sm font-medium text-slate-600"
                  htmlFor="login-password"
                >
                  Password
                </label>
                <input
                  id="login-password"
                  className="mt-2 w-full rounded-2xl border-0 bg-slate-100 px-4 py-3.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none ring-1 ring-slate-200/90 transition focus:bg-white focus:ring-2 focus:ring-indigo-500/35"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Signing in…' : 'Continue'}
              </button>
            </form>

          <p className="mt-6 text-center">
            <button
              type="button"
              className="text-sm font-medium text-slate-500 transition hover:text-indigo-600 focus-visible:outline-none focus-visible:underline"
            >
              Forgot password?
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

export default Login;
