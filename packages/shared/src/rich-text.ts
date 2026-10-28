// Forge's formatting: a small Markdown subset turned into a tree of known nodes. Screens render the
// tree with their own elements, so text never reaches a page as markup: anything this parser does
// not recognise stays the characters it is.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'mention'; userId: string; name: string }
  | { t: 'ref'; key: string }
  | { t: 'image'; attachmentId: string; alt: string }
  | { t: 'br' };

export type ListItem = { c: Inline[]; sub: List | null };
export type List = { t: 'ul' | 'ol'; start: number; items: ListItem[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'pre'; v: string }
  | { t: 'quote'; c: Block[] }
  | List;

/** Only these schemes become links; `javascript:`, `data:` and the rest stay plain text. */
const SAFE_URL = /^(https?:\/\/|mailto:)[^\s<>"]+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Sticky (`y`): matched at a position without copying the rest of the text.
const BARE_URL = /https?:\/\/[^\s<>"]+/iy;
const TICKET_REF = /[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}/y;
const MAX_INLINE_DEPTH = 4;
const MAX_QUOTE_DEPTH = 3;

export const isSafeUrl = (url: string) => SAFE_URL.test(url);

/** A mention as stored in text: `@[Name](user:<id>)`. The name is only shown if the id is unknown. */
export function mentionToken(userId: string, name: string): string {
  const safeName = name.replace(/[[\]()\n\r]/g, '').trim() || 'someone';
  return `@[${safeName}](user:${userId})`;
}

/** An attachment shown in text: `![name](attachment:<id>)`. */
export function imageToken(attachmentId: string, name: string): string {
  const safeName = name.replace(/[[\]()\n\r]/g, '').trim() || 'image';
  return `![${safeName}](attachment:${attachmentId})`;
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

// Labels and link targets are looked for only this far ahead, so a text full of unmatched `[` or
// `(` cannot make the parse quadratic.
const MAX_LABEL = 500;
const MAX_TARGET = 2048;

/** Text from `start` to the matching `]`, allowing balanced brackets inside; -1 if none. */
function closingBracket(text: string, start: number): number {
  let depth = 0;
  const limit = Math.min(text.length, start + MAX_LABEL);
  for (let i = start; i < limit; i += 1) {
    const ch = text[i];
    if (ch === '\n' && text[i + 1] === '\n') return -1;
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/** `(target)` right after a `]`, as [target, index after the `)`], or null. */
function parenTarget(text: string, at: number): [string, number] | null {
  if (text[at] !== '(') return null;
  let end = -1;
  for (let i = at + 1; i < Math.min(text.length, at + MAX_TARGET); i += 1) {
    if (text[i] === ')') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const target = text.slice(at + 1, end);
  if (/\s/.test(target)) return null;
  return [target, end + 1];
}

/**
 * Inline text into nodes. Each closing search that fails is remembered, so a run of unmatched
 * markers costs one scan instead of one per marker: the whole parse stays roughly linear.
 */
export function parseInline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ t: 'text', v: buffer });
    buffer = '';
  };
  const noCloserAfter = new Map<string, number>();
  const find = (marker: string, from: number): number => {
    const failed = noCloserAfter.get(marker);
    if (failed !== undefined && from >= failed) return -1;
    const found = text.indexOf(marker, from);
    if (found === -1) noCloserAfter.set(marker, Math.min(failed ?? from, from));
    return found;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const at = (pattern: RegExp) => {
      pattern.lastIndex = i;
      return pattern.exec(text);
    };

    if (ch === '\\' && i + 1 < text.length && /[\\`*_[\]()@!#>-]/.test(text[i + 1]!)) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push({ t: 'br' });
      i += 1;
      continue;
    }
    if (ch === '`') {
      const end = find('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (depth < MAX_INLINE_DEPTH && ch === '*' && text[i + 1] === '*') {
      const end = find('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(text.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (depth < MAX_INLINE_DEPTH && (ch === '*' || ch === '_') && text[i + 1] !== ch) {
      // `_` only counts at a word edge, so snake_case names stay as they are.
      const opens = ch === '*' || !isWordChar(text[i - 1]);
      let end = opens ? find(ch, i + 1) : -1;
      if (ch === '_' && end !== -1 && isWordChar(text[end + 1])) end = -1;
      if (end > i + 1 && !/\s/.test(text[i + 1]!)) {
        flush();
        out.push({ t: 'em', c: parseInline(text.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '@' && text[i + 1] === '[') {
      const close = closingBracket(text, i + 2);
      const target = close === -1 ? null : parenTarget(text, close + 1);
      if (target && target[0].startsWith('user:') && UUID.test(target[0].slice(5))) {
        flush();
        out.push({
          t: 'mention',
          userId: target[0].slice(5).toLowerCase(),
          name: text.slice(i + 2, close),
        });
        i = target[1];
        continue;
      }
    }
    if (ch === '!' && text[i + 1] === '[') {
      const close = closingBracket(text, i + 2);
      const target = close === -1 ? null : parenTarget(text, close + 1);
      if (target && target[0].startsWith('attachment:') && UUID.test(target[0].slice(11))) {
        flush();
        out.push({
          t: 'image',
          attachmentId: target[0].slice(11).toLowerCase(),
          alt: text.slice(i + 2, close),
        });
        i = target[1];
        continue;
      }
    }
    if (ch === '[') {
      const close = closingBracket(text, i + 1);
      const target = close === -1 ? null : parenTarget(text, close + 1);
      if (target && isSafeUrl(target[0]) && close > i + 1) {
        flush();
        const label =
          depth < MAX_INLINE_DEPTH ? parseInline(text.slice(i + 1, close), depth + 1) : [];
        // A link inside a link label is shown as its text.
        out.push({ t: 'link', href: target[0], c: unlink(label) });
        i = target[1];
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H') && !isWordChar(text[i - 1])) {
      const match = at(BARE_URL);
      if (match) {
        // Trailing punctuation usually ends the sentence, not the address.
        const url = match[0].replace(/[.,;:!?)\]'"]+$/, '');
        flush();
        out.push({ t: 'link', href: url, c: [{ t: 'text', v: url }] });
        i += url.length;
        continue;
      }
    }
    if (ch >= 'A' && ch <= 'Z' && !isWordChar(text[i - 1]) && text[i - 1] !== '-') {
      const match = at(TICKET_REF);
      if (match && !isWordChar(text[i + match[0].length]) && text[i + match[0].length] !== '-') {
        flush();
        out.push({ t: 'ref', key: match[0] });
        i += match[0].length;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

function unlink(nodes: Inline[]): Inline[] {
  return nodes.flatMap((node): Inline[] => {
    if (node.t === 'link') return unlink(node.c);
    if (node.t === 'strong' || node.t === 'em') return [{ ...node, c: unlink(node.c) }];
    return [node];
  });
}

const HEADING = /^(#{1,3}) +(.*)$/;
const FENCE = /^```/;
const BULLET = /^( {0,1})[-*+] +(.*)$/;
const NUMBERED = /^( {0,1})(\d{1,9})[.)] +(.*)$/;
const NESTED_BULLET = /^ {2,4}[-*+] +(.*)$/;
const NESTED_NUMBERED = /^ {2,4}(\d{1,9})[.)] +(.*)$/;
const QUOTE = /^> ?(.*)$/;

/** Text into blocks. Line endings may be `\n` or `\r\n`. */
export function parseRichText(input: string, quoteDepth = 0): Block[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ t: 'p', c: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      endParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // the closing fence, or the end of the text
      blocks.push({ t: 'pre', v: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      endParagraph();
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      blocks.push({
        t: 'h',
        level: heading[1]!.length as 1 | 2 | 3,
        c: parseInline(heading[2]!.trim()),
      });
      i += 1;
      continue;
    }
    if (QUOTE.test(line) && quoteDepth < MAX_QUOTE_DEPTH) {
      endParagraph();
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        body.push(QUOTE.exec(lines[i]!)![1]!);
        i += 1;
      }
      blocks.push({ t: 'quote', c: parseRichText(body.join('\n'), quoteDepth + 1) });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      endParagraph();
      const numbered = NUMBERED.test(line);
      const list: List = {
        t: numbered ? 'ol' : 'ul',
        start: numbered ? Number(NUMBERED.exec(line)![2]) : 1,
        items: [],
      };
      const top = numbered ? NUMBERED : BULLET;
      while (i < lines.length) {
        const current = lines[i]!;
        const item = top.exec(current);
        if (item) {
          list.items.push({ c: parseInline(item[numbered ? 3 : 2]!), sub: null });
          i += 1;
          continue;
        }
        const nestedBullet = NESTED_BULLET.exec(current);
        const nestedNumber = NESTED_NUMBERED.exec(current);
        const parent = list.items[list.items.length - 1];
        if (parent && (nestedBullet || nestedNumber)) {
          const kind = nestedNumber ? 'ol' : 'ul';
          if (!parent.sub || parent.sub.t !== kind) {
            parent.sub = { t: kind, start: nestedNumber ? Number(nestedNumber[1]) : 1, items: [] };
          }
          parent.sub.items.push({
            c: parseInline(nestedNumber ? nestedNumber[2]! : nestedBullet![1]!),
            sub: null,
          });
          i += 1;
          continue;
        }
        break;
      }
      blocks.push(list);
      continue;
    }
    paragraph.push(line);
    i += 1;
  }
  endParagraph();
  return blocks;
}

function walkInline(nodes: Inline[], visit: (node: Inline) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.t === 'strong' || node.t === 'em' || node.t === 'link') walkInline(node.c, visit);
  }
}

function walkBlocks(blocks: Block[], visit: (node: Inline) => void): void {
  for (const block of blocks) {
    if (block.t === 'p' || block.t === 'h') walkInline(block.c, visit);
    else if (block.t === 'quote') walkBlocks(block.c, visit);
    else if (block.t === 'ul' || block.t === 'ol') {
      for (const item of block.items) {
        walkInline(item.c, visit);
        if (item.sub) walkBlocks([item.sub], visit);
      }
    }
  }
}

/** The ticket keys the text refers to (not inside code), each once, in order of appearance. */
export function referencedKeys(text: string): string[] {
  const keys = new Set<string>();
  walkBlocks(parseRichText(text), (node) => {
    if (node.t === 'ref') keys.add(node.key);
  });
  return [...keys];
}

/** The ids of the people mentioned, each once. */
export function mentionedUserIds(text: string): string[] {
  const ids = new Set<string>();
  walkBlocks(parseRichText(text), (node) => {
    if (node.t === 'mention') ids.add(node.userId);
  });
  return [...ids];
}

/** The attachments shown inside the text, each once. */
export function embeddedAttachmentIds(text: string): string[] {
  const ids = new Set<string>();
  walkBlocks(parseRichText(text), (node) => {
    if (node.t === 'image') ids.add(node.attachmentId);
  });
  return [...ids];
}
