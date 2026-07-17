import { SubSection, CodeBlock, InlineCode } from '../shared';

export function EntraModeSteps() {
  return (
    <div className="space-y-6 rounded-lg border border-sky-200 bg-sky-50/40 p-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-sky-800">Mode B — Azure-native (Microsoft Entra ID)</h3>
        <p className="text-sm text-gray-600">
          Users sign in with Microsoft Entra ID, access is decided by security-group membership,
          and every write is recorded as a versioned Azure Blob upload. Use this when your
          organization is Microsoft-native and GitHub identities aren&apos;t an option.
        </p>
      </div>

      <SubSection title="B1. Register an Entra app registration">
        <p className="text-sm">
          In the <strong className="text-gray-800">Entra admin center → App registrations → New
          registration</strong>, then configure:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {[
                ['Redirect URI (Web)', 'https://<your-app>.vercel.app/api/auth/callback/microsoft-entra-id'],
                ['API permissions', 'Microsoft Graph → GroupMember.Read.All (delegated)'],
                ['Token configuration', 'Add the groups claim (security groups) to the ID token'],
                ['Client secret', 'Create one under Certificates & secrets'],
              ].map(([field, val]) => (
                <tr key={field} className="border-b border-gray-100">
                  <td className="py-2 pr-4 text-gray-600 text-sm whitespace-nowrap align-top">{field}</td>
                  <td className="py-2 font-mono text-xs text-gray-800">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm mt-2">
          Record the <strong className="text-gray-800">Directory (tenant) ID</strong>,{' '}
          <strong className="text-gray-800">Application (client) ID</strong>, and the{' '}
          <strong className="text-gray-800">client secret</strong>. Grant admin consent for the
          Graph permission so the group-membership fallback works.
        </p>
      </SubSection>

      <SubSection title="B2. Create read / write security groups">
        <p className="text-sm">
          In <strong className="text-gray-800">Entra → Groups</strong>, create two security
          groups — one for write access, one for read-only — and copy each group&apos;s{' '}
          <strong className="text-gray-800">Object ID</strong>. Add users to the appropriate
          group. Anyone in neither group is denied (403) at token exchange.
        </p>
      </SubSection>

      <SubSection title="B3. Provision the Azure Blob vault-sync container">
        <p className="text-sm">
          Create a storage account/container for the audit trail and{' '}
          <strong className="text-gray-800">enable blob versioning and soft-delete</strong> on it
          — the provider uploads a new version per write and a zero-byte tombstone version per
          delete, but it does not turn those features on itself.
        </p>
        <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
          Attribution in Azure mode is an app-asserted claim carried in blob metadata, not a
          cryptographically-signed commit the way GitHub mode is — an accepted tradeoff where no
          per-user write credential exists.
        </div>
      </SubSection>

      <SubSection title="B4. Set the Entra-mode environment variables">
        <CodeBlock>{`AUTH_PROVIDER=entra
ENTRA_TENANT_ID=<directory-tenant-id>
ENTRA_CLIENT_ID=<application-client-id>
ENTRA_CLIENT_SECRET=<client-secret>

# Authorization: group membership decides access (comma-separated for multiple)
AUTHZ_ENTRA_WRITE_GROUP_ID=<write-group-object-id>
AUTHZ_ENTRA_READ_GROUP_ID=<read-group-object-id>

# Vault sync: record writes as Azure Blob versions
VAULT_SYNC_PROVIDER=azure
VAULT_AZURE_STORAGE_ACCOUNT_URL=https://<account>.blob.core.windows.net
# or: VAULT_AZURE_STORAGE_CONNECTION_STRING=<connection-string>
VAULT_AZURE_CONTAINER=skynest-vault-sync   # optional`}</CodeBlock>
        <p className="text-sm">
          <InlineCode>VAULT_SYNC_PROVIDER=github</InlineCode> is rejected in Entra mode — there is
          no repo-scoped user token to authenticate git commits. See the{' '}
          <a href="#env" className="text-indigo-600 hover:underline">Environment variables</a>{' '}
          reference for the full list.
        </p>
      </SubSection>
    </div>
  );
}
