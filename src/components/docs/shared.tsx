export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-gray-950 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm">
      <code>{children}</code>
    </pre>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-4 scroll-mt-8">
      <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-200 pb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-medium text-gray-800">{title}</h3>
      {children}
    </div>
  );
}

export function InlineCode({ children }: { children: string }) {
  return <code className="bg-gray-100 px-1 rounded text-sm">{children}</code>;
}
