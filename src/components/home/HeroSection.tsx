import Link from 'next/link';

export function HeroSection() {
  return (
    <section className="text-center space-y-6 py-8">
      <h1 className="text-5xl font-bold tracking-tight text-gray-900">
        Your team&apos;s knowledge, always available
      </h1>
      <p className="text-xl text-gray-500 max-w-2xl mx-auto">
        Skynest brings{' '}
        <a
          href="https://github.com/PromptOwl/ContextNest"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 hover:underline"
        >
          Context Nest
        </a>{' '}
        to the cloud — a hosted MCP server your whole team can connect to from any AI tool,
        anywhere, without running anything locally.
      </p>
      <Link
        href="/faq"
        className="inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
      >
        Get connected →
      </Link>
    </section>
  );
}
