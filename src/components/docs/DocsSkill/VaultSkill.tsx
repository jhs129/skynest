import { CodeBlock, SubSection, InlineCode } from '../shared';
import type { ResolvedBootstrapSkill } from '@/lib/vault/bootstrap-skill';

interface Props {
  skill: ResolvedBootstrapSkill;
  serverAlias: string;
}

/** Renders this vault's real entry-point skill, as a copyable loader. */
export function VaultSkill({ skill, serverAlias }: Props) {
  const file = skill.manifest.files[0];

  return (
    <>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p>
          This vault hosts its own skill:{' '}
          <strong>{skill.title}</strong> at <InlineCode>{skill.path}</InlineCode>. Everything
          below is generated from that node, so it stays current as the node changes.
        </p>
      </div>

      <SubSection title="Let an agent install it">
        <p className="text-sm">
          The quickest path — ask any agent connected to this server to run:
        </p>
        <CodeBlock>
          {`mcp__${serverAlias}__get_skill_install_manifest({ path: "${skill.path}" })`}
        </CodeBlock>
        <p className="text-sm">
          The server has no access to your filesystem, so the <em>agent</em> writes the returned
          files. Replace <InlineCode>{serverAlias}</InlineCode> with whatever you named this
          server in your MCP config, and pass it as{' '}
          <InlineCode>server_alias</InlineCode> so the generated loader calls back through the
          right prefix.
        </p>
      </SubSection>

      <SubSection title="Or install it by hand">
        <p className="text-sm">
          Save this to <InlineCode>{file.relative_path}</InlineCode>. It is a{' '}
          <strong>loader</strong>: it carries the trigger that decides when the skill fires, plus
          an instruction to fetch the procedure from the vault at run time. The steps
          deliberately live in the vault, not in this file — a local copy of a procedure drifts
          the moment the node is updated, and the drift is invisible.
        </p>
        <CodeBlock>{file.content}</CodeBlock>
        <p className="text-sm">{skill.manifest.post_install}</p>
      </SubSection>
    </>
  );
}
