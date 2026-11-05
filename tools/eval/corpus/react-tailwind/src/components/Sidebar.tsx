const links = [
  { href: '/overview', label: 'Overview' },
  { href: '/customers', label: 'Customers' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/settings/billing', label: 'Billing settings' },
];

export function Sidebar() {
  return (
    <nav className="w-60 border-r border-gray-200 bg-white p-4" aria-label="Main navigation">
      <div className="mb-6 text-lg font-bold text-indigo-600">Acme Analytics</div>
      <ul className="space-y-1">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
