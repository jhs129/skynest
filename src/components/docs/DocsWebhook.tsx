import { Section, SubSection, CodeBlock, InlineCode } from './shared';

export function DocsWebhook() {
  return (
    <Section id="webhook" title="read.ai Webhook">
      <div className="space-y-6 text-gray-600">
        <p className="text-sm leading-relaxed">
          Skynest can automatically ingest meeting transcripts from{' '}
          <a
            href="https://read.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            read.ai
          </a>{' '}
          when a meeting ends. The webhook uses HMAC-SHA256 signature verification and
          deduplication by <InlineCode>request_id</InlineCode>. A Claude Haiku model
          classifies each meeting (client, tags, summary, action items) before writing
          a structured node to the vault.
        </p>

        <SubSection title="Required environment variables">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {[
                  ['WEBHOOK_API_KEY', 'Secret key embedded in the webhook URL path'],
                  ['READ_AI_SIGNING_KEY', 'HMAC signing key from the read.ai dashboard'],
                  ['BOT_GITHUB_TOKEN', 'GitHub PAT with repo scope — used for vault commits'],
                ].map(([name, desc]) => (
                  <tr key={name} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-800 whitespace-nowrap">{name}</td>
                    <td className="py-2 text-gray-500 text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SubSection>

        <SubSection title="Webhook URL">
          <p className="text-sm">Configure this URL in your read.ai workspace settings:</p>
          <CodeBlock>{`https://YOUR_SKYNEST_URL/api/webhooks/YOUR_WEBHOOK_API_KEY/default/readai`}</CodeBlock>
          <p className="text-sm">
            Replace <InlineCode>YOUR_WEBHOOK_API_KEY</InlineCode> with the value of your{' '}
            <InlineCode>WEBHOOK_API_KEY</InlineCode> environment variable. Replace{' '}
            <InlineCode>default</InlineCode> with your vault ID if you&apos;re using a named
            vault (<InlineCode>CONTEXTNEST_DEFAULT_VAULT_ID</InlineCode>).
          </p>
          <p className="text-sm">
            Set the <strong className="text-gray-800">signing key</strong> in read.ai to the
            value of <InlineCode>READ_AI_SIGNING_KEY</InlineCode>.
          </p>
        </SubSection>

        <SubSection title="What happens on each meeting">
          <ol className="space-y-2 text-sm list-decimal list-inside">
            <li>read.ai POSTs the transcript payload to the webhook URL</li>
            <li>Skynest verifies the HMAC-SHA256 signature using <InlineCode>READ_AI_SIGNING_KEY</InlineCode></li>
            <li>Deduplication check by <InlineCode>request_id</InlineCode> (returns 200 immediately if duplicate)</li>
            <li>Claude Haiku analyzes the meeting: client classification, tags, summary, action items</li>
            <li>A structured markdown node is written to <InlineCode>nodes/meetings/YYYY-MM-DD-slug.md</InlineCode></li>
            <li>The file is committed to the vault GitHub repo under the bot&apos;s identity (after the response is sent)</li>
          </ol>
        </SubSection>

        <div className="rounded-lg bg-amber-50 border border-amber-100 p-4 text-sm text-amber-800">
          <strong>Note:</strong> If the vault write fails, Skynest returns a 500 so read.ai
          will retry. The git commit runs asynchronously after the response — a commit failure
          is logged but does not affect the response.
        </div>
      </div>
    </Section>
  );
}
