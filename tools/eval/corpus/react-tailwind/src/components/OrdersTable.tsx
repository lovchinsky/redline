const orders = [
  { id: 'ORD-1042', customer: 'Northwind Traders', total: '$1,240.00', status: 'Paid' },
  { id: 'ORD-1041', customer: 'Globex Corporation', total: '$310.50', status: 'Pending' },
  { id: 'ORD-1040', customer: 'Initech', total: '$89.99', status: 'Refunded' },
];

const statusStyles: Record<string, string> = {
  Paid: 'bg-green-100 text-green-800',
  Pending: 'bg-yellow-100 text-yellow-800',
  Refunded: 'bg-gray-100 text-gray-700',
};

export function OrdersTable() {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-medium text-gray-900">Recent orders</h2>
        <button className="text-sm font-medium text-indigo-600" data-testid="export-orders">
          Export CSV
        </button>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-gray-500">
          <tr>
            <th className="px-6 py-3 font-medium">Order</th>
            <th className="px-6 py-3 font-medium">Customer</th>
            <th className="px-6 py-3 font-medium">Total</th>
            <th className="px-6 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-t border-gray-100">
              <td className="px-6 py-3 font-mono">{order.id}</td>
              <td className="px-6 py-3">{order.customer}</td>
              <td className="px-6 py-3">{order.total}</td>
              <td className="px-6 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs ${statusStyles[order.status]}`}>
                  {order.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
