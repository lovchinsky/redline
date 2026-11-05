const points = [12, 18, 15, 22, 28, 26, 34, 31, 38, 42, 40, 48];

export function RevenueChart() {
  const max = Math.max(...points);
  return (
    <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium text-gray-900">Monthly recurring revenue</h2>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          aria-label="Chart period"
        >
          <option>Last 12 months</option>
          <option>Last 30 days</option>
        </select>
      </div>
      <svg viewBox="0 0 240 80" className="h-48 w-full" role="img" aria-label="Revenue trend">
        <polyline
          fill="none"
          stroke="currentColor"
          className="text-indigo-500"
          strokeWidth="2"
          points={points.map((p, i) => `${i * 20},${80 - (p / max) * 70}`).join(' ')}
        />
      </svg>
    </section>
  );
}
