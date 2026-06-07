import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin — Skynest',
};

export default function AdminPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-4 text-center">
      <div className="text-5xl">🔒</div>
      <h1 className="text-3xl font-bold text-gray-900">Admin</h1>
      <p className="text-gray-500 max-w-sm">
        The admin section is coming soon. It will provide vault management, user access
        controls, and deployment configuration.
      </p>
    </div>
  );
}
