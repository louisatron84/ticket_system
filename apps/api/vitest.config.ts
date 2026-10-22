import { defineConfig } from 'vitest/config';

// Integration tests share one database, so test files must not run concurrently.
export default defineConfig({ test: { fileParallelism: false } });
