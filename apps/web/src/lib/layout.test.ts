import { describe, expect, it } from 'vitest';
import { contentWidth } from './layout';

describe('contentWidth', () => {
  it.each([
    '/w/acme',
    '/w/acme/members',
    '/w/acme/projects',
    '/w/acme/projects/WEB',
    '/settings/profile',
    '/no-workspace',
  ])('keeps %s narrow', (path) => {
    expect(contentWidth(path)).toBe('narrow');
  });

  it.each(['/w/acme/tickets', '/w/acme/projects/WEB/board', '/w/acme/projects/WEB/list'])(
    'gives %s the full width, for tables and boards',
    (path) => {
      expect(contentWidth(path)).toBe('full');
    },
  );

  it.each(['/w/acme/tickets/WEB-12', '/w/acme/tickets/new'])(
    'gives %s a wider column, for the ticket and its fields',
    (path) => {
      expect(contentWidth(path)).toBe('wide');
    },
  );

  it('does not widen an address it does not recognise', () => {
    expect(contentWidth('/w/acme/tickets/WEB-12/extra')).toBe('narrow');
    expect(contentWidth('/w/acme/projects/WEB/kanban')).toBe('narrow');
  });
});
