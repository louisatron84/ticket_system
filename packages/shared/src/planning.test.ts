import { describe, expect, it } from 'vitest';
import { addDays, createCycleBodySchema, rankTicketBodySchema } from './planning';

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2031-01-30', 3)).toBe('2031-02-02');
    expect(addDays('2031-12-31', 1)).toBe('2032-01-01');
    expect(addDays('2032-03-01', -1)).toBe('2032-02-29');
  });
});

describe('the cycle and rank bodies', () => {
  it('refuses a cycle that ends before it starts', () => {
    expect(
      createCycleBodySchema.safeParse({ startsOn: '2031-02-01', endsOn: '2031-01-31' }).success,
    ).toBe(false);
    expect(createCycleBodySchema.safeParse({}).success).toBe(true);
  });

  it('takes dates from 2000 to 2099 only', () => {
    for (const [startsOn, endsOn] of [
      ['0001-01-01', '2031-01-10'],
      ['2031-01-01', '9999-12-31'],
      ['1999-12-31', '2000-01-10'],
      ['2099-12-20', '2100-01-02'],
    ]) {
      expect(createCycleBodySchema.safeParse({ startsOn, endsOn }).success, startsOn).toBe(false);
    }
    expect(
      createCycleBodySchema.safeParse({ startsOn: '2000-01-01', endsOn: '2099-12-31' }).success,
    ).toBe(true);
  });

  it('needs exactly one way of saying where a ticket goes', () => {
    expect(rankTicketBodySchema.safeParse({ to: 'top' }).success).toBe(true);
    expect(rankTicketBodySchema.safeParse({ after: 'WEB-1' }).success).toBe(true);
    expect(rankTicketBodySchema.safeParse({}).success).toBe(false);
    expect(rankTicketBodySchema.safeParse({ to: 'top', before: 'WEB-1' }).success).toBe(false);
  });
});
