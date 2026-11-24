import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function indexNowKey(value = '') {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(value)) {
    throw new Error('INDEXNOW_KEY must contain 8–128 letters, digits, or hyphens.');
  }
  return value;
}

export function writeIndexNowKey(directory, value) {
  const key = indexNowKey(value);
  // The key is written after the rest of the site, so a collision fails the build.
  writeFileSync(join(directory, `${key}.txt`), `${key}\n`, { flag: 'wx' });
}
