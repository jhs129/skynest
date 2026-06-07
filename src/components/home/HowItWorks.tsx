const steps = [
  'Sign in with your GitHub account when prompted by your AI tool.',
  'Skynest authenticates you via OAuth and issues a secure session token.',
  'Your AI tool can now read, search, create, and update vault documents over MCP.',
  'Every write is committed to the vault repo under your GitHub identity.',
];

export function HowItWorks() {
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-semibold text-gray-900">How it works</h2>
      <ol className="space-y-3 text-gray-600">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold flex items-center justify-center">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
