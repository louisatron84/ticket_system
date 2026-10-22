import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { testConfig } from './test-utils';

describe('buildApp', () => {
  it('uses no deprecated Fastify options', async () => {
    const deprecations: string[] = [];
    const onWarning = (warning: Error & { code?: string }) => {
      if (warning.code?.startsWith('FSTDEP')) deprecations.push(warning.message);
    };

    process.on('warning', onWarning);
    try {
      await buildApp({ config: testConfig(), readinessChecks: [] });
      // process.emitWarning delivers on a later tick.
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('warning', onWarning);
    }

    expect(deprecations).toEqual([]);
  });
});
