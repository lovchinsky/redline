export function UserMenu({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('');
  return (
    <button
      className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pl-1 pr-3"
      aria-label="Account menu"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm text-white">
        {initials}
      </span>
      <span className="text-sm text-gray-700">{name}</span>
    </button>
  );
}
