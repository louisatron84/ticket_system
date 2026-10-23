export type ContentWidth = 'narrow' | 'wide' | 'full';

/**
 * How much of the screen a page may use. Most pages read best in a column; the ticket list and the
 * board are tables and lanes that need all the room; a single ticket sits between the two.
 */
export function contentWidth(pathname: string): ContentWidth {
  if (/^\/w\/[^/]+\/tickets$/.test(pathname)) return 'full';
  if (/^\/w\/[^/]+\/projects\/[^/]+\/(board|list)$/.test(pathname)) return 'full';
  if (/^\/w\/[^/]+\/tickets\/[^/]+$/.test(pathname)) return 'wide';
  return 'narrow';
}
