import { SubSection, CodeBlock, InlineCode } from '../shared';

export function GitHubModeSteps() {
  return (
    <div className="space-y-6 rounded-lg border border-emerald-200 bg-emerald-50/40 p-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-emerald-800">Mode A — GitHub-native</h3>
        <p className="text-sm text-gray-600">
          Users sign in with GitHub, access is decided by their permission on a vault repo, and
          every write is committed to that repo under their own identity.
        </p>
      </div>

      <SubSection title="A1. Create the vault repository">
        <p className="text-sm">
          The vault repo is a <strong className="text-gray-800">private</strong> GitHub repository
          that stores a version-controlled copy of every document. Create it, then push any
          existing vault content:
        </p>
        <CodeBlock>{`bash scripts/init-vault.sh /path/to/your/vault https://github.com/<you>/my-vault.git`}</CodeBlock>
        <p className="text-sm">
          Starting fresh? Create an empty private repo — the vault initializes on first write. Add
          each team member as a collaborator so their tokens can commit and so they pass the
          access check.
        </p>
      </SubSection>

      <SubSection title="A2. Register a GitHub OAuth App">
        <p className="text-sm">
          Go to <strong className="text-gray-800">GitHub → Settings → Developer settings → OAuth Apps → New OAuth App</strong>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {[
                ['Application name', 'Skynest'],
                ['Homepage URL', 'https://<your-app>.vercel.app'],
                ['Authorization callback URL', 'https://<your-app>.vercel.app/api/auth/callback/github'],
              ].map(([field, val]) => (
                <tr key={field} className="border-b border-gray-100">
                  <td className="py-2 pr-4 text-gray-600 text-sm">{field}</td>
                  <td className="py-2 font-mono text-xs text-gray-800">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm mt-2">
          Note the <strong className="text-gray-800">Client ID</strong> and generate a{' '}
          <strong className="text-gray-800">Client Secret</strong> — these become{' '}
          <InlineCode>GITHUB_CLIENT_ID</InlineCode> and <InlineCode>GITHUB_CLIENT_SECRET</InlineCode>.
          The app requests the <InlineCode>repo</InlineCode> scope so the user&apos;s token can also
          commit vault writes.
        </p>
      </SubSection>

      <SubSection title="A3. Set the GitHub-mode environment variables">
        <p className="text-sm">
          In addition to the common variables, set:
        </p>
        <CodeBlock>{`AUTH_PROVIDER=github                 # default; may be omitted
GITHUB_CLIENT_ID=<oauth-app-client-id>
GITHUB_CLIENT_SECRET=<oauth-app-client-secret>

# Authorization: repo whose collaborator permission gates access
AUTHZ_GITHUB_REPO=<you>/my-vault      # push/admin → write, pull → read, none → 403

# Vault sync: commit every write to the repo
VAULT_SYNC_PROVIDER=github            # default in GitHub mode when VAULT_REPO is set
VAULT_REPO=<you>/my-vault
VAULT_BRANCH=main                     # optional`}</CodeBlock>
        <p className="text-sm">
          See the <a href="#env" className="text-indigo-600 hover:underline">Environment variables</a>{' '}
          reference for defaults and the full list.
        </p>
      </SubSection>
    </div>
  );
}
