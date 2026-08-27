import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const lockPath = fileURLToPath(
  new URL('../deploy/versions.lock.json', import.meta.url),
);

const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const myurlsSource = lock.services?.myurls?.source;

if (
  typeof myurlsSource?.tag !== 'string' ||
  myurlsSource.tag.length === 0 ||
  myurlsSource.tag.toLowerCase() === 'latest'
) {
  console.error(
    'Production readiness blocked: MyUrls source.tag must be a stable published tag.',
  );
  process.exit(1);
}

if (myurlsSource.release) {
  console.error(
    'Production readiness blocked: workflow-only MyUrls release evidence is not sufficient.',
  );
  process.exit(1);
}

console.log('Production readiness tag gate passed.');
