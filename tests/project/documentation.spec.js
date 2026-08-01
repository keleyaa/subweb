import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiredDocuments, verifyDocs } from '../../scripts/verify-docs.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('documentation contract', () => {
  it('keeps the documentation graph complete and linkable', () => {
    expect(verifyDocs({ root })).toEqual([]);
    expect(requiredDocuments).toHaveLength(14);
  });

  it('documents exactly the approved deployment families and source lineage', () => {
    const readme = read('README.md');
    for (const name of ['本机源码', 'Docker', 'Railway', 'Render']) expect(readme).toContain(name);
    for (const source of [
      'stilleshan/subweb',
      'keleyaa/MyUrls',
      'CareyWang/MyUrls',
      'Aethersailor/SubConverter-Extended',
    ]) expect(readme).toContain(source);
    expect(readme).not.toMatch(/docker\s+(?:pull|run)[^\n]*:latest/iu);
  });

  it('keeps runnable commands and ignored runtime data explicit', () => {
    const local = read('docs/deployment-local.md');
    const docker = read('docs/deployment-docker.md');
    const maintenance = read('docs/maintenance.md');
    for (const command of ['bootstrap.sh', 'start.sh', 'status.sh', 'stop.sh']) expect(local).toContain(command);
    for (const command of ['configure.sh', 'validate-compose.sh', 'docker compose up -d --build --wait']) {
      expect(docker).toContain(command);
    }
    for (const ignored of ['.env', '.runtime/', 'dist/', 'test-results/']) expect(maintenance).toContain(ignored);
  });
});
