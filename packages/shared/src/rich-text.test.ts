import { describe, expect, it } from 'vitest';
import {
  embeddedAttachmentIds,
  imageToken,
  isSafeUrl,
  mentionToken,
  mentionedUserIds,
  parseInline,
  parseRichText,
  referencedKeys,
} from './rich-text';

const ID = '0192f0a1-2b3c-7d4e-8f90-a1b2c3d4e5f6';
const text = (v: string) => ({ t: 'text', v });

describe('parseInline', () => {
  it.each([
    ['plain words', [text('plain words')]],
    ['**bold**', [{ t: 'strong', c: [text('bold')] }]],
    ['*it*', [{ t: 'em', c: [text('it')] }]],
    ['_it_', [{ t: 'em', c: [text('it')] }]],
    ['`a*b*c`', [{ t: 'code', v: 'a*b*c' }]],
    ['a\nb', [text('a'), { t: 'br' }, text('b')]],
    ['\\*not\\*', [text('*not*')]],
    ['snake_case_name', [text('snake_case_name')]],
    ['2 * 3 * 4', [text('2 * 3 * 4')]],
    ['**unclosed', [text('**unclosed')]],
    ['`unclosed', [text('`unclosed')]],
  ])('%j', (input, expected) => {
    expect(parseInline(input)).toEqual(expected);
  });

  it('nests emphasis inside bold', () => {
    expect(parseInline('**a *b* c**')).toEqual([
      { t: 'strong', c: [text('a '), { t: 'em', c: [text('b')] }, text(' c')] },
    ]);
  });

  it('makes safe links, keeping their label formatted', () => {
    expect(parseInline('[the **docs**](https://forge.dev/a?b=1)')).toEqual([
      {
        t: 'link',
        href: 'https://forge.dev/a?b=1',
        c: [text('the '), { t: 'strong', c: [text('docs')] }],
      },
    ]);
    expect(parseInline('[mail](mailto:a@b.dev)')).toEqual([
      { t: 'link', href: 'mailto:a@b.dev', c: [text('mail')] },
    ]);
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](JavaScript:alert(1))',
    '[x](data:text/html,<script>alert(1)</script>)',
    '[x](vbscript:msgbox)',
    '[x](//evil.dev)',
    '[x](/relative)',
  ])('leaves an unsafe or malformed link as text: %s', (input) => {
    const nodes = parseInline(input);
    expect(nodes.some((node) => node.t === 'link')).toBe(false);
  });

  it('turns bare addresses into links without their trailing punctuation', () => {
    expect(parseInline('see https://forge.dev/x. Then')).toEqual([
      text('see '),
      { t: 'link', href: 'https://forge.dev/x', c: [text('https://forge.dev/x')] },
      text('. Then'),
    ]);
  });

  it('never links a link inside a label', () => {
    const [node] = parseInline('[go https://a.dev](https://b.dev)');
    expect(node).toEqual({
      t: 'link',
      href: 'https://b.dev',
      c: [text('go '), text('https://a.dev')],
    });
  });

  it('keeps markup as characters', () => {
    expect(parseInline('<script>alert(1)</script><img src=x onerror=alert(1)>')).toEqual([
      text('<script>alert(1)</script><img src=x onerror=alert(1)>'),
    ]);
  });

  it('reads ticket references at word edges only', () => {
    expect(parseInline('Fixes WEB-12, see API-3.')).toEqual([
      text('Fixes '),
      { t: 'ref', key: 'WEB-12' },
      text(', see '),
      { t: 'ref', key: 'API-3' },
      text('.'),
    ]);
    for (const input of ['XWEB-12x', 'web-12', 'WEB-0', 'WEB-12-3', 'A-1', 'UTF-8x', 'v2-WEB-1']) {
      expect(
        parseInline(input).some((node) => node.t === 'ref'),
        input,
      ).toBe(false);
    }
    expect(parseInline('`WEB-1`')).toEqual([{ t: 'code', v: 'WEB-1' }]);
  });

  it('reads mentions and images by id only', () => {
    expect(parseInline(`hi @[Sam Lee](user:${ID.toUpperCase()})`)).toEqual([
      text('hi '),
      { t: 'mention', userId: ID, name: 'Sam Lee' },
    ]);
    expect(parseInline(`![shot.png](attachment:${ID})`)).toEqual([
      { t: 'image', attachmentId: ID, alt: 'shot.png' },
    ]);
    expect(parseInline('@[Sam](user:not-an-id)')).toEqual([text('@[Sam](user:not-an-id)')]);
    expect(parseInline('![x](https://evil.dev/x.png)').some((n) => n.t === 'image')).toBe(false);
  });
});

describe('parseRichText', () => {
  it('reads headings, paragraphs, code, quotes and lists', () => {
    const blocks = parseRichText(
      [
        '# Title',
        '### Small',
        '#### not a heading',
        '',
        'one',
        'two',
        '```ts',
        'const a = **b**;',
        '```',
        '> quoted **x**',
        '> more',
        '- a',
        '  - a1',
        '- b',
        '3. c',
        '4. d',
      ].join('\r\n'),
    );
    expect(blocks).toEqual([
      { t: 'h', level: 1, c: [text('Title')] },
      { t: 'h', level: 3, c: [text('Small')] },
      { t: 'p', c: [text('#### not a heading')] },
      { t: 'p', c: [text('one'), { t: 'br' }, text('two')] },
      { t: 'pre', v: 'const a = **b**;' },
      {
        t: 'quote',
        c: [
          {
            t: 'p',
            c: [text('quoted '), { t: 'strong', c: [text('x')] }, { t: 'br' }, text('more')],
          },
        ],
      },
      {
        t: 'ul',
        start: 1,
        items: [
          { c: [text('a')], sub: { t: 'ul', start: 1, items: [{ c: [text('a1')], sub: null }] } },
          { c: [text('b')], sub: null },
        ],
      },
      {
        t: 'ol',
        start: 3,
        items: [
          { c: [text('c')], sub: null },
          { c: [text('d')], sub: null },
        ],
      },
    ]);
  });

  it('keeps an unclosed code fence to the end', () => {
    expect(parseRichText('```\nx\n# y')).toEqual([{ t: 'pre', v: 'x\n# y' }]);
  });

  it('stops nesting quotes after three levels', () => {
    const blocks = parseRichText('>>>> deep');
    const depth = (b: unknown): number =>
      (b as { t: string }).t === 'quote' ? 1 + depth((b as { c: unknown[] }).c[0]) : 0;
    expect(depth(blocks[0])).toBe(3);
  });

  it('stays fast on hostile input', () => {
    const hostile = [
      '**['.repeat(7000),
      '[a]('.repeat(5000),
      '`*_'.repeat(7000),
      'h'.repeat(20_000),
      'WEB-'.repeat(5000),
      '> '.repeat(10_000),
      '- '.repeat(10_000),
      '@['.repeat(10_000),
    ];
    for (const input of hostile) {
      const started = performance.now();
      parseRichText(input);
      expect(performance.now() - started, input.slice(0, 8)).toBeLessThan(250);
    }
  });
});

describe('extraction', () => {
  const body = `Needs WEB-1 and WEB-1 and API-2, not \`WEB-3\`.\n- @[Sam](user:${ID}) ![a](attachment:${ID})`;

  it('lists each referenced key once', () => {
    expect(referencedKeys(body)).toEqual(['WEB-1', 'API-2']);
  });

  it('lists mentioned people and embedded files', () => {
    expect(mentionedUserIds(body)).toEqual([ID]);
    expect(embeddedAttachmentIds(body)).toEqual([ID]);
  });
});

describe('tokens', () => {
  it('builds tokens the parser reads back, whatever the name holds', () => {
    expect(parseInline(mentionToken(ID, 'Sam [x](y)\n'))).toEqual([
      { t: 'mention', userId: ID, name: 'Sam xy' },
    ]);
    expect(parseInline(imageToken(ID, ''))).toEqual([
      { t: 'image', attachmentId: ID, alt: 'image' },
    ]);
  });

  it('allows only web and mail addresses', () => {
    expect(isSafeUrl('https://a.dev')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('https://a.dev/"onmouseover=x')).toBe(false);
  });
});
