import { Sidebar } from './components/Sidebar';
import { StatCard } from './components/StatCard';
import { RevenueChart } from './components/RevenueChart';
import { OrdersTable } from './components/OrdersTable';
import { UserMenu } from './components/UserMenu';
import { PlanBanner } from './components/PlanBanner';

export function App() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-8">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
          <UserMenu name="Dana Whitfield" />
        </header>
        <PlanBanner daysLeft={9} />
        <section className="mb-8 grid grid-cols-4 gap-4">
          <StatCard label="Total revenue" value="$48,210" delta={12.4} />
          <StatCard label="Active subscriptions" value="1,284" delta={3.1} />
          <StatCard label="Churn rate" value="2.3%" delta={-0.4} />
          <StatCard label="Avg. order value" value="$37.50" delta={1.8} />
        </section>
        <RevenueChart />
        <OrdersTable />
      </main>
    </div>
  );
}
