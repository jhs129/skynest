const features = [
  {
    title: 'Always on',
    description:
      'Deployed on Vercel — your vault is reachable over HTTPS 24/7, not just when your Mac is open.',
  },
  {
    title: 'Multi-user',
    description:
      'Every team member signs in with their own GitHub account. Writes are committed with native git attribution.',
  },
  {
    title: 'Git-versioned',
    description:
      'Every document change is a real commit in a private GitHub repository — full history, diffs, and rollback.',
  },
];

export function FeaturesGrid() {
  return (
    <section className="grid grid-cols-1 gap-6 sm:grid-cols-3">
      {features.map((f) => (
        <div key={f.title} className="rounded-xl border border-gray-200 p-6 space-y-2">
          <h3 className="font-semibold text-gray-900">{f.title}</h3>
          <p className="text-sm text-gray-500">{f.description}</p>
        </div>
      ))}
    </section>
  );
}
