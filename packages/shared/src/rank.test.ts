import { describe, expect, it } from 'vitest';
import { isRank, rankBetween, spreadRanks } from './rank';

// Byte order, the way the database's C collation compares ranks.
const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe('rankBetween', () => {
  it('starts an empty list at a0', () => {
    expect(rankBetween(null, null)).toBe('a0');
  });

  it('goes after the last and before the first', () => {
    expect(rankBetween('a0', null) > 'a0').toBe(true);
    expect(rankBetween(null, 'a0') < 'a0').toBe(true);
  });

  it('fits a key between two neighbours', () => {
    const middle = rankBetween('a0', 'a1');
    expect('a0' < middle && middle < 'a1').toBe(true);
  });

  it('keeps keys short when adding to the end many times', () => {
    const ranks = spreadRanks(5000);
    expect([...ranks].sort(byteOrder)).toEqual(ranks);
    expect(Math.max(...ranks.map((rank) => rank.length))).toBeLessThanOrEqual(4);
  });

  it('keeps order through many inserts at the top and in one gap', () => {
    let top = rankBetween(null, null);
    for (let index = 0; index < 500; index += 1) {
      const next = rankBetween(null, top);
      expect(next < top).toBe(true);
      top = next;
    }
    let low = 'a0';
    const high = 'a1';
    for (let index = 0; index < 200; index += 1) {
      const next = rankBetween(low, high);
      expect(low < next && next < high).toBe(true);
      expect(isRank(next)).toBe(true);
      low = next;
    }
  });

  it('refuses keys out of order and keys it could not have made', () => {
    expect(() => rankBetween('a1', 'a0')).toThrow();
    expect(() => rankBetween('a0', 'a0')).toThrow();
    expect(() => rankBetween('a10', null)).toThrow();
    expect(isRank('a10')).toBe(false);
    expect(isRank('a1')).toBe(true);
    expect(isRank('')).toBe(false);
    expect(isRank('a!')).toBe(false);
  });
});
