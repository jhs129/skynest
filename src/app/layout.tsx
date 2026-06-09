import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Skynest',
  description: 'Hosted Context Nest MCP server — always-on, multi-user, git-versioned.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <header className="border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpg" alt="Skynest" className="h-8 w-auto" />
              <span className="text-lg font-semibold">Skynest</span>
            </Link>
            <nav className="flex gap-6 text-sm font-medium text-gray-600">
              <Link href="/" className="hover:text-gray-900 transition-colors">Home</Link>
              <Link href="/docs" className="hover:text-gray-900 transition-colors">Docs</Link>
              <Link href="/faq" className="hover:text-gray-900 transition-colors">FAQ</Link>
              <Link href="/admin" className="hover:text-gray-900 transition-colors">Admin</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-12">
          {children}
        </main>
        <footer className="border-t border-gray-200 mt-24">
          <div className="max-w-4xl mx-auto px-6 py-6 text-sm text-gray-400 text-center">
            Skynest — Hosted Context Nest MCP
          </div>
        </footer>
      </body>
    </html>
  );
}
