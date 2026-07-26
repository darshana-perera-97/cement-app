import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername, isAdmin } from '../auth';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  mobileCardList,
  MobileRowCard,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
  modalPanelClassMd,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';

const emptyForm = () => ({ username: '', password: '' });

export default function UsersPage() {
  const apiRoot = getApiBase() || '';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [detailUser, setDetailUser] = useState(null);

  const load = useCallback(async () => {
    if (!isAdmin()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${apiRoot}/api/users`);
      if (res.status === 403) {
        setError('Only the admin can view users.');
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiRoot]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) =>
      rowMatchesQuery(search, [r.username, r.id, r.createdBy, r.createdAt]),
    );
  }, [rows, search]);

  const pagination = useTablePagination(filteredRows.length, [search]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openModal = () => {
    setForm(emptyForm());
    setSaveError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSaveError(null);
  };

  if (!isAdmin()) {
    return <Navigate to="/dashboard/analytics" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authFetch(`${apiRoot}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username.trim().toLowerCase(),
          password: form.password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      closeModal();
      await load();
    } catch {
      setSaveError('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this user? They can no longer sign in.')) return;
    setDeletingId(id);
    try {
      const res = await authFetch(`${apiRoot}/api/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Delete failed');
        return;
      }
      await load();
    } catch {
      alert('Could not reach the server');
    } finally {
      setDeletingId(null);
    }
  };

  const selfName = (getUsername() || '').trim().toLowerCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-slate-500">Add and manage staff accounts for dashboard access.</p>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 sm:w-auto text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:bg-indigo-700"
        >
          Add user
        </button>
      </div>

      <TableFiltersBar
        hint={
          rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} user${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Username, id…"
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

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
        <div className="space-y-3">
        <div className={mobileCardList}>
          {filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              {rows.length === 0 ? 'No staff users yet. Add one with the button above.' : 'No matches.'}
            </p>
          ) : (
            pagedRows.map((r) => {
              const isSelf = r.username === selfName;
              const addedAt = r.createdAt ? String(r.createdAt).slice(0, 19).replace('T', ' ') : '—';
              return (
                <MobileRowCard
                  key={r.id}
                  title={r.username}
                  subtitle={isSelf ? 'You (if staff)' : undefined}
                  fields={[
                    { label: 'Added', value: addedAt },
                    { label: 'Created by', value: r.createdBy || '—' },
                  ]}
                  actions={
                    <>
                      <button
                        type="button"
                        onClick={() => setDetailUser(r)}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={() => handleDelete(r.id)}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        {deletingId === r.id ? 'Removing…' : 'Remove'}
                      </button>
                    </>
                  }
                />
              );
            })
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className={`py-3 pl-4 pr-3 ${stickyFirstTh}`}>Username</th>
                <th className="py-3 pr-3">Added</th>
                <th className="py-3 pr-3">Created by</th>
                <th className="py-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    {rows.length === 0 ? 'No staff users yet. Add one with the button above.' : 'No matches.'}
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => {
                  const isSelf = r.username === selfName;
                  return (
                    <tr
                      key={r.id}
                      {...detailRowAttrs(() => setDetailUser(r), 'text-slate-700')}
                      aria-label={`User ${r.username || ''}`}
                    >
                      <td className={`py-3.5 pl-4 pr-3 font-mono text-sm font-semibold text-slate-900 ${stickyFirstTd}`}>
                        {r.username}
                        {isSelf ? (
                          <span className="ml-2 text-xs font-normal text-slate-400">(you, if staff)</span>
                        ) : null}
                      </td>
                      <td className="py-3.5 pr-3 tabular-nums text-slate-600">
                        {r.createdAt ? String(r.createdAt).slice(0, 19).replace('T', ' ') : '—'}
                      </td>
                      <td className="py-3.5 pr-3 font-medium text-slate-700">{r.createdBy || '—'}</td>
                      <td className="py-3.5 pr-4 text-right">
                        <button
                          type="button"
                          disabled={deletingId === r.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(r.id);
                          }}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                        >
                          {deletingId === r.id ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 ? (
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filteredRows.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
        </div>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="users-modal-title"
        >
          <div className={modalPanelClassMd}>
            <h2 id="users-modal-title" className="text-lg font-bold text-slate-900">
              Add staff user
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              3–32 chars: lowercase letters, numbers, underscores. Password at least 6 characters.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {saveError}
                </p>
              ) : null}
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="nu-username">
                  Username
                </label>
                <input
                  id="nu-username"
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  autoComplete="off"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="nu-password">
                  Password
                </label>
                <input
                  id="nu-password"
                  type="password"
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  disabled={saving}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
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
                  {saving ? 'Saving…' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RowDetailModal open={!!detailUser} row={detailUser} variant="user" onClose={() => setDetailUser(null)} />
    </div>
  );
}
