'use client';

import {
  parseInline,
  parseRichText,
  type Block,
  type Inline,
  type List,
  type TicketRef,
} from '@forge/shared';
import Link from 'next/link';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { workspaceHref } from '@/lib/nav';

/**
 * What formatted text needs to know about where it is shown: which workspace (for links), which
 * ticket keys exist (only those become links), who the members are now (mentions show the current
 * name), and the ticket whose attachments embedded images come from.
 */
export type RichTextScope = {
  slug: string;
  organisationId: string;
  ticketKey: string;
  references: ReadonlyMap<string, TicketRef>;
  memberNames: ReadonlyMap<string, string>;
  /** Who `@` may suggest. */
  members: { id: string; displayName: string; email: string }[];
};

const ScopeContext = createContext<RichTextScope | null>(null);

export function RichTextScopeProvider({
  slug,
  organisationId,
  ticketKey,
  references,
  members,
  children,
}: {
  slug: string;
  organisationId: string;
  ticketKey: string;
  references: TicketRef[];
  members: { id: string; displayName: string; email: string }[];
  children: ReactNode;
}) {
  const scope = useMemo(
    () => ({
      slug,
      organisationId,
      ticketKey,
      references: new Map(references.map((ref) => [ref.key, ref])),
      memberNames: new Map(members.map((member) => [member.id, member.displayName])),
      members,
    }),
    [slug, organisationId, ticketKey, references, members],
  );
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

export function useRichTextScope(): RichTextScope | null {
  return useContext(ScopeContext);
}

export function attachmentUrl(
  scope: Pick<RichTextScope, 'organisationId' | 'ticketKey'>,
  id: string,
  inline = false,
) {
  return `/api/v1/orgs/${scope.organisationId}/tickets/${scope.ticketKey}/attachments/${id}/file${
    inline ? '?inline=1' : ''
  }`;
}

const LINK = 'underline decoration-muted/70 underline-offset-2 hover:decoration-text';

function InlineNodes({ nodes, scope }: { nodes: Inline[]; scope: RichTextScope | null }) {
  return nodes.map((node, index) => <InlineNode key={index} node={node} scope={scope} />);
}

function InlineNode({ node, scope }: { node: Inline; scope: RichTextScope | null }) {
  switch (node.t) {
    case 'text':
      return node.v;
    case 'br':
      return <br />;
    case 'strong':
      return (
        <strong className="font-semibold">
          <InlineNodes nodes={node.c} scope={scope} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <InlineNodes nodes={node.c} scope={scope} />
        </em>
      );
    case 'code':
      return <code className="rounded bg-raised px-1 py-0.5 font-mono text-[0.9em]">{node.v}</code>;
    case 'link':
      return (
        <a href={node.href} target="_blank" rel="noopener noreferrer nofollow" className={LINK}>
          <InlineNodes nodes={node.c} scope={scope} />
        </a>
      );
    case 'mention': {
      const current = scope?.memberNames.get(node.userId);
      return (
        <span
          className={`rounded px-1 font-medium ${current ? 'bg-active/15 text-text' : 'bg-raised text-muted'}`}
          title={current ? undefined : 'No longer a member of this workspace'}
        >
          @{current ?? node.name}
        </span>
      );
    }
    case 'ref': {
      const ref = scope?.references.get(node.key);
      if (!ref || !scope) return node.key;
      return (
        <Link
          href={workspaceHref(scope.slug, `/tickets/${ref.key}`)}
          title={`${ref.key} ${ref.title} (${ref.status.name})`}
          className={`${LINK} font-mono text-[0.92em] ${ref.status.category === 'completed' ? 'line-through' : ''}`}
        >
          {ref.key}
        </Link>
      );
    }
    case 'image':
      if (!scope) return `[${node.alt}]`;
      return (
        <a href={attachmentUrl(scope, node.attachmentId)} className="my-1 inline-block">
          <img
            src={attachmentUrl(scope, node.attachmentId, true)}
            alt={node.alt}
            loading="lazy"
            className="max-h-80 max-w-full rounded border border-edge"
          />
        </a>
      );
  }
}

function ListBlock({ list, scope }: { list: List; scope: RichTextScope | null }) {
  const items = list.items.map((item, index) => (
    <li key={index}>
      <InlineNodes nodes={item.c} scope={scope} />
      {item.sub && <ListBlock list={item.sub} scope={scope} />}
    </li>
  ));
  return list.t === 'ol' ? (
    <ol start={list.start} className="ml-5 list-decimal space-y-0.5">
      {items}
    </ol>
  ) : (
    <ul className="ml-5 list-disc space-y-0.5">{items}</ul>
  );
}

function Blocks({ blocks, scope }: { blocks: Block[]; scope: RichTextScope | null }) {
  return blocks.map((block, index) => {
    switch (block.t) {
      case 'p':
        return (
          <p key={index}>
            <InlineNodes nodes={block.c} scope={scope} />
          </p>
        );
      case 'h': {
        const className = [
          'text-[17px] font-semibold',
          'text-[15px] font-semibold',
          'text-[14px] font-semibold',
        ][block.level - 1];
        const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1]!;
        return (
          <Tag key={index} className={className}>
            <InlineNodes nodes={block.c} scope={scope} />
          </Tag>
        );
      }
      case 'pre':
        return (
          <pre
            key={index}
            className="overflow-x-auto rounded-md border border-edge bg-raised p-3 font-mono text-[12.5px] leading-relaxed"
          >
            <code>{block.v}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={index} className="border-l-2 border-edge-strong pl-3 text-muted">
            <Blocks blocks={block.c} scope={scope} />
          </blockquote>
        );
      default:
        return <ListBlock key={index} list={block} scope={scope} />;
    }
  });
}

/**
 * Formatted text. It is parsed into known nodes and drawn with React elements; nothing the text
 * contains is ever handed to the browser as markup.
 */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const scope = useRichTextScope();
  const blocks = useMemo(() => parseRichText(text), [text]);
  return (
    <div
      className={`flex max-w-prose flex-col gap-2 break-words text-[14px] leading-relaxed ${className}`}
    >
      <Blocks blocks={blocks} scope={scope} />
    </div>
  );
}

/** One line of formatting (a goal or a criterion): emphasis, code, links, mentions, references. */
export function RichLine({ text }: { text: string }) {
  const scope = useRichTextScope();
  const nodes = useMemo(() => parseInline(text), [text]);
  return <InlineNodes nodes={nodes} scope={scope} />;
}
