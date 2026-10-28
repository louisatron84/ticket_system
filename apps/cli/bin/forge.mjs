#!/usr/bin/env node
// Runs the TypeScript source directly, so the command needs no build step.
import { register } from 'tsx/esm/api';

register();
const { main } = await import('../src/main.ts');
process.exitCode = await main(process.argv.slice(2));
