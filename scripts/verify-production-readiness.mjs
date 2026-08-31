import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { validateVersionLocks } from './verify-version-locks.mjs';

const defaultLockPath = fileURLToPath(
  new URL('../deploy/versions.lock.json', import.meta.url),
);
const lockPath = process.argv[2] ?? defaultLockPath;
const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const myurlsService = lock.services?.myurls;
const myurlsErrors = validateVersionLocks(lock).filter((error) =>
  error.startsWith('services.myurls'),
);

if (!isRecord(myurlsService) || myurlsErrors.length > 0) {
  console.error('Production readiness blocked: MyUrls lock contract is invalid.');
  for (const error of myurlsErrors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Production readiness tag gate passed.');
