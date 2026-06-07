import Link from 'next/link';

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="text-center space-y-6 py-8">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900">
          Your team&apos;s knowledge, always available
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto">
          Skynest is a hosted{' '}
          <a
            href="https://github.com/PromptOwl/ContextNest"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            Context Nest
          </a>{' '}
          MCP server. Connect your AI tools once and access your shared vault from anywhere —
          no local setup, no OneDrive, no manual syncing.
        </p>
        <Link
          href="/faq"
          className="inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          Get connected →
        </Link>
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 p-6 space-y-2">
          <h3 className="font-semibold text-gray-900">Always on</h3>
          <p className="text-sm text-gray-500">
            Deployed on Vercel — your vault is reachable over HTTPS 24/7, not just when
            your Mac is open.
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 p-6 space-y-2">
          <h3 className="font-semibold text-gray-900">Multi-user</h3>
          <p className="text-sm text-gray-500">
            Every team member signs in with their own GitHub account. Writes are committed
            with native git attribution.
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 p-6 space-y-2">
          <h3 className="font-semibold text-gray-900">Git-versioned</h3>
          <p className="text-sm text-gray-500">
            Every document change is a real commit in a private GitHub repository — full
            history, diffs, and rollback.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-gray-900">How it works</h2>
        <ol className="space-y-3 text-gray-600">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold flex items-center justify-center">1</span>
            <span>Sign in with your GitHub account when prompted by your AI tool.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold flex items-center justify-center">2</span>
            <span>Skynest authenticates you via OAuth and issues a secure session token.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold flex items-center justify-center">3</span>
            <span>Your AI tool can now read, search, create, and update vault documents over MCP.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold flex items-center justify-center">4</span>
            <span>Every write is committed to the vault repo under your GitHub identity.</span>
          </li>
        </ol>
      </section>
    </div>
  );
}
