import { Section, SubSection, InlineCode } from './shared';

const SCOPE_LEVELS = [
  {
    level: 'write',
    scopes: 'mcp:read mcp:write',
    result: 'Full access — can read and run every write/governance tool.',
    color: 'text-emerald-700',
  },
  {
    level: 'read',
    scopes: 'mcp:read',
    result: 'Read-only — write and governance tools are rejected up front.',
    color: 'text-indigo-700',
  },
  {
    level: 'none',
    scopes: '—',
    result: 'Denied — the token endpoint returns 403 access_denied and issues no token at all.',
    color: 'text-red-600',
  },
];

export function DocsAccessControl() {
  return (
    <Section id="access" title="Access control & authorization">
      <div className="space-y-6 text-gray-600">
        <p className="text-sm leading-relaxed">
          Authenticating proves <em>who</em> you are; authorization decides <em>what</em> you
          can do. When an MCP client exchanges its authorization code for an access token,
          Skynest asks an <InlineCode>AuthorizationProvider</InlineCode> to grade the caller
          into one of three access levels and encodes the result as OAuth scopes on the token.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 pr-4 font-medium text-gray-700">Access level</th>
                <th className="text-left py-2 pr-4 font-medium text-gray-700">Token scopes</th>
                <th className="text-left py-2 font-medium text-gray-700">What the caller can do</th>
              </tr>
            </thead>
            <tbody>
              {SCOPE_LEVELS.map((s) => (
                <tr key={s.level} className="border-b border-gray-100">
                  <td className={`py-2 pr-4 font-mono text-xs font-medium whitespace-nowrap ${s.color}`}>{s.level}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-800 whitespace-nowrap">{s.scopes}</td>
                  <td className="py-2 text-gray-500 text-xs">{s.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <SubSection title="How the level is decided">
          <p className="text-sm">
            The check runs against whichever identity mode is active (see{' '}
            <a href="#deploy" className="text-indigo-600 hover:underline">Deploying Skynest</a>):
          </p>
          <ul className="text-sm space-y-2 list-disc list-inside">
            <li>
              <strong className="text-gray-800">GitHub mode</strong> — the caller&apos;s permission
              level on the repo named by <InlineCode>AUTHZ_GITHUB_REPO</InlineCode> is checked with
              their own GitHub token. Push/admin access grants{' '}
              <span className="font-mono text-xs">write</span>, pull access grants{' '}
              <span className="font-mono text-xs">read</span>, and no access is{' '}
              <span className="font-mono text-xs">none</span>.
            </li>
            <li>
              <strong className="text-gray-800">Entra mode</strong> — group membership decides the
              level. Members of <InlineCode>AUTHZ_ENTRA_WRITE_GROUP_ID</InlineCode> get{' '}
              <span className="font-mono text-xs">write</span>, members of{' '}
              <InlineCode>AUTHZ_ENTRA_READ_GROUP_ID</InlineCode> get{' '}
              <span className="font-mono text-xs">read</span>, and everyone else is{' '}
              <span className="font-mono text-xs">none</span>. Membership is read from the ID
              token&apos;s <InlineCode>groups</InlineCode> claim, falling back to a Microsoft Graph{' '}
              <InlineCode>checkMemberGroups</InlineCode> call when the claim is absent (large group
              memberships get overaged out of the token). Each variable accepts a comma-separated
              list of group IDs.
            </li>
          </ul>
        </SubSection>

        <SubSection title="Enforced twice">
          <p className="text-sm">
            Scope is enforced at issuance <em>and</em> at the point of use. Even if a read-only
            token somehow reached a write path, all seven write tools (
            <InlineCode>create_document</InlineCode>, <InlineCode>update_document</InlineCode>,{' '}
            <InlineCode>delete_document</InlineCode>, <InlineCode>publish_document</InlineCode>,{' '}
            <InlineCode>stage_drift_suggestion</InlineCode>,{' '}
            <InlineCode>approve_suggestion</InlineCode>, <InlineCode>reject_suggestion</InlineCode>)
            re-check for <InlineCode>mcp:write</InlineCode> and reject the call before touching
            storage.
          </p>
        </SubSection>

        <SubSection title="Trusted issuer (dual authorization server)">
          <p className="text-sm">
            Skynest normally issues its own OAuth tokens. Optionally, it can <em>also</em> accept
            tokens issued directly by a trusted Entra tenant — for example an on-behalf-of token
            from a Copilot Studio connector — without changing the self-issued flow at all. Set{' '}
            <InlineCode>MCP_TRUSTED_ISSUER</InlineCode> and{' '}
            <InlineCode>MCP_TRUSTED_AUDIENCE</InlineCode> to enable it.
          </p>
          <p className="text-sm">
            When set, an incoming token whose <InlineCode>iss</InlineCode> matches the trusted
            issuer is verified against that tenant&apos;s JWKS with an exact audience match, then
            run through the <em>same</em> <InlineCode>AuthorizationProvider</InlineCode> as above
            (its <InlineCode>groups</InlineCode> claim feeds the Entra check). Every other token —
            and all tokens when the vars are unset — takes the normal self-issued path unchanged.
            The <InlineCode>.well-known/oauth-protected-resource</InlineCode> document advertises
            the trusted issuer as a second entry in{' '}
            <InlineCode>authorization_servers</InlineCode> whenever it is configured.
          </p>
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
            <strong>Fail-closed:</strong> if <InlineCode>MCP_TRUSTED_ISSUER</InlineCode> is set but{' '}
            <InlineCode>MCP_TRUSTED_AUDIENCE</InlineCode> is left unset, external tokens are
            rejected rather than accepted with audience validation skipped.
          </div>
        </SubSection>
      </div>
    </Section>
  );
}
