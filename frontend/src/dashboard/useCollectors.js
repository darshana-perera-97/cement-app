import { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, isManagerOrAdmin } from '../auth';

const inputClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

export function useCollectors() {
  const apiBase = getApiBase() || '';
  const [collectors, setCollectors] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isManagerOrAdmin()) {
      setCollectors([]);
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch(`${apiBase}/api/collectors`);
      if (!res.ok) {
        setCollectors([]);
        return;
      }
      const data = await res.json();
      setCollectors(Array.isArray(data) ? data : []);
    } catch {
      setCollectors([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  return { collectors, loading, reload: load };
}

export function CollectorSelectField({
  id = 'collector-select',
  value,
  onChange,
  disabled = false,
  collectors = [],
  loading = false,
  className = inputClass,
  allowEmpty = true,
  required = false,
}) {
  return (
    <label className="block text-sm font-medium text-slate-600 sm:col-span-2" htmlFor={id}>
      Assigned collector
      <select
        id={id}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        required={required}
      >
        {allowEmpty ? (
          <option value="">— None —</option>
        ) : (
          <option value="" disabled>
            Select a collector…
          </option>
        )}
        {collectors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.contact ? ` · ${c.contact}` : ''}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs font-normal text-slate-500">
        {allowEmpty
          ? 'Staff user with the Collector role (manager/admin only).'
          : 'Required — choose a staff user with the Collector role.'}
      </span>
    </label>
  );
}
