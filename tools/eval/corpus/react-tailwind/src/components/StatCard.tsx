interface StatCardProps {
  label: string;
  value: string;
  delta: number;
}

export function StatCard({ label, value, delta }: StatCardProps) {
  const positive = delta >= 0;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      <p className={positive ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
        {positive ? '▲' : '▼'} {Math.abs(delta)}% vs last month
      </p>
    </div>
  );
}
