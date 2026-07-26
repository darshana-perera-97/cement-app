export default function SectionPage({ title, description }) {
  const stats = [
    { label: 'Active', value: '—', trend: '+0%', positive: true },
    { label: 'Pending', value: '—', trend: '0%', positive: null },
    { label: 'This week', value: '—', trend: '+0%', positive: true },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        {description || `Overview and actions for ${title}.`}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{s.value}</p>
            <p
              className={`mt-1 text-xs font-semibold ${
                s.positive === true ? 'text-emerald-600' : s.positive === false ? 'text-rose-500' : 'text-slate-400'
              }`}
            >
              {s.trend}
            </p>
          </div>
        ))}
      </div>
      <div className="rounded-[20px] bg-white p-6 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
        <h2 className="text-sm font-bold text-slate-900">Quick actions</h2>
        <p className="mt-2 text-sm text-slate-500">
          Use the main navigation to drill into records, exports, and settings for {title.toLowerCase()}.
        </p>
      </div>
    </div>
  );
}
