import { describe, expect, it } from 'vitest';
import { readSidebarCollapsed, writeSidebarCollapsed } from './preferences';

const storageWith = (value: string | null) => ({ getItem: () => value });
const throwingGet = {
  getItem: () => {
    throw new Error('SecurityError: storage disabled');
  },
};

describe('readSidebarCollapsed', () => {
  it('reads the exact stored strings', () => {
    expect(readSidebarCollapsed(storageWith('true'))).toBe(true);
    expect(readSidebarCollapsed(storageWith('false'))).toBe(false);
  });

  it.each([[null], ['yes'], ['{'], [''], ['TRUE'], ['1']])(
    'falls back to expanded for the unrecognised value %j',
    (stored) => {
      expect(readSidebarCollapsed(storageWith(stored))).toBe(false);
    },
  );

  it('falls back to expanded when storage throws', () => {
    expect(readSidebarCollapsed(throwingGet)).toBe(false);
  });

  it('falls back to expanded when storage is unavailable', () => {
    expect(readSidebarCollapsed(undefined)).toBe(false);
  });
});

describe('writeSidebarCollapsed', () => {
  it('round-trips through storage under the documented key', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    writeSidebarCollapsed(true, storage);
    expect(data.get('forge.sidebar.collapsed')).toBe('true');
    expect(readSidebarCollapsed(storage)).toBe(true);
  });

  it('does not throw when storage rejects the write', () => {
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writeSidebarCollapsed(true, full)).not.toThrow();
  });
});
