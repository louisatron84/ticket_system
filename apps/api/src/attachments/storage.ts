import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Where attachment bytes live. Only local disk exists today; cloud storage can implement this. */
export type AttachmentStorage = {
  /** Stores the bytes under a new random key and returns the key. */
  put(bytes: Uint8Array): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
};

// 32 random bytes as hex. A key is never derived from anything a person typed.
const KEY_SHAPE = /^[0-9a-f]{64}$/;

export function localDiskStorage(root: string): AttachmentStorage {
  const resolved = path.resolve(root);
  // Two levels of folders by key prefix keep any one folder small.
  const pathOf = (key: string) => {
    if (!KEY_SHAPE.test(key)) throw new Error('Not an attachment storage key');
    return path.join(resolved, key.slice(0, 2), key);
  };
  return {
    async put(bytes) {
      const key = randomBytes(32).toString('hex');
      const file = pathOf(key);
      await mkdir(path.dirname(file), { recursive: true });
      // `wx`: never overwrite, even in the impossible case of a repeated key.
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      return key;
    },
    get: (key) => readFile(pathOf(key)),
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
