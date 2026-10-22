import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Loads the repo-root .env into process.env. Existing variables win; a missing file is fine. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(path.join(REPO_ROOT, '.env'));
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
}
