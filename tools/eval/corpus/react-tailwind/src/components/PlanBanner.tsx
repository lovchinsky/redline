export function PlanBanner({ daysLeft }: { daysLeft: number }) {
  return (
    <div className="mb-6 flex items-center justify-between rounded-lg bg-indigo-50 px-4 py-3">
      <p className="text-sm text-indigo-900">
        Your trial ends in {daysLeft} days. Upgrade to keep your dashboards.
      </p>
      <a href="/settings/billing" className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white">
        Upgrade plan
      </a>
    </div>
  );
}
