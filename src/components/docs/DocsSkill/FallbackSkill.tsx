import { CodeBlock, SubSection, InlineCode } from '../shared';
import { SKILL_TEMPLATE } from './fallback-template';

/**
 * Shown when the vault designates no entry-point skill. Explicitly labelled as a
 * generic starting point so nobody mistakes it for this instance's real skill.
 */
export function FallbackSkill() {
  return (
    <>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">This vault hosts no entry-point skill yet.</p>
        <p className="mt-1">
          The template below is a <strong>generic starting point</strong>, not your vault&apos;s
          own instructions — it knows nothing about what you have stored. To make the vault
          describe itself, save a <InlineCode>type: skill</InlineCode> node and point{' '}
          <InlineCode>skills.bootstrap</InlineCode> in{' '}
          <InlineCode>.context/config.yaml</InlineCode> at it:
        </p>
        <CodeBlock>{'skills:\n  bootstrap: nodes/skills/vault-bootstrap'}</CodeBlock>
        <p className="mt-2">
          After that, this page renders the real skill and agents can install it with{' '}
          <InlineCode>get_skill_install_manifest</InlineCode>.
        </p>
      </div>

      <SubSection title="Generic template">
        <p className="text-sm">
          Save this to <InlineCode>~/.claude/skills/skynest/SKILL.md</InlineCode> (create the
          directory if it doesn&apos;t exist) and adapt the{' '}
          <InlineCode>description</InlineCode> and vault-structure sections to your own layout
          and tags. Because it is a local copy, it will drift as your vault changes — a
          vault-hosted skill does not.
        </p>
        <CodeBlock>{SKILL_TEMPLATE}</CodeBlock>
      </SubSection>
    </>
  );
}
