import type { BulkTicketResult, TicketConfig, TicketSummary } from '@forge/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bulkSummary, defaultTypeAndPriority, ticketHref } from './ticket-actions';

const summary = (key: string) => ({ key }) as unknown as TicketSummary;
const ok = (key: string): BulkTicketResult['results'][number] => ({
  key,
  ok: true,
  ticket: summary(key),
});
const failed = (key: string, message: string): BulkTicketResult['results'][number] => ({
  key,
  ok: false,
  error: { code: 'conflict', message },
});

describe('bulkSummary', () => {
  it('says how many changed when all of them did', () => {
    expect(bulkSummary([ok('WEB-1'), ok('WEB-2'), ok('WEB-3')])).toEqual({
      text: 'Changed 3 of 3.',
      failures: [],
    });
  });

  it('lists each failure with its reason when only some changed', () => {
    expect(
      bulkSummary([
        ok('WEB-1'),
        failed('WEB-2', 'This ticket is archived. Unarchive it to change it.'),
        failed('WEB-9', 'Ticket not found.'),
      ]),
    ).toEqual({
      text: 'Changed 1 of 3. 2 could not be changed:',
      failures: [
        'WEB-2: This ticket is archived. Unarchive it to change it.',
        'WEB-9: Ticket not found.',
      ],
    });
  });

  it('reports none changed when every ticket failed', () => {
    expect(bulkSummary([failed('WEB-2', 'Nope.')])).toEqual({
      text: 'Changed 0 of 1. 1 could not be changed:',
      failures: ['WEB-2: Nope.'],
    });
  });
});

describe('defaultTypeAndPriority', () => {
  const type = (key: string) => ({ id: `type-${key}`, key, name: key });
  const priority = (key: string, rank: number) => ({ id: `prio-${key}`, key, name: key, rank });
  const config = (types: TicketConfig['types'], priorities: TicketConfig['priorities']) =>
    ({ types, priorities, labels: [], components: [] }) as TicketConfig;

  it('uses the task type and the normal priority when they exist', () => {
    expect(
      defaultTypeAndPriority(
        config(
          [type('bug'), type('task'), type('story')],
          [priority('critical', 5), priority('low', 1), priority('normal', 3), priority('high', 4)],
        ),
      ),
    ).toEqual({ typeId: 'type-task', priorityId: 'prio-normal' });
  });

  it('falls back to the first type when there is no task', () => {
    expect(
      defaultTypeAndPriority(config([type('bug'), type('story')], [priority('normal', 3)])).typeId,
    ).toBe('type-bug');
  });

  it('falls back to the middle rank when there is no normal priority', () => {
    const priorities = [priority('p4', 9), priority('p1', 1), priority('p3', 7), priority('p2', 4)];
    expect(defaultTypeAndPriority(config([type('task')], priorities)).priorityId).toBe('prio-p2');
    expect(
      defaultTypeAndPriority(
        config([type('task')], [priority('a', 1), priority('b', 2), priority('c', 3)]),
      ).priorityId,
    ).toBe('prio-b');
  });

  it('gives empty ids when the workspace has none to offer', () => {
    expect(defaultTypeAndPriority(config([], []))).toEqual({ typeId: '', priorityId: '' });
  });
});

describe('ticketHref', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is an absolute address built from where the app is running now', () => {
    vi.stubGlobal('window', { location: { origin: 'https://forge.example' } });
    expect(ticketHref('acme', 'WEB-3')).toBe('https://forge.example/w/acme/tickets/WEB-3');
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3100' } });
    expect(ticketHref('north wind', 'API-12')).toBe(
      'http://localhost:3100/w/north%20wind/tickets/API-12',
    );
  });
});
