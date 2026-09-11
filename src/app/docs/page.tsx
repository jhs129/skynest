import type { Metadata } from 'next';
import Link from 'next/link';
import { DocsOverview } from '@/components/docs/DocsOverview';
import { DocsArchitecture } from '@/components/docs/DocsArchitecture';
import { DocsDeployment } from '@/components/docs/DocsDeployment';
import { DocsEnvVars } from '@/components/docs/DocsEnvVars';
import { DocsAccessControl } from '@/components/docs/DocsAccessControl';
import { DocsConnecting } from '@/components/docs/DocsConnecting';
import { DocsSkill } from '@/components/docs/DocsSkill';
import { DocsMcpTools } from '@/components/docs/DocsMcpTools';
import { DocsWebhook } from '@/components/docs/DocsWebhook';
import { DocsLocalDev } from '@/components/docs/DocsLocalDev';
import { SignInPrompt } from '@/components/auth/SignInPrompt';
import { isPublicHomepageEnabled } from '@/lib/config/instance-mode';

export const metadata: Metadata = {
  title: 'Docs — Skynest',
  description: 'Skynest documentation: deployment guide, connection instructions, and MCP tool reference.',
};

const TOC = [
  { id: 'overview', label: 'What is Skynest?' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'deploy', label: 'Deploying Skynest' },
  { id: 'env', label: 'Environment variables' },
  { id: 'access', label: 'Access control' },
  { id: 'connect', label: 'Connecting your AI tool' },
  { id: 'skill', label: 'Claude Code skill' },
  { id: 'tools', label: 'Available MCP tools' },
  { id: 'webhook', label: 'read.ai Webhook' },
  { id: 'local-dev', label: 'Local development' },
];

export default function DocsPage() {
  if (!isPublicHomepageEnabled()) {
    return <SignInPrompt description="This is a private Skynest instance." />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Docs</h1>
        <p className="text-gray-500">
          Skynest — hosted{' '}
          <a
            href="https://github.com/PromptOwl/ContextNest"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            Context Nest
          </a>{' '}
          MCP server on Vercel.
        </p>
      </div>

      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm border-b border-gray-200 pb-4">
        {TOC.map((item) => (
          <Link
            key={item.id}
            href={`#${item.id}`}
            className="text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="space-y-12 pt-4">
        <DocsOverview />
        <DocsArchitecture />
        <DocsDeployment />
        <DocsEnvVars />
        <DocsAccessControl />
        <DocsConnecting />
        <DocsSkill />
        <DocsMcpTools />
        <DocsWebhook />
        <DocsLocalDev />
      </div>
    </div>
  );
}
