import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiredDocuments, verifyDocs } from '../../scripts/verify-docs.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('documentation contract', () => {
  it('keeps the documentation graph complete and linkable', () => {
    expect(verifyDocs({ root })).toEqual([]);
    expect(requiredDocuments).toHaveLength(12);
  });

  it('documents exactly the approved deployment families and source lineage', () => {
    const readme = read('README.md');
    for (const name of ['本机源码', 'Docker']) expect(readme).toContain(name);
    for (const source of [
      'stilleshan/subweb',
      'keleyaa/MyUrls',
      'CareyWang/MyUrls',
      'Aethersailor/SubConverter-Extended',
    ]) expect(readme).toContain(source);
    expect(readme).not.toMatch(/docker\s+(?:pull|run)[^\n]*:latest/iu);
  });

  it('keeps runnable commands and ignored runtime data explicit', () => {
    const readme = read('README.md');
    const local = read('docs/deployment-local.md');
    const docker = read('docs/deployment-docker.md');
    const maintenance = read('docs/maintenance.md');
    for (const document of [readme, local, docker]) {
      expect(document).toContain('git clone https://github.com/keleyaa/subweb.git');
      expect(document).toContain('cd subweb');
    }
    for (const command of ['bootstrap.sh', 'start.sh', 'status.sh', 'stop.sh']) expect(local).toContain(command);
    for (const command of [
      'docker-deploy.sh',
      'configure.sh',
      'validate-compose.sh',
      'docker compose up -d --build --wait',
      'docker compose up -d --no-build --pull always --wait',
    ]) {
      expect(docker).toContain(command);
    }
    for (const command of ['docker compose ps', 'docker compose logs', 'docker compose stop', 'docker compose start', 'docker compose down']) {
      expect(docker).toContain(command);
    }
    expect(docker).toContain('不要直接执行 `cat .env`');
    expect(docker).toContain('无需手动填写');
    expect(local).toContain('http://127.0.0.1:18080/');
    expect(local).toContain('不要在其他项目目录执行');
    for (const ignored of ['.env', '.runtime/', 'dist/', 'test-results/']) expect(maintenance).toContain(ignored);
  });

  it('documents Docker Hub and GHCR as equivalent release sources', () => {
    const readme = read('README.md');
    const docker = read('docs/deployment-docker.md');
    const maintenance = read('docs/maintenance.md');

    for (const document of [readme, docker, maintenance]) {
      expect(document).toContain('docker.io/keleyaa/subweb');
      expect(document).toContain('ghcr.io/keleyaa/subweb');
    }
    expect(docker).toContain('--image ghcr.io/keleyaa/subweb:sha-');
    expect(maintenance).toContain('packages: write');
  });
});
