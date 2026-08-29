import { Section, InlineCode } from '../shared';
import { auth } from '@/lib/auth';
import { resolveBootstrapSkill } from '@/lib/vault/bootstrap-skill';
import { VaultSkill } from './VaultSkill';
import { FallbackSkill } from './FallbackSkill';

/**
 * The docs page is public, so the vault is only read for a signed-in visitor —
 * a skill node's trigger and node paths are vault content and should not be
 * served anonymously. Signed-out visitors see the generic template.
 */
export async function DocsSkill() {
  const session = await auth();
  const serverAlias = process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'skynest';
  const skill = session ? await resolveBootstrapSkill(serverAlias) : null;

  return (
    <Section id="skill" title="Claude Code skill">
      <div className="space-y-6 text-gray-600">
        <p className="text-sm">
          A <strong>Claude Code skill</strong> is a Markdown file that Claude loads on demand to
          guide how it interacts with a specific tool or service. A Skynest vault can carry its
          own skill as a node, so the instructions for using <em>this</em> vault live beside the
          knowledge itself rather than in a copy on each machine.
        </p>

        {skill ? (
          <VaultSkill skill={skill} serverAlias={serverAlias} />
        ) : (
          <>
            {session ? null : (
              <p className="text-sm">
                Sign in to see this vault&apos;s own entry-point skill, if it hosts one.
              </p>
            )}
            <FallbackSkill />
          </>
        )}

        <p className="text-sm">
          Agents can also discover skills directly:{' '}
          <InlineCode>{'list_documents({ type: "skill" })'}</InlineCode> enumerates them, and{' '}
          <InlineCode>vault_info</InlineCode> names the designated entry point.
        </p>
      </div>
    </Section>
  );
}
